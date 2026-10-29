/**
 * Checks a deployed RewardRelay from the outside.
 *
 *   npm run check:live -w @rewardrelay/web                  # read-only checks
 *   LIVE_DEALS=1 npm run check:live -w @rewardrelay/web     # plus real deal flows on the chain
 *
 * - LIVE_URL: the deployment (default https://sakar-app.vercel.app).
 * - Deal flows use Firebase **test** phone numbers, never in the repo: LIVE_SHARER_PHONE / _CODE /
 *   _PIN, LIVE_SEEKER_PHONE / _CODE / _PIN and LIVE_ADMIN_PHONE / _CODE (an ADMIN_UIDS account).
 *   LIVE_ENV_FILE may name a dotenv file holding them, so they stay out of shell history. Wallets
 *   are restored from their backups with the PIN.
 * - LIVE_TIMEOUT=1 also runs the refund-after-deadline flow (waits for the category's delivery window).
 * Chain and Firebase settings come from apps/web/.env. Prices are ₹10-20 at the demo rate.
 */
import { readFileSync } from "fs";
import path from "path";
import { parse } from "dotenv";
import { formatEther, type Address } from "viem";
import {
  ApiError,
  ChainError,
  EmbeddedWallet,
  MemoryKeyStore,
  chainContext,
  createApiClient,
  listBuyForYou,
  listPassOn,
  raiseDispute,
  restoreWallet,
  runDealAction,
  type SdkContext,
} from "@/client/sdk";

type Env = Record<string, string | undefined>;

const results: { ok: boolean; name: string; detail: string }[] = [];

function report(ok: boolean, name: string, detail = ""): void {
  results.push({ ok, name, detail });
  console.log(`${ok ? "✓" : "✖"} ${name}${detail ? `: ${detail}` : ""}`);
}

async function check(name: string, work: () => Promise<string | void>): Promise<void> {
  const started = Date.now();
  try {
    const detail = await work();
    report(true, name, [detail, `${Date.now() - started} ms`].filter(Boolean).join(", "));
  } catch (error) {
    report(false, name, error instanceof Error ? error.message : String(error));
  }
}

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function required(env: Env, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`Set ${name} (see the comment at the top of scripts/live-check.ts).`);
  return value;
}

async function get(url: string, headers: Record<string, string> = {}) {
  const started = Date.now();
  const res = await fetch(url, { headers });
  const text = await res.text();
  let json: { ok?: boolean; data?: unknown; error?: { code: string } } | undefined;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { res, json, ms: Date.now() - started, timing: res.headers.get("server-timing") ?? "" };
}

const median = (values: number[]) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

async function readOnlyChecks(base: string, env: Env): Promise<void> {
  await check("health", async () => {
    const { res, json } = await get(`${base}/api/health`);
    const data = json?.data as {
      status: string;
      chain: { ok: boolean; chainId: number; latestBlock?: number };
      firestore: { ok: boolean };
      signers: { role: string; balanceMstc: string; low: boolean }[];
    };
    expect(res.status === 200 && data?.status === "ok", `status ${res.status} ${data?.status}`);
    expect(data.chain.ok && data.firestore.ok, "chain or Firestore not ok");
    expect(String(data.chain.chainId) === required(env, "MST_CHAIN_ID"), "unexpected chain id");
    return `block ${data.chain.latestBlock}, ${data.signers.map((s) => `${s.role} ${s.balanceMstc}${s.low ? " LOW" : ""}`).join(", ")}`;
  });

  await check("listings feed", async () => {
    const { res, json, timing } = await get(`${base}/api/listings`);
    expect(res.status === 200 && json?.ok, `status ${res.status}`);
    const items = (json?.data as { items: unknown[] }).items;
    return `${items.length} open offers; ${timing}`;
  });

  await check("deal view", async () => {
    const { res, json, timing } = await get(`${base}/api/deals/2`);
    expect(res.status === 200 && json?.ok, `status ${res.status}`);
    return `deal #2 ${(json?.data as { status: string }).status}; ${timing}`;
  });

  await check("rpc relay", async () => {
    const network = Number(required(env, "MST_CHAIN_ID")) === 4646 ? "mainnet" : "testnet";
    const res = await fetch(`${base}/api/rpc/${network}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
    });
    const body = (await res.json()) as { result?: string };
    expect(Number(body.result) === Number(required(env, "MST_CHAIN_ID")), `got ${body.result}`);
    return `eth_chainId ${body.result}`;
  });

  await check("private routes need a session", async () => {
    const me = await get(`${base}/api/me`);
    const code = await get(`${base}/api/deals/2/code`);
    expect(
      me.res.status === 401 && code.res.status === 401,
      `${me.res.status} / ${code.res.status}`,
    );
    return "401 without a token";
  });

  await check("keeper needs its secret", async () => {
    const { res } = await get(`${base}/api/cron/release`, {
      "x-cron-secret": "wrong".padEnd(40, "0"),
    });
    expect(res.status === 403, `status ${res.status}`);
    return "403 with a wrong secret";
  });

  await check("security headers", async () => {
    const res = await fetch(`${base}/`);
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp.includes("frame-ancestors 'none'"), "CSP without frame-ancestors 'none'");
    expect(!csp.includes("unsafe-eval"), "CSP allows unsafe-eval");
    expect(res.headers.get("x-content-type-options") === "nosniff", "no nosniff");
    expect(Boolean(res.headers.get("strict-transport-security")), "no HSTS");
    return "CSP, nosniff, HSTS";
  });

  await check("warm latency", async () => {
    const samples: number[] = [];
    const server: number[] = [];
    for (let i = 0; i < 5; i++) {
      const { ms, timing } = await get(`${base}/api/listings`);
      samples.push(ms);
      const total = /total;dur=(\d+)/.exec(timing);
      if (total) server.push(Number(total[1]));
    }
    return `feed median ${median(samples)} ms round trip, ${median(server)} ms on the server`;
  });
}

async function firebaseIdToken(apiKey: string, phone: string, code: string): Promise<string> {
  const call = async (method: string, body: unknown) => {
    const res = await fetch(`https://identitytoolkit.googleapis.com/v1/${method}?key=${apiKey}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as Record<string, string> & { error?: { message: string } };
    if (!res.ok) throw new Error(`Firebase sign-in failed: ${json.error?.message ?? res.status}`);
    return json;
  };
  // Test phone numbers skip reCAPTCHA and SMS; real numbers are refused here on purpose.
  const { sessionInfo } = await call("accounts:sendVerificationCode", {
    phoneNumber: phone,
    recaptchaToken: "test",
  });
  return (await call("accounts:signInWithPhoneNumber", { sessionInfo, code })).idToken;
}

interface Party {
  sdk: SdkContext;
  address: Address;
}

async function signIn(base: string, env: Env, role: "SHARER" | "SEEKER"): Promise<Party> {
  const idToken = await firebaseIdToken(
    required(env, "NEXT_PUBLIC_FIREBASE_API_KEY"),
    required(env, `LIVE_${role}_PHONE`),
    required(env, `LIVE_${role}_CODE`),
  );
  const api = createApiClient({ baseUrl: base, getIdToken: async () => idToken });
  const pin = required(env, `LIVE_${role}_PIN`);
  expect(await api.me(), `the ${role.toLowerCase()} account has no wallet yet`);
  const wallet = new EmbeddedWallet(new MemoryKeyStore());
  await restoreWallet(api, wallet, pin);
  await wallet.unlock(pin);
  const chain = chainContext(
    {
      rpcUrl: required(env, "MST_RPC_URL"),
      chainId: Number(required(env, "MST_CHAIN_ID")),
      escrow: required(env, "ESCROW_ADDRESS") as Address,
      explorerUrl: env.MST_EXPLORER_URL ?? "https://testnet.mstscan.com",
    },
    wallet.getAccount(),
  );
  const sdk = { api, chain, inrPerMstc: Number(env.DEMO_RATE_INR_PER_MSTC ?? 100_000) };
  return { sdk, address: wallet.getAccount().address };
}

const DETAILS = {
  name: "Live Check",
  phone: "+16505550188",
  addressLines: ["Flat 12, Lotus Residency", "Pimpri, Pune"],
  pincode: "411018",
};

async function dealChecks(base: string, env: Env): Promise<void> {
  const sharer = await signIn(base, env, "SHARER");
  const seeker = await signIn(base, env, "SEEKER");
  const adminToken = await firebaseIdToken(
    required(env, "NEXT_PUBLIC_FIREBASE_API_KEY"),
    required(env, "LIVE_ADMIN_PHONE"),
    required(env, "LIVE_ADMIN_CODE"),
  );
  const admin = createApiClient({ baseUrl: base, getIdToken: async () => adminToken });
  const balance = (party: Party) =>
    party.sdk.chain.publicClient.getBalance({ address: party.address });
  const before = (await balance(sharer)) + (await balance(seeker));
  console.log(
    `  Sharer ${sharer.address} ${formatEther(await balance(sharer))} · Seeker ${seeker.address} ${formatEther(await balance(seeker))}`,
  );

  await check("Buy-for-you deal", async () => {
    const { listing } = await listBuyForYou(sharer.sdk, {
      title: "Live check: Rs 30 off an order",
      description: "Automated end-to-end check",
      category: "ecommerce",
      faceValueInr: 30,
      priceInr: 20,
    });
    const id = listing.dealId;
    await runDealAction(seeker.sdk, { id }, "PAY", { details: DETAILS });
    const details = await sharer.sdk.api.deals.getDetails(id);
    expect(details.details.pincode === DETAILS.pincode, "the Sharer did not get the address");
    await runDealAction(sharer.sdk, { id }, "MARK_DELIVERED", { proof: { orderId: "LIVE-1" } });
    const proof = await seeker.sdk.api.deals.getProof(id);
    expect(proof.matchesChain, "proof does not match the chain");
    const done = await runDealAction(seeker.sdk, { id }, "CONFIRM");
    expect(done.deal.status === "Completed", `status ${done.deal.status}`);
    return `deal #${id} Completed`;
  });

  const code = `LIVE${Date.now().toString(36).toUpperCase()}`;
  await check("Pass-on deal with code reveal", async () => {
    const { listing } = await listPassOn(
      sharer.sdk,
      {
        title: "Live check: shareable code",
        description: "Automated end-to-end check",
        category: "coupon",
        faceValueInr: 20,
        priceInr: 10,
      },
      code,
    );
    const id = listing.dealId;
    const paid = await runDealAction(seeker.sdk, { id }, "PAY");
    expect(paid.deal.status === "Delivered", `status ${paid.deal.status}`);
    const revealed = await seeker.sdk.api.deals.code(id);
    expect(revealed.code === code, "revealed code differs");
    const done = await runDealAction(seeker.sdk, { id }, "CONFIRM");
    expect(done.deal.status === "Completed", `status ${done.deal.status}`);
    return `deal #${id} Completed, code revealed to the Seeker only`;
  });

  await check("cheat: the same code listed twice", async () => {
    const error = await listPassOn(
      sharer.sdk,
      {
        title: "Same code again",
        description: "",
        category: "coupon",
        faceValueInr: 20,
        priceInr: 10,
      },
      code.toLowerCase(),
    ).catch((caught: unknown) => caught);
    expect(error instanceof ApiError && error.code === "CONFLICT", `got ${String(error)}`);
    return "refused (CONFLICT)";
  });

  await check("cheat: a price over the badge limit", async () => {
    const error = await listBuyForYou(sharer.sdk, {
      title: "Too expensive",
      description: "",
      category: "ecommerce",
      faceValueInr: 900,
      priceInr: 800,
    }).catch((caught: unknown) => caught);
    expect(
      error instanceof ChainError && error.reason === "DealValueAboveLimit",
      `got ${String(error)}`,
    );
    return "refused before signing (DealValueAboveLimit)";
  });

  await check("dispute ruled by the admin", async () => {
    const { listing } = await listBuyForYou(sharer.sdk, {
      title: "Live check: disputed order",
      description: "Automated end-to-end check",
      category: "ecommerce",
      faceValueInr: 30,
      priceInr: 20,
    });
    const id = listing.dealId;
    await runDealAction(seeker.sdk, { id }, "PAY", { details: DETAILS });
    await runDealAction(sharer.sdk, { id }, "MARK_DELIVERED", { proof: { orderId: "LIVE-2" } });
    await raiseDispute(seeker.sdk, id, {
      claim: "not_as_described",
      text: "Live check: wrong item",
    });
    const queue = await admin.admin.disputes();
    expect(
      queue.items.some((item) => item.dealId === id),
      "dispute not in the admin queue",
    );
    const ruling = await admin.admin.resolve(id, {
      seekerShareBps: 10_000,
      faultParty: "Sharer",
      reason: "Live check: the Sharer delivered the wrong item",
    });
    const deal = await seeker.sdk.api.deals.get(id);
    expect(deal.status === "Resolved", `status ${deal.status}`);
    return `deal #${id} Resolved for the Seeker (${ruling.txUrl})`;
  });

  if (env.LIVE_TIMEOUT === "1") {
    await check("refund after the delivery deadline", async () => {
      const { listing } = await listBuyForYou(sharer.sdk, {
        title: "Live check: never delivered",
        description: "Automated end-to-end check",
        category: "ecommerce",
        faceValueInr: 20,
        priceInr: 10,
      });
      const id = listing.dealId;
      const locked = await runDealAction(seeker.sdk, { id }, "PAY", { details: DETAILS });
      const deliverBy = Number(locked.deal.deadlines.deliverBy ?? 0) * 1000;
      const wait = Math.max(0, deliverBy - Date.now()) + 15_000;
      console.log(`  waiting ${Math.round(wait / 1000)} s for the delivery deadline…`);
      await new Promise((resolve) => setTimeout(resolve, wait));
      const refunded = await runDealAction(seeker.sdk, { id }, "CLAIM_REFUND");
      expect(refunded.deal.status === "Refunded", `status ${refunded.deal.status}`);
      return `deal #${id} Refunded to the Seeker`;
    });
  }

  const after = (await balance(sharer)) + (await balance(seeker));
  console.log(`  Spent by both test accounts: ${formatEther(before - after)} MSTC (gas and fees)`);
}

async function main(): Promise<void> {
  const fileEnv = parse(readFileSync(path.join(__dirname, "..", ".env")));
  const extra = process.env.LIVE_ENV_FILE ? parse(readFileSync(process.env.LIVE_ENV_FILE)) : {};
  const env: Env = { ...fileEnv, ...extra, ...process.env };
  const base = (env.LIVE_URL ?? "https://sakar-app.vercel.app").replace(/\/$/, "");
  console.log(`Checking ${base}`);
  await readOnlyChecks(base, env);
  if (env.LIVE_DEALS === "1") await dealChecks(base, env);
  const failed = results.filter((result) => !result.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  if (failed) process.exitCode = 1;
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  // The wallet's auto-lock timer would keep the process alive.
  .finally(() => process.exit());
