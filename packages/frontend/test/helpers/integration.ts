import { randomUUID } from "crypto";
import { NextRequest } from "next/server";
import { inject } from "vitest";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  type Address,
  type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { hardhat } from "viem/chains";
import { resetChainClientForTests } from "@/src/server/chain";
import { resetKeyringForTests } from "@/src/server/crypto";
import { setRouteServicesForTests } from "@/src/server/services";
import { resetTxManagersForTests } from "@/src/server/signer";
import { applyEnv, testEnv } from "./env";

/** Helpers for tests that run against the local Hardhat node and the Firebase emulators. */

const PROJECT_ID = "demo-rewardrelay";

export function chainFixture() {
  return inject("chain");
}

/** Points the server modules at the local chain + emulators and clears every cached client. */
export function useIntegrationEnv(overrides: Record<string, string> = {}): Record<string, string> {
  const chain = chainFixture();
  const env = testEnv({
    MST_RPC_URL: chain.rpcUrl,
    MST_CHAIN_ID: String(chain.chainId),
    ESCROW_ADDRESS: chain.escrow,
    SBT_ADDRESS: chain.sbt,
    VERIFIER_PRIVATE_KEY: chain.verifierKey,
    FUNDER_PRIVATE_KEY: chain.funderKey,
    RELEASER_PRIVATE_KEY: chain.releaserKey,
    ...overrides,
  });
  applyEnv(env);
  resetChainClientForTests();
  resetTxManagersForTests();
  resetKeyringForTests();
  setRouteServicesForTests(undefined);
  return env;
}

export function localClients(account?: PrivateKeyAccount) {
  const chain = chainFixture();
  const viemChain = { ...hardhat, rpcUrls: { default: { http: [chain.rpcUrl] } } };
  const transport = http(chain.rpcUrl);
  return {
    publicClient: createPublicClient({ chain: viemChain, transport }),
    walletClient: createWalletClient({
      account: account ?? privateKeyToAccount(chain.adminKey),
      chain: viemChain,
      transport,
    }),
  };
}

/** A fresh wallet funded from Hardhat account #0 (for gas in tests that send user transactions). */
export async function fundedWallet(value = parseEther("1")): Promise<PrivateKeyAccount> {
  const account = privateKeyToAccount(generatePrivateKey());
  const { publicClient, walletClient } = localClients();
  const hash = await walletClient.sendTransaction({ to: account.address, value });
  await publicClient.waitForTransactionReceipt({ hash });
  return account;
}

function authEmulator(): string {
  const host = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  if (!host)
    throw new Error("FIREBASE_AUTH_EMULATOR_HOST is not set: run via `npm run test:emulators`.");
  return `http://${host}`;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as T & { error?: { message: string } };
  if (!res.ok) throw new Error(`Auth emulator: ${json.error?.message ?? res.status}`);
  return json;
}

/**
 * Real phone sign-in against the Auth emulator: send code → read it from the emulator → sign in.
 * Returns the Firebase ID token (with the phone_number claim) and the uid.
 */
export async function signInWithPhone(
  phoneNumber: string,
): Promise<{ idToken: string; uid: string }> {
  const base = authEmulator();
  const api = `${base}/identitytoolkit.googleapis.com/v1`;
  const sent = await postJson<{ sessionInfo: string }>(
    `${api}/accounts:sendVerificationCode?key=fake-api-key`,
    { phoneNumber, recaptchaToken: "emulator" },
  );
  const codes = await (
    await fetch(`${base}/emulator/v1/projects/${PROJECT_ID}/verificationCodes`)
  ).json();
  const code = (
    codes.verificationCodes as { phoneNumber: string; sessionInfo: string; code: string }[]
  ).find((entry) => entry.sessionInfo === sent.sessionInfo)?.code;
  if (!code) throw new Error("Auth emulator: verification code not found");
  const signedIn = await postJson<{ idToken: string; localId: string }>(
    `${api}/accounts:signInWithPhoneNumber?key=fake-api-key`,
    { sessionInfo: sent.sessionInfo, code },
  );
  return { idToken: signedIn.idToken, uid: signedIn.localId };
}

/** Fictional numbers in the reserved 555-01xx range (never real or Firebase-console test numbers). */
let phoneCounter = 0;
export function fakePhone(): string {
  phoneCounter++;
  return `+165055501${String(phoneCounter).padStart(2, "0")}`;
}

/** Wipes the Auth and Firestore emulators (call once per test file, before anything else). */
export async function resetEmulators(): Promise<void> {
  const firestore = process.env.FIRESTORE_EMULATOR_HOST;
  await fetch(`${authEmulator()}/emulator/v1/projects/${PROJECT_ID}/accounts`, {
    method: "DELETE",
  });
  if (firestore) {
    await fetch(
      `http://${firestore}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
      {
        method: "DELETE",
      },
    );
  }
  phoneCounter = 0;
}

type Handler = (req: NextRequest, ctx: { params: Record<string, string> }) => Promise<Response>;

/** Calls a route handler directly with a JSON body, bearer token and (optional) idempotency key. */
export async function callRoute<T = unknown>(
  handler: Handler,
  init: {
    method?: string;
    token?: string;
    body?: unknown;
    params?: Record<string, string>;
    idempotencyKey?: string | false;
    headers?: Record<string, string>;
    url?: string;
  } = {},
): Promise<{
  status: number;
  body: { ok: boolean; data: T; error: { code: string; message: string } };
  headers: Headers;
}> {
  const method = init.method ?? (init.body === undefined ? "GET" : "POST");
  const headers: Record<string, string> = { ...init.headers };
  if (init.token) headers.authorization = `Bearer ${init.token}`;
  if (init.body !== undefined) headers["content-type"] = "application/json";
  if (init.idempotencyKey !== false && method !== "GET") {
    headers["idempotency-key"] = init.idempotencyKey ?? `test-${randomUUID()}`;
  }
  const req = new NextRequest(init.url ?? "http://localhost:3000/api/test", {
    method,
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const res = await handler(req, { params: init.params ?? {} });
  return { status: res.status, body: await res.json(), headers: res.headers };
}

export async function balanceOf(address: Address): Promise<bigint> {
  return localClients().publicClient.getBalance({ address });
}

export type { Hex };

/** A phone-verified user with a linked, gas-funded wallet holding a Trust Badge. */
export async function onboard(value = parseEther("1")) {
  const [{ POST: challengeRoute }, { POST: linkRoute }] = await Promise.all([
    import("@/app/api/auth/challenge/route"),
    import("@/app/api/auth/link-wallet/route"),
  ]);
  const { idToken, uid } = await signInWithPhone(fakePhone());
  const account = await fundedWallet(value);
  const challenge = await callRoute<{ message: string }>(challengeRoute, {
    token: idToken,
    body: { address: account.address },
  });
  const signature = await account.signMessage({ message: challenge.body.data.message });
  const linked = await callRoute(linkRoute, {
    token: idToken,
    body: { address: account.address, message: challenge.body.data.message, signature },
  });
  if (linked.status !== 200) throw new Error(`onboard failed: ${JSON.stringify(linked.body)}`);
  const clients = localClients(account);
  return { idToken, uid, account, ...clients };
}
