import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { privateKeyToAccount, generatePrivateKey, type PrivateKeyAccount } from "viem/accounts";
import { POST as challengeRoute } from "@/app/api/auth/challenge/route";
import { POST as linkRoute } from "@/app/api/auth/link-wallet/route";
import { GET as meRoute } from "@/app/api/me/route";
import { GET as getBackupRoute, PUT as putBackupRoute } from "@/app/api/wallet/backup/route";
import { EmbeddedWallet, MemoryKeyStore, decryptPrivateKey } from "@/client/wallet";
import { adminAuth, db } from "@/server/firebaseAdmin";
import { retryFailedTopups } from "@/server/identity/onboarding";
import type { UserView } from "@/server/views/user";
import {
  balanceOf,
  callRoute,
  chainFixture,
  fakePhone,
  localClients,
  resetEmulators,
  signInWithPhone,
  useIntegrationEnv,
} from "../helpers/integration";
import { reputationSbtAbi } from "@rewardrelay/shared";

const silence = (["log", "warn", "error"] as const).map((method) =>
  vi.spyOn(console, method).mockImplementation(() => undefined),
);

let env: Record<string, string>;

beforeAll(async () => {
  env = useIntegrationEnv();
  await resetEmulators();
  return () => silence.forEach((spy) => spy.mockRestore());
});

afterEach(() => {
  vi.useRealTimers();
});

async function challenge(token: string, account: PrivateKeyAccount) {
  const res = await callRoute<{ message: string; nonce: string; expiresAt: string }>(
    challengeRoute,
    {
      token,
      body: { address: account.address },
    },
  );
  expect(res.status).toBe(200);
  return res.body.data;
}

async function link(
  token: string,
  account: PrivateKeyAccount,
  signer = account,
  idempotencyKey?: string,
) {
  const { message } = await challenge(token, account);
  const signature = await signer.signMessage({ message });
  return callRoute<UserView>(linkRoute, {
    token,
    body: { address: account.address, message, signature },
    idempotencyKey,
  });
}

describe("onboarding", () => {
  it("links a verified phone to a new wallet, mints the badge and sends one top-up", async () => {
    const { idToken } = await signInWithPhone(fakePhone());
    const wallet = privateKeyToAccount(generatePrivateKey());

    const res = await link(idToken, wallet);
    expect(res.status).toBe(200);
    const view = res.body.data;
    expect(view.address).toBe(wallet.address);
    expect(view.badge).toMatchObject({
      hasBadge: true,
      status: "minted",
      tier: 0,
      tierName: "New",
    });
    expect(view.badge.maxDealValue.mstc).toBe("0.005");
    expect(view.badge.maxDealValue.inr).toBe(500);
    expect(view.topup?.status).toBe("sent");
    expect(view.balanceWei).toBe(env.TOPUP_WEI);
    expect(view.balanceMstc).toBe("0.002");
    expect(view.balanceInr).toBe(200);

    const onChain = await localClients().publicClient.readContract({
      address: chainFixture().sbt,
      abi: reputationSbtAbi,
      functionName: "hasBadge",
      args: [wallet.address],
    });
    expect(onChain).toBe(true);

    const me = await callRoute<UserView>(meRoute, { token: idToken });
    expect(me.status).toBe(200);
    expect(me.body.data).toMatchObject({ address: wallet.address, balanceWei: env.TOPUP_WEI });
  });

  it("returns NOT_FOUND from /api/me before a wallet is linked", async () => {
    const { idToken } = await signInWithPhone(fakePhone());
    const me = await callRoute(meRoute, { token: idToken });
    expect(me.status).toBe(404);
    expect(me.body.error.code).toBe("NOT_FOUND");
  });

  it("rejects a replayed challenge", async () => {
    const { idToken } = await signInWithPhone(fakePhone());
    const wallet = privateKeyToAccount(generatePrivateKey());
    const { message } = await challenge(idToken, wallet);
    const signature = await wallet.signMessage({ message });
    const body = { address: wallet.address, message, signature };

    expect((await callRoute(linkRoute, { token: idToken, body })).status).toBe(200);
    const replay = await callRoute(linkRoute, { token: idToken, body });
    expect(replay.status).toBe(400);
    expect(replay.body.error.message).toMatch(/already used/);
  });

  it("rejects an expired challenge", async () => {
    const { idToken } = await signInWithPhone(fakePhone());
    const wallet = privateKeyToAccount(generatePrivateKey());
    const { message } = await challenge(idToken, wallet);
    const signature = await wallet.signMessage({ message });

    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 6 * 60_000 });
    const res = await callRoute(linkRoute, {
      token: idToken,
      body: { address: wallet.address, message, signature },
    });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/expired/);
  });

  it("rejects a signature from another key and a challenge issued to another user", async () => {
    const alice = await signInWithPhone(fakePhone());
    const bob = await signInWithPhone(fakePhone());
    const wallet = privateKeyToAccount(generatePrivateKey());

    const forged = await link(alice.idToken, wallet, privateKeyToAccount(generatePrivateKey()));
    expect(forged.status).toBe(403);

    const { message } = await challenge(alice.idToken, wallet);
    const stolen = await callRoute(linkRoute, {
      token: bob.idToken,
      body: { address: wallet.address, message, signature: "0x12" },
    });
    expect(stolen.status).toBe(400);
  });

  it("allows requesting a challenge anonymously for pure Web3 onboarding", async () => {
    const wallet = privateKeyToAccount(generatePrivateKey());
    const anonymous = await callRoute(challengeRoute, { body: { address: wallet.address } });
    expect(anonymous.status).toBe(200);
  });
});

describe("identity updates", () => {
  it("updates user wallet when signing with a verified private key", async () => {
    const phone = fakePhone();
    const alice = await signInWithPhone(phone);
    const w1 = privateKeyToAccount(generatePrivateKey());
    const w2 = privateKeyToAccount(generatePrivateKey());
    expect((await link(alice.idToken, w1)).status).toBe(200);

    // Same account, second wallet.
    const second = await link(alice.idToken, w2);
    expect(second.status).toBe(200);

    // Another phone, Alice's wallet.
    const bob = await signInWithPhone(fakePhone());
    const stolen = await link(bob.idToken, w1);
    expect(stolen.status).toBe(200);

    // Alice deletes her Firebase account and signs up again with the same phone (new uid).
    await adminAuth().deleteUser(alice.uid);
    const again = await signInWithPhone(phone);
    expect(again.uid).not.toBe(alice.uid);
    const farm = await link(again.idToken, privateKeyToAccount(generatePrivateKey()));
    expect(farm.status).toBe(409);
    expect(farm.body.error.message).toMatch(/phone number is already linked/);
  });
});

describe("welcome top-up", () => {
  it("is sent exactly once across concurrent and repeated links", async () => {
    const { idToken, uid } = await signInWithPhone(fakePhone());
    const wallet = privateKeyToAccount(generatePrivateKey());

    const results = await Promise.all([link(idToken, wallet), link(idToken, wallet)]);
    expect(results.map((res) => res.status).sort()).toEqual([200, 200]);
    const again = await link(idToken, wallet);
    expect(again.status).toBe(200);

    expect(await balanceOf(wallet.address)).toBe(BigInt(env.TOPUP_WEI));
    const user = (await db().collection("users").doc(uid).get()).data();
    expect(user?.topup?.status).toBe("sent");
    expect(user?.badge?.status).toBe("minted");
  });

  it("is retried by the keeper after a failure, and only once", async () => {
    const { idToken, uid } = await signInWithPhone(fakePhone());
    const wallet = privateKeyToAccount(generatePrivateKey());
    expect((await link(idToken, wallet)).status).toBe(200);
    const amount = BigInt(env.TOPUP_WEI);
    expect(await balanceOf(wallet.address)).toBe(amount);

    // As if the funder had been empty at sign-up: the claim was recorded as failed, nothing sent.
    const user = db().collection("users").doc(uid);
    await user.update({ topup: { status: "failed", amountWei: env.TOPUP_WEI, at: Date.now() } });
    expect(await retryFailedTopups(5)).toBeGreaterThanOrEqual(1);
    expect(await balanceOf(wallet.address)).toBe(2n * amount);
    expect((await user.get()).data()?.topup?.status).toBe("sent");

    await retryFailedTopups(5);
    expect(await balanceOf(wallet.address)).toBe(2n * amount);
  });

  it("replays the stored response for a repeated Idempotency-Key", async () => {
    const { idToken } = await signInWithPhone(fakePhone());
    const wallet = privateKeyToAccount(generatePrivateKey());
    const { message } = await challenge(idToken, wallet);
    const signature = await wallet.signMessage({ message });
    const request = {
      token: idToken,
      body: { address: wallet.address, message, signature },
      idempotencyKey: "link-key-0001",
    };
    const first = await callRoute(linkRoute, request);
    const second = await callRoute(linkRoute, request);
    expect(second.status).toBe(first.status);
    expect(second.headers.get("idempotent-replayed")).toBe("true");
    expect(second.body).toEqual(first.body);
    expect(await balanceOf(wallet.address)).toBe(BigInt(env.TOPUP_WEI));
  });
});

describe("wallet backup", () => {
  it("stores and returns only the PIN-encrypted key", async () => {
    const { idToken, uid } = await signInWithPhone(fakePhone());
    const embedded = new EmbeddedWallet(new MemoryKeyStore());
    const { address, backup } = await embedded.create("482913");
    const account = embedded.getAccount();
    expect((await link(idToken, account)).status).toBe(200);

    const put = await callRoute(putBackupRoute, { method: "PUT", token: idToken, body: backup });
    expect(put.status).toBe(200);
    const got = await callRoute<typeof backup>(getBackupRoute, { token: idToken });
    expect(got.status).toBe(200);
    expect(got.body.data).toMatchObject(backup);

    // The server copy decrypts only with the PIN, and holds no plaintext key.
    const stored = JSON.stringify((await db().collection("walletBackups").doc(uid).get()).data());
    const privateKey = await decryptPrivateKey(backup, "482913");
    expect(stored).not.toContain(privateKey.slice(2));
    expect(stored.toLowerCase()).not.toContain(privateKey.slice(2).toLowerCase());
    expect(privateKeyToAccount(privateKey).address).toBe(address);

    const restored = new EmbeddedWallet(new MemoryKeyStore());
    expect(await restored.restore(got.body.data, "482913")).toBe(address);
  });

  it("refuses raw keys, other addresses and weak KDF settings", async () => {
    const { idToken } = await signInWithPhone(fakePhone());
    const embedded = new EmbeddedWallet(new MemoryKeyStore());
    const { backup } = await embedded.create("135790");
    expect((await link(idToken, embedded.getAccount())).status).toBe(200);

    const raw = await callRoute(putBackupRoute, {
      method: "PUT",
      token: idToken,
      body: { ...backup, ciphertext: generatePrivateKey().slice(2) },
    });
    expect(raw.status).toBe(400);

    const weak = await callRoute(putBackupRoute, {
      method: "PUT",
      token: idToken,
      body: { ...backup, kdf: { ...backup.kdf, iterations: 1000 } },
    });
    expect(weak.status).toBe(400);

    const other = new EmbeddedWallet(new MemoryKeyStore());
    const { backup: otherBackup } = await other.create("135790");
    const foreign = await callRoute(putBackupRoute, {
      method: "PUT",
      token: idToken,
      body: otherBackup,
    });
    expect(foreign.status).toBe(403);
  });
});
