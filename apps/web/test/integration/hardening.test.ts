import { beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { Hex } from "viem";
import { GET as fileRoute } from "@/app/api/admin/disputes/[id]/files/[fileId]/route";
import { POST as resolveRoute } from "@/app/api/admin/disputes/[id]/resolve/route";
import { GET as adminListRoute } from "@/app/api/admin/disputes/route";
import { POST as evidenceRoute } from "@/app/api/disputes/[id]/evidence/route";
import { POST as rpcRoute } from "@/app/api/rpc/[network]/route";
import { GET as meRoute } from "@/app/api/me/route";
import { adminAuth } from "@/server/firebaseAdmin";
import { repos } from "@/server/repositories";
import { GET as dealRoute } from "@/app/api/deals/[id]/route";
import {
  callRoute,
  fakePhone,
  onboard,
  resetEmulators,
  signInWithPhone,
  useIntegrationEnv,
} from "../helpers/integration";
import { deliverWithProof, raiseDisputeOnChain, type User } from "../helpers/deals";

const silence = (["log", "warn", "error"] as const).map((method) =>
  vi.spyOn(console, method).mockImplementation(() => undefined),
);

let adminSession: { idToken: string; uid: string };
let admin: User;
let seeker: User;

beforeAll(async () => {
  await resetEmulators();
  adminSession = await signInWithPhone(fakePhone());
  useIntegrationEnv({ ADMIN_UIDS: adminSession.uid });
  admin = await onboard(undefined, adminSession);
  seeker = await onboard();
  return () => silence.forEach((spy) => spy.mockRestore());
});

async function rpc(network: string, body: unknown) {
  const req = new NextRequest(`http://localhost:3000/api/rpc/${network}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  const res = await rpcRoute(req, { params: Promise.resolve({ network }) });
  return { status: res.status, json: await res.json() };
}

describe("JSON-RPC relay", () => {
  it("relays allowed read calls for the configured chain", async () => {
    const res = await rpc("local", { jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ jsonrpc: "2.0", id: 1, result: "0x7a69" });
    const batch = await rpc("local", [
      { jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] },
      { jsonrpc: "2.0", id: 2, method: "eth_gasPrice", params: [] },
    ]);
    expect(batch.status).toBe(200);
    expect(batch.json).toHaveLength(2);
  });

  it("answers other methods with JSON-RPC 'method not found' without reaching the node", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    for (const method of [
      "eth_accounts",
      "eth_sendTransaction",
      "hardhat_setBalance",
      "eth_fillTransaction",
    ]) {
      const res = await rpc("local", { jsonrpc: "2.0", id: 9, method, params: [] });
      expect(res.status, method).toBe(200);
      expect(res.json, method).toMatchObject({ jsonrpc: "2.0", id: 9, error: { code: -32601 } });
    }
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();

    // In a batch, the allowed calls still reach the node; the refused one is answered by the relay.
    const batch = await rpc("local", [
      { jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] },
      { jsonrpc: "2.0", id: 2, method: "eth_fillTransaction", params: [{}] },
    ]);
    expect(batch.status).toBe(200);
    const byId = new Map((batch.json as { id: number }[]).map((reply) => [reply.id, reply]));
    expect(byId.get(1)).toMatchObject({ result: "0x7a69" });
    expect(byId.get(2)).toMatchObject({ error: { code: -32601 } });
  });

  it("refuses other networks, big batches and non-JSON", async () => {
    expect(
      (await rpc("testnet", { jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] })).status,
    ).toBe(404);
    const many = Array.from({ length: 21 }, (_, id) => ({
      jsonrpc: "2.0",
      id,
      method: "eth_chainId",
      params: [],
    }));
    expect((await rpc("local", many)).status).toBe(400);
    expect((await rpc("local", "{not json")).status).toBe(400);
  });
});

describe("admin conflict of interest", () => {
  it("does not let an admin rule on their own deal", async () => {
    const id = await deliverWithProof(admin, seeker);
    const evidence = await callRoute<{ evidenceHash: Hex }>(evidenceRoute, {
      token: seeker.idToken,
      params: { id: id.toString() },
      body: { claim: "not_delivered", text: "The admin never delivered" },
    });
    await raiseDisputeOnChain(seeker, id, evidence.body.data.evidenceHash);
    const res = await callRoute(resolveRoute, {
      token: admin.idToken,
      params: { id: id.toString() },
      body: { seekerShareBps: 0, faultParty: "Seeker", reason: "Ruling in my own favour" },
    });
    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/part of/);

    // Nor can they see the dispute in the desk or open its evidence files.
    const list = await callRoute<{ items: { dealId: string }[] }>(adminListRoute, {
      token: admin.idToken,
    });
    expect(list.status).toBe(200);
    expect(list.body.data.items.map((item) => item.dealId)).not.toContain(id.toString());
    const file = await callRoute(fileRoute, {
      token: admin.idToken,
      params: { id: id.toString(), fileId: "any-file" },
    });
    expect(file.status).toBe(403);
  });
});

describe("session revocation", () => {
  // A token issued in the same second as the revocation still counts as valid (Firebase compares
  // seconds), so each revocation happens a little over a second after sign-in.
  const pause = () => new Promise((resolve) => setTimeout(resolve, 1_100));

  it("refuses a revoked session on writes at once and on reads without a recent check", async () => {
    const user = await signInWithPhone(fakePhone());
    // Authenticated (no wallet yet, so 404).
    expect((await callRoute(meRoute, { token: user.idToken })).status).toBe(404);
    await pause();
    await adminAuth().revokeRefreshTokens(user.uid);
    const stolen = await callRoute(linkRoute, {
      token: user.idToken,
      body: {
        address: "0x000000000000000000000000000000000000dEaD",
        message: "m",
        signature: "0x12",
      },
    });
    expect(stolen.status).toBe(401);

    // A reader whose revocation was not checked recently is refused too. (Reusing a recent check for
    // up to a minute is covered by the RevocationCache unit test: under the emulator the Admin SDK
    // always checks revocation itself.)
    const reader = await signInWithPhone(fakePhone());
    await pause();
    await adminAuth().revokeRefreshTokens(reader.uid);
    expect((await callRoute(meRoute, { token: reader.idToken })).status).toBe(401);
  });
});

describe("graceful degradation", () => {
  it("still serves the deal view from the chain when its off-chain parts fail", async () => {
    const id = await deliverWithProof(admin, seeker);
    const spy = vi
      .spyOn(repos.listings, "get")
      .mockRejectedValue(new Error("Firestore unavailable"));
    const res = await callRoute<{ status: string; listing: unknown; nextAction: string }>(
      dealRoute,
      { params: { id: id.toString() } },
    );
    spy.mockRestore();
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: "Delivered", listing: null });
  });
});

describe("JSON-RPC relay body", () => {
  it("forwards a body rebuilt from the validated calls only", async () => {
    let forwarded = "";
    const spy = vi.spyOn(globalThis, "fetch").mockImplementationOnce(async (_url, init) => {
      forwarded = String(init?.body);
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 7, result: "0x7a69" }));
    });
    // Duplicate and differently-cased keys: JSON.parse keeps the last "method"; some node parsers
    // would read "METHOD". Only the validated fields may reach the node.
    const res = await rpc(
      "local",
      '{"jsonrpc":"2.0","id":7,"method":"eth_accounts","method":"eth_chainId","METHOD":"debug_traceTransaction","extra":1}',
    );
    spy.mockRestore();
    expect(res.status).toBe(200);
    expect(JSON.parse(forwarded)).toEqual({
      jsonrpc: "2.0",
      id: 7,
      method: "eth_chainId",
      params: [],
    });
  });
});
