import { randomBytes, randomUUID } from "crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { Hex } from "viem";
import { reputationSbtAbi } from "@rewardrelay/shared";
import { GET as fileRoute } from "@/app/api/admin/disputes/[id]/files/[fileId]/route";
import { POST as resolveRoute } from "@/app/api/admin/disputes/[id]/resolve/route";
import { GET as adminListRoute } from "@/app/api/admin/disputes/route";
import { POST as proofRoute } from "@/app/api/deals/[id]/proof/route";
import { POST as evidenceRoute } from "@/app/api/disputes/[id]/evidence/route";
import type { AdminDisputeView } from "@/server/disputes/admin";
import { db } from "@/server/firebaseAdmin";
import {
  balanceOf,
  callRoute,
  chainFixture,
  fakePhone,
  onboard,
  resetEmulators,
  signInWithPhone,
  useIntegrationEnv,
} from "../helpers/integration";
import {
  acceptOnChain,
  addEvidenceOnChain,
  markDeliveredOnChain,
  openBuyForYou,
  raiseDisputeOnChain,
  readDealOnChain,
  type User,
} from "../helpers/deals";

const silence = (["log", "warn", "error"] as const).map((method) =>
  vi.spyOn(console, method).mockImplementation(() => undefined),
);

let admin: { idToken: string; uid: string };
let sharer: User;
let seeker: User;
let outsider: User;
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  randomBytes(512),
]);

beforeAll(async () => {
  await resetEmulators();
  admin = await signInWithPhone(fakePhone());
  useIntegrationEnv({ ADMIN_UIDS: admin.uid });
  [sharer, seeker, outsider] = [await onboard(), await onboard(), await onboard()];
  return () => silence.forEach((spy) => spy.mockRestore());
});

const params = (id: bigint) => ({ id: id.toString() });

async function postEvidence(
  user: User,
  id: bigint,
  claim: string,
  text: string,
  files: Buffer[] = [],
) {
  const form = new FormData();
  form.set("claim", claim);
  form.set("text", text);
  for (const file of files)
    form.append("files", new Blob([new Uint8Array(file)], { type: "image/png" }), "photo.png");
  const req = new NextRequest(`http://localhost:3000/api/disputes/${id}/evidence`, {
    method: "POST",
    headers: { authorization: `Bearer ${user.idToken}`, "idempotency-key": `ev-${randomUUID()}` },
    body: form,
  });
  const res = await evidenceRoute(req, { params: Promise.resolve(params(id)) });
  return { status: res.status, body: await res.json() };
}

/** A Buy-for-you deal that is paid and delivered with a valid order proof. */
async function deliveredDeal(priceInr = 400): Promise<bigint> {
  const id = await openBuyForYou(sharer, {
    title: `Dispute test ${randomUUID().slice(0, 8)}`,
    priceInr,
  });
  await acceptOnChain(seeker, id);
  const proof = await callRoute<{ proofHash: Hex }>(proofRoute, {
    token: sharer.idToken,
    params: params(id),
    body: { orderId: "OD-999-1234" },
  });
  await markDeliveredOnChain(sharer, id, proof.body.data.proofHash);
  return id;
}

describe("dispute evidence", () => {
  it("is limited to the parties, the right status and three files", async () => {
    const id = await deliveredDeal();
    expect((await postEvidence(outsider, id, "other", "I am not part of this deal")).status).toBe(
      403,
    );
    const sharerEarly = await postEvidence(
      sharer,
      id,
      "delivered_as_agreed",
      "Nothing to dispute yet",
    );
    expect(sharerEarly.status).toBe(409);
    const tooMany = await postEvidence(seeker, id, "not_delivered", "Too many photos", [
      PNG,
      PNG,
      PNG,
      PNG,
    ]);
    expect(tooMany.status).toBe(400);
    const badClaim = await postEvidence(seeker, id, "made_up_claim", "Unknown claim type");
    expect(badClaim.status).toBe(400);
  });
});

describe("arbitration", () => {
  let id: bigint;
  let view: AdminDisputeView;

  it("collects both parties' evidence and shows it to the admin with a suggestion", async () => {
    id = await deliveredDeal();
    const seekerEvidence = await postEvidence(
      seeker,
      id,
      "not_as_described",
      "A different model arrived",
      [PNG],
    );
    expect(seekerEvidence.status).toBe(200);
    expect(seekerEvidence.body.data.onChainAction).toBe("raiseDispute");
    await raiseDisputeOnChain(seeker, id, seekerEvidence.body.data.evidenceHash);

    const sharerEvidence = await postEvidence(
      sharer,
      id,
      "delivered_as_agreed",
      "The invoice shows the ordered model",
    );
    expect(sharerEvidence.body.data.onChainAction).toBe("addEvidence");
    await addEvidenceOnChain(sharer, id, sharerEvidence.body.data.evidenceHash);

    expect((await callRoute(adminListRoute, { token: seeker.idToken })).status).toBe(403);
    expect((await callRoute(adminListRoute, {})).status).toBe(401);

    const list = await callRoute<{ items: AdminDisputeView[] }>(adminListRoute, {
      token: admin.idToken,
    });
    expect(list.status).toBe(200);
    view = list.body.data.items.find((item) => item.dealId === id.toString())!;
    expect(view).toBeDefined();
    expect(view.deal.status).toBe("Disputed");
    expect(view.evidence.map((item) => [item.party, item.claim, item.committedOnChain])).toEqual([
      ["seeker", "not_as_described", true],
      ["sharer", "delivered_as_agreed", true],
    ]);
    expect(view.evidence[0].text).toBe("A different model arrived");
    expect(view.onChainEvidence.every((item) => item.matched)).toBe(true);
    expect(view.proof).toMatchObject({
      submitted: true,
      matchesChain: true,
      orderId: "OD-999-1234",
    });
    expect(view.suggestion).toMatchObject({
      outcome: "SPLIT",
      seekerShareBps: 5000,
      faultParty: "None",
    });

    const file = view.evidence[0].files[0];
    const download = await fileRoute(
      new NextRequest(`http://localhost:3000${file.path}`, {
        headers: { authorization: `Bearer ${admin.idToken}` },
      }),
      { params: Promise.resolve({ id: id.toString(), fileId: file.fileId }) },
    );
    expect(Buffer.from(await download.arrayBuffer()).equals(PNG)).toBe(true);
  });

  it("resolves on-chain with the exact money flow, a fault and an audit record", async () => {
    const { treasury, sbt } = chainFixture();
    const deal = await readDealOnChain(sharer, id);
    const before = {
      sharer: await balanceOf(sharer.account.address),
      seeker: await balanceOf(seeker.account.address),
      treasury: await balanceOf(treasury),
    };
    const body = {
      seekerShareBps: 7000,
      faultParty: "Sharer",
      reason: "Photos show a different model",
    };

    expect(
      (await callRoute(resolveRoute, { token: seeker.idToken, params: params(id), body })).status,
    ).toBe(403);
    const res = await callRoute<{ status: string; txHash: Hex; auditId: string }>(resolveRoute, {
      token: admin.idToken,
      params: params(id),
      body,
      idempotencyKey: "resolve-key-0001",
    });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("Resolved");

    // docs/protocol.md §3, Resolved with fault Sharer: seeker Pk + Dk + Ds, sharer Pr − fee, treasury fee.
    const pk = (deal.price * 7000n) / 10_000n;
    const pr = deal.price - pk;
    const fee = (pr * BigInt(deal.feeBps)) / 10_000n;
    expect((await balanceOf(seeker.account.address)) - before.seeker).toBe(
      pk + deal.seekerDeposit + deal.sharerDeposit,
    );
    expect((await balanceOf(sharer.account.address)) - before.sharer).toBe(pr - fee);
    expect((await balanceOf(treasury)) - before.treasury).toBe(fee);
    expect((await readDealOnChain(sharer, id)).status).toBe(6);
    const trust = await sharer.publicClient.readContract({
      address: sbt,
      abi: reputationSbtAbi,
      functionName: "trustOf",
      args: [sharer.account.address],
    });
    expect(trust[3]).toBe(1); // disputesLost

    const audit = await db().collection("audit").where("dealId", "==", id.toString()).get();
    expect(audit.size).toBe(1);
    expect(audit.docs[0].data()).toMatchObject({
      kind: "dispute.resolve",
      adminUid: admin.uid,
      ruling: { seekerShareBps: 7000, faultParty: "Sharer" },
      reason: "Photos show a different model",
      txHash: res.body.data.txHash,
    });

    const replay = await callRoute(resolveRoute, {
      token: admin.idToken,
      params: params(id),
      body,
      idempotencyKey: "resolve-key-0001",
    });
    expect(replay.headers.get("idempotent-replayed")).toBe("true");
    const again = await callRoute(resolveRoute, { token: admin.idToken, params: params(id), body });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("CHAIN_STATE_MISMATCH");

    const list = await callRoute<{ items: AdminDisputeView[] }>(adminListRoute, {
      token: admin.idToken,
    });
    expect(list.body.data.items.map((item) => item.dealId)).not.toContain(id.toString());
  });

  it("refuses to resolve a deal that is not disputed", async () => {
    const locked = await openBuyForYou(sharer, { title: "Not disputed" });
    await acceptOnChain(seeker, locked);
    const res = await callRoute(resolveRoute, {
      token: admin.idToken,
      params: params(locked),
      body: { seekerShareBps: 5000, faultParty: "None", reason: "Should not work" },
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("CHAIN_STATE_MISMATCH");
    const invalid = await callRoute(resolveRoute, {
      token: admin.idToken,
      params: params(locked),
      body: { seekerShareBps: 10_001, faultParty: "None", reason: "Out of range" },
    });
    expect(invalid.status).toBe(400);
  });
});
