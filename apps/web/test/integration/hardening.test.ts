import { beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { Hex } from "viem";
import { GET as fileRoute } from "@/app/api/admin/disputes/[id]/files/[fileId]/route";
import { POST as resolveRoute } from "@/app/api/admin/disputes/[id]/resolve/route";
import { GET as adminListRoute } from "@/app/api/admin/disputes/route";
import { POST as evidenceRoute } from "@/app/api/disputes/[id]/evidence/route";
import { POST as rpcRoute } from "@/app/api/rpc/[network]/route";
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

  it("refuses other methods, other networks, big batches and non-JSON", async () => {
    expect(
      (await rpc("local", { jsonrpc: "2.0", id: 1, method: "eth_accounts", params: [] })).status,
    ).toBe(403);
    expect(
      (await rpc("local", { jsonrpc: "2.0", id: 1, method: "eth_sendTransaction", params: [] }))
        .status,
    ).toBe(403);
    expect(
      (await rpc("local", { jsonrpc: "2.0", id: 1, method: "hardhat_setBalance", params: [] }))
        .status,
    ).toBe(403);
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
