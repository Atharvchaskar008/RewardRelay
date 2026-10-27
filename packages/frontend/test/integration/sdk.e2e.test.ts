import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  ChainError,
  EmbeddedWallet,
  MemoryKeyStore,
  chainContext,
  createApiClient,
  listBuyForYou,
  listPassOn,
  onboardWallet,
  restoreWallet,
  runDealAction,
  tx,
  type SdkContext,
} from "@/src/client/sdk";
import {
  chainFixture,
  fakePhone,
  resetEmulators,
  signInWithPhone,
  useIntegrationEnv,
} from "../helpers/integration";
import { routerFetch } from "../helpers/router";

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

  it("restores the wallet on a new device from the encrypted backup", async () => {
    const device = new EmbeddedWallet(new MemoryKeyStore());
    const address = await restoreWallet(rahul.sdk.api, device, rahul.pin);
    expect(address).toBe(rahul.wallet.getAccount().address);
  });
});
