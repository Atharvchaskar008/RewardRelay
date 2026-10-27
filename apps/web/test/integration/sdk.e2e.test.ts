import { beforeAll, describe, expect, it, vi } from "vitest";
import { getAddress, type Address, type EIP1193Provider } from "viem";
import {
  ApiError,
  ChainError,
  EmbeddedWallet,
  MemoryKeyStore,
  chainContext,
  createApiClient,
  injectedChainContext,
  listBuyForYou,
  listPassOn,
  onboardInjectedWallet,
  onboardWallet,
  restoreWallet,
  runDealAction,
  sendDeliveryDetails,
  tx,
  type SdkContext,
} from "@/client/sdk";
import {
  chainFixture,
  fakePhone,
  resetEmulators,
  signInWithPhone,
  useIntegrationEnv,
} from "../helpers/integration";
import { routerFetch } from "../helpers/router";
import { DEMO_LISTINGS, seedDemoListings } from "../../scripts/demo-listings";

/**
 * Scripted end-to-end run of both deal types using only SDK functions: the API through the SDK
 * client (in-process router → real route handlers), transactions signed by the embedded wallet
 * against the local Hardhat node, Firebase phone sign-in on the Auth emulator.
 */

const silence = (["log", "warn", "error"] as const).map((method) =>
  vi.spyOn(console, method).mockImplementation(() => undefined),
);

const RATE = 100_000;
/** Generous welcome top-up for this suite so the embedded wallets can pay deposits and gas. */
const TOPUP_WEI = "50000000000000000";

interface Person {
  sdk: SdkContext;
  wallet: EmbeddedWallet;
  phone: string;
  pin: string;
}

async function person(pin: string): Promise<Person> {
  const phone = fakePhone();
  const { idToken } = await signInWithPhone(phone);
  const api = createApiClient({
    baseUrl: "http://localhost:3000",
    getIdToken: async () => idToken,
    fetch: routerFetch,
  });
  const wallet = new EmbeddedWallet(new MemoryKeyStore());
  const view = await onboardWallet(api, wallet, pin);
  expect(view.badge.hasBadge).toBe(true);
  expect(view.balanceWei).toBe(TOPUP_WEI);
  const { rpcUrl, chainId, escrow } = chainFixture();
  const chain = chainContext(
    { rpcUrl, chainId, escrow, explorerUrl: "http://localhost:4000" },
    wallet.getAccount(),
  );
  return { sdk: { api, chain, inrPerMstc: RATE }, wallet, phone, pin };
}

let asha: Person;
let rahul: Person;

beforeAll(async () => {
  useIntegrationEnv({ TOPUP_WEI });
  await resetEmulators();
  asha = await person("246802");
  rahul = await person("135791");
  return () => silence.forEach((spy) => spy.mockRestore());
});

describe("SDK end to end", () => {
  it("completes a Buy-for-you deal", async () => {
    const { listing, tx: created } = await listBuyForYou(asha.sdk, {
      title: "Rs 400 off headphones with Bank A",
      description: "I order in my account and ship to you",
      category: "ecommerce",
      faceValueInr: 450,
      priceInr: 300,
      terms: { validTill: "2026-11-30" },
    });
    expect(listing.status).toBe("Listed");
    expect(created.receipt.status).toBe("success");
    const feed = await rahul.sdk.api.listings.list({ category: "ecommerce" });
    expect(feed.items.map((item) => item.dealId)).toContain(listing.dealId);

    let deal = await rahul.sdk.api.deals.get(listing.dealId);
    expect(deal.nextAction).toBe("PAY");
    deal = (
      await runDealAction(rahul.sdk, deal, "PAY", {
        details: {
          name: "Rahul Verma",
          phone: "+16505550188",
          addressLines: ["Flat 12, Lotus Residency", "Pimpri, Pune"],
          pincode: "411018",
        },
      })
    ).deal;
    expect(deal).toMatchObject({ status: "Locked", role: "seeker", nextAction: "WAIT" });

    const sharerView = await asha.sdk.api.deals.get(listing.dealId);
    expect(sharerView.nextAction).toBe("MARK_DELIVERED");
    const details = await asha.sdk.api.deals.getDetails(listing.dealId);
    expect(details.details.pincode).toBe("411018");
    const delivered = await runDealAction(asha.sdk, sharerView, "MARK_DELIVERED", {
      proof: { orderId: "OD-402-55501", notes: "Arrives Friday" },
    });
    expect(delivered.deal.status).toBe("Delivered");

    deal = await rahul.sdk.api.deals.get(listing.dealId);
    expect(deal).toMatchObject({ nextAction: "CONFIRM", secondaryActions: ["RAISE_DISPUTE"] });
    const proof = await rahul.sdk.api.deals.getProof(listing.dealId);
    expect(proof).toMatchObject({ orderId: "OD-402-55501", matchesChain: true });

    const done = await runDealAction(rahul.sdk, deal, "CONFIRM");
    expect(done.deal).toMatchObject({ status: "Completed", nextAction: "NONE" });
    expect(done.deal.timeline.map((entry) => entry.event)).toEqual([
      "ListingCreated",
      "DealLocked",
      "Delivered",
      "Completed",
    ]);
    const me = await asha.sdk.api.me();
    expect(me?.badge.completed).toBe(1);
  });

  it("completes a Pass-on deal with the code revealed to the seeker", async () => {
    const { listing } = await listPassOn(
      asha.sdk,
      {
        title: "Rs 50 off a food order",
        description: "Shareable promo code",
        category: "coupon",
        faceValueInr: 50,
        priceInr: 20,
      },
      "feast50",
    );
    let deal = await rahul.sdk.api.deals.get(listing.dealId);
    deal = (await runDealAction(rahul.sdk, deal, "PAY")).deal;
    expect(deal).toMatchObject({ type: "PassOn", status: "Delivered", nextAction: "CONFIRM" });

    const revealed = await rahul.sdk.api.deals.code(listing.dealId);
    expect(revealed.code).toBe("FEAST50");
    const done = await runDealAction(rahul.sdk, deal, "CONFIRM");
    expect(done.deal.status).toBe("Completed");
  });

  it("maps errors to typed, user-safe messages", async () => {
    // Over the New-tier limit (Rs 500): the contract refuses before anything is signed.
    await expect(
      listBuyForYou(asha.sdk, {
        title: "Too expensive",
        description: "",
        category: "ecommerce",
        faceValueInr: 900,
        priceInr: 800,
      }),
    ).rejects.toMatchObject({ name: "ChainError", reason: "DealValueAboveLimit" });

    // A duplicate code is refused by the API.
    const error = await listPassOn(
      asha.sdk,
      {
        title: "Same code again",
        description: "",
        category: "coupon",
        faceValueInr: 50,
        priceInr: 20,
      },
      "FEAST 50",
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe("CONFLICT");

    // Accepting your own listing.
    const { listing } = await listBuyForYou(asha.sdk, {
      title: "Own listing",
      description: "",
      category: "food",
      faceValueInr: 100,
      priceInr: 50,
    });
    const own = await tx
      .acceptListing(asha.sdk.chain, BigInt(listing.dealId))
      .catch((caught: unknown) => caught);
    expect(own).toBeInstanceOf(ChainError);
    expect((own as ChainError).message).toMatch(/your own listing/);
    await runDealAction(asha.sdk, await asha.sdk.api.deals.get(listing.dealId), "CANCEL");
    expect((await asha.sdk.api.deals.get(listing.dealId)).status).toBe("Cancelled");
  });

  it("never takes a Buy-for-you payment without an address, and recovers a paid deal without one", async () => {
    const { listing } = await listBuyForYou(asha.sdk, {
      title: "Rs 30 off groceries",
      description: "",
      category: "food",
      faceValueInr: 120,
      priceInr: 90,
    });
    const balance = () =>
      rahul.sdk.chain.publicClient.getBalance({ address: rahul.wallet.getAccount().address });
    const before = await balance();

    // Paying with an empty form is refused before anything is signed.
    const empty = { name: "", phone: "", addressLines: [], pincode: "" };
    await expect(
      runDealAction(rahul.sdk, { id: listing.dealId }, "PAY", { details: empty }),
    ).rejects.toMatchObject({ name: "ChainError", message: "Enter the full name for delivery." });
    await expect(runDealAction(rahul.sdk, { id: listing.dealId }, "PAY")).rejects.toMatchObject({
      name: "ChainError",
      message: "Enter the delivery address first.",
    });
    expect(await balance()).toBe(before);
    expect((await rahul.sdk.api.deals.get(listing.dealId)).status).toBe("Listed");

    // A deal paid without the details (e.g. the details call failed after the payment).
    await tx.acceptListing(rahul.sdk.chain, BigInt(listing.dealId));
    expect(await rahul.sdk.api.deals.get(listing.dealId)).toMatchObject({
      status: "Locked",
      deliveryDetailsSent: false,
    });
    expect((await asha.sdk.api.deals.get(listing.dealId)).deliveryDetailsSent).toBe(false);

    const sent = await sendDeliveryDetails(rahul.sdk, listing.dealId, {
      name: "Rahul Verma",
      phone: "+919876543210",
      addressLines: ["Flat 12, Lotus Residency", "Pimpri, Pune"],
      pincode: " 411018 ",
    });
    expect(sent.deliveryDetailsSent).toBe(true);
    const details = await asha.sdk.api.deals.getDetails(listing.dealId);
    expect(details.details).toMatchObject({ name: "Rahul Verma", pincode: "411018" });
  });

  it("links a browser wallet and signs a whole deal through it", async () => {
    const { rpcUrl, chainId, escrow } = chainFixture();
    const node = async (method: string, params: unknown[] = []) => {
      const res = await fetch(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
      const json = (await res.json()) as {
        result?: unknown;
        error?: { code: number; message: string };
      };
      if (json.error) throw Object.assign(new Error(json.error.message), { code: json.error.code });
      return json.result;
    };
    // A browser-wallet stand-in: EIP-1193 over one of the local node's unlocked accounts, which
    // signs messages (personal_sign) and sends transactions (eth_sendTransaction) like a wallet.
    const address = getAddress(((await node("eth_accounts")) as Address[])[15]);
    const provider = {
      request: async ({ method, params }: { method: string; params?: unknown[] }) =>
        method === "eth_requestAccounts" || method === "eth_accounts"
          ? [address]
          : node(method, params ?? []),
      on: () => undefined,
      removeListener: () => undefined,
    } as unknown as EIP1193Provider;

    const { idToken } = await signInWithPhone(fakePhone());
    const api = createApiClient({
      baseUrl: "http://localhost:3000",
      getIdToken: async () => idToken,
      fetch: routerFetch,
    });
    const { view } = await onboardInjectedWallet(api, provider);
    expect(view).toMatchObject({ address, walletKind: "injected" });
    expect(view.badge.hasBadge).toBe(true);
    expect((await api.me())?.walletKind).toBe("injected");

    const chain = await injectedChainContext(
      { rpcUrl, chainId, escrow, explorerUrl: "http://localhost:4000" },
      provider,
      address,
    );
    const meera: SdkContext = { api, chain, inrPerMstc: RATE };
    const { listing } = await listBuyForYou(meera, {
      title: "Rs 200 off shoes with Bank B",
      description: "Signed with a browser wallet",
      category: "ecommerce",
      faceValueInr: 250,
      priceInr: 200,
    });
    let deal = await rahul.sdk.api.deals.get(listing.dealId);
    expect(deal.sharer).toBe(address);
    deal = (
      await runDealAction(rahul.sdk, deal, "PAY", {
        details: {
          name: "Rahul Verma",
          phone: "+919876543210",
          addressLines: ["Flat 12, Lotus Residency"],
          pincode: "411018",
        },
      })
    ).deal;
    const delivered = await runDealAction(meera, { id: listing.dealId }, "MARK_DELIVERED", {
      proof: { orderId: "OD-BW-0001" },
    });
    expect(delivered.deal.status).toBe("Delivered");
    const done = await runDealAction(rahul.sdk, { id: listing.dealId }, "CONFIRM");
    expect(done.deal.status).toBe("Completed");
    expect(done.deal.timeline.map((entry) => entry.event)).toEqual([
      "ListingCreated",
      "DealLocked",
      "Delivered",
      "Completed",
    ]);
  });

  it("seeds the demo marketplace once; a second run lists nothing new", async () => {
    const demo = await person("424242");
    const sharer = demo.wallet.getAccount().address;
    // Earlier tests move the local chain's clock ahead, so event times are based on chain time.
    const now = Number((await demo.sdk.chain.publicClient.getBlock()).timestamp);
    const first = await seedDemoListings(demo.sdk, sharer, { now, runSuffix: "E2E1" });
    expect(first).toMatchObject({ skipped: [] });
    expect(first.created).toHaveLength(DEMO_LISTINGS.length);
    const types = await Promise.all(
      first.created.map(async (id) => (await demo.sdk.api.deals.get(id)).type),
    );
    expect(types.filter((type) => type === "PassOn")).toHaveLength(1);

    const again = await seedDemoListings(demo.sdk, sharer, { now, runSuffix: "E2E2" });
    expect(again.created).toEqual([]);
    expect(again.skipped).toHaveLength(DEMO_LISTINGS.length);
  });

  it("restores the wallet on a new device from the encrypted backup", async () => {
    const device = new EmbeddedWallet(new MemoryKeyStore());
    const address = await restoreWallet(rahul.sdk.api, device, rahul.pin);
    expect(address).toBe(rahul.wallet.getAccount().address);
  });
});
