import { randomBytes, randomUUID } from "crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { Hex } from "viem";
import { POST as authorizeRoute } from "@/app/api/codes/authorize/route";
import { GET as codeRoute } from "@/app/api/deals/[id]/code/route";
import {
  GET as getDetailsRoute,
  POST as postDetailsRoute,
} from "@/app/api/deals/[id]/details/route";
import { GET as invoiceRoute } from "@/app/api/deals/[id]/invoice/route";
import { GET as getProofRoute, POST as postProofRoute } from "@/app/api/deals/[id]/proof/route";
import { GET as dealRoute } from "@/app/api/deals/[id]/route";
import { purgeExpiredPrivateData } from "@/server/deals/retention";
import { db } from "@/server/firebaseAdmin";
import { callRoute, onboard, resetEmulators, useIntegrationEnv } from "../helpers/integration";
import {
  acceptOnChain,
  confirmOnChain,
  createListingOnChain,
  listingInput,
  markDeliveredOnChain,
  openBuyForYou,
  publishListing,
  readDealOnChain,
  type User,
} from "../helpers/deals";

const silence = (["log", "warn", "error"] as const).map((method) =>
  vi.spyOn(console, method).mockImplementation(() => undefined),
);

let sharer: User;
let seeker: User;
let outsider: User;

const DETAILS = {
  name: "Rahul Verma",
  phone: "+16505550199",
  addressLines: ["Flat 12, Lotus Residency", "Pimpri, Pune"],
  pincode: "411018",
};
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  randomBytes(2048),
]);

beforeAll(async () => {
  useIntegrationEnv();
  await resetEmulators();
  [sharer, seeker, outsider] = [await onboard(), await onboard(), await onboard()];
  return () => silence.forEach((spy) => spy.mockRestore());
});

const params = (id: bigint) => ({ id: id.toString() });

/** POST multipart/form-data to the proof route. */
async function postProofMultipart(
  user: User,
  id: bigint,
  fields: Record<string, string>,
  file?: { bytes: Buffer; type: string },
) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  if (file)
    form.set("invoice", new Blob([new Uint8Array(file.bytes)], { type: file.type }), "invoice");
  const req = new NextRequest(`http://localhost:3000/api/deals/${id}/proof`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${user.idToken}`,
      "idempotency-key": `proof-${randomUUID()}`,
    },
    body: form,
  });
  const res = await postProofRoute(req, { params: Promise.resolve(params(id)) });
  return { status: res.status, body: await res.json() };
}

async function accessLog(dealId: bigint) {
  const snapshot = await db().collection(`deals/${dealId}/access`).get();
  return snapshot.docs.map((doc) => doc.data());
}

describe("Buy-for-you private data", () => {
  let id: bigint;
  let proofHash: Hex;

  it("denies details and proof before the payment is locked", async () => {
    id = await openBuyForYou(sharer);
    const early = await callRoute(postDetailsRoute, {
      token: seeker.idToken,
      params: params(id),
      body: DETAILS,
    });
    expect(early.status).toBe(403); // not the seeker yet
    const sharerRead = await callRoute(getDetailsRoute, {
      token: sharer.idToken,
      params: params(id),
    });
    expect(sharerRead.status).toBe(409);
    expect(sharerRead.body.error.code).toBe("CHAIN_STATE_MISMATCH");
    const proof = await callRoute(postProofRoute, {
      token: sharer.idToken,
      params: params(id),
      body: { orderId: "OD-1" },
    });
    expect(proof.status).toBe(409);
  });

  it("lets only the seeker write and only the sharer read the delivery details", async () => {
    await acceptOnChain(seeker, id);
    expect(
      (
        await callRoute(postDetailsRoute, {
          token: outsider.idToken,
          params: params(id),
          body: DETAILS,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await callRoute(postDetailsRoute, {
          token: sharer.idToken,
          params: params(id),
          body: DETAILS,
        })
      ).status,
    ).toBe(403);
    const invalid = await callRoute(postDetailsRoute, {
      token: seeker.idToken,
      params: params(id),
      body: { ...DETAILS, pincode: "12" },
    });
    expect(invalid.status).toBe(400);
    const saved = await callRoute(postDetailsRoute, {
      token: seeker.idToken,
      params: params(id),
      body: DETAILS,
    });
    expect(saved.status).toBe(200);

    expect(
      (await callRoute(getDetailsRoute, { token: seeker.idToken, params: params(id) })).status,
    ).toBe(403);
    expect(
      (await callRoute(getDetailsRoute, { token: outsider.idToken, params: params(id) })).status,
    ).toBe(403);
    const read = await callRoute<{ details: typeof DETAILS }>(getDetailsRoute, {
      token: sharer.idToken,
      params: params(id),
    });
    expect(read.status).toBe(200);
    expect(read.body.data.details).toEqual(DETAILS);

    const stored = JSON.stringify((await db().doc(`deals/${id}/private/details`).get()).data());
    expect(stored).not.toContain("Rahul");
    expect(stored).not.toContain("411018");
    const log = await accessLog(id);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ uid: sharer.uid, role: "sharer", kind: "details" });
    expect(Object.keys(log[0]).sort()).toEqual(["at", "kind", "role", "serverTime", "uid"]);
  });

  it("validates invoice uploads by sniffing the bytes", async () => {
    const exe = await postProofMultipart(
      sharer,
      id,
      { orderId: "OD-402-1" },
      { bytes: Buffer.from("MZ\x90\x00 not an image"), type: "image/png" },
    );
    expect(exe.status).toBe(400);
    const mismatch = await postProofMultipart(
      sharer,
      id,
      { orderId: "OD-402-1" },
      { bytes: PNG, type: "application/pdf" },
    );
    expect(mismatch.status).toBe(400);
    const huge = Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)]);
    const tooBig = await postProofMultipart(
      sharer,
      id,
      { orderId: "OD-402-1" },
      { bytes: huge, type: "image/png" },
    );
    expect(tooBig.status).toBe(400);
    const notSharer = await postProofMultipart(seeker, id, { orderId: "OD-402-1" });
    expect(notSharer.status).toBe(403);
  });

  it("returns a proofHash that equals the contract's stored proofHash after markDelivered", async () => {
    const res = await postProofMultipart(
      sharer,
      id,
      { orderId: "OD-402-7781", notes: "Ships tomorrow" },
      { bytes: PNG, type: "image/png" },
    );
    expect(res.status).toBe(200);
    proofHash = res.body.data.proofHash;
    expect(proofHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(res.body.data.invoice).toEqual({ contentType: "image/png", size: PNG.length });

    const early = await callRoute(getProofRoute, { token: seeker.idToken, params: params(id) });
    expect(early.status).toBe(409);

    await markDeliveredOnChain(sharer, id, proofHash);
    expect((await readDealOnChain(sharer, id)).proofHash).toBe(proofHash);

    const proof = await callRoute<{
      orderId: string;
      notes: string;
      matchesChain: boolean;
      invoice: { path: string };
    }>(getProofRoute, { token: seeker.idToken, params: params(id) });
    expect(proof.status).toBe(200);
    expect(proof.body.data).toMatchObject({
      orderId: "OD-402-7781",
      notes: "Ships tomorrow",
      matchesChain: true,
    });
    expect(proof.body.data.invoice.path).toBe(`/api/deals/${id}/invoice`);

    const late = await callRoute(postProofRoute, {
      token: sharer.idToken,
      params: params(id),
      body: { orderId: "OD-2" },
    });
    expect(late.status).toBe(409);
  });

  it("serves the invoice to the parties only", async () => {
    const req = (token: string) =>
      new NextRequest(`http://localhost:3000/api/deals/${id}/invoice`, {
        headers: { authorization: `Bearer ${token}` },
      });
    const res = await invoiceRoute(req(seeker.idToken), { params: Promise.resolve(params(id)) });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(Buffer.from(await res.arrayBuffer()).equals(PNG)).toBe(true);
    expect(
      (await invoiceRoute(req(outsider.idToken), { params: Promise.resolve(params(id)) })).status,
    ).toBe(403);

    const chunks = await db().collectionGroup("chunks").get();
    for (const chunk of chunks.docs) {
      expect(Buffer.from(chunk.get("data")).includes(PNG.subarray(8, 64))).toBe(false); // stored encrypted
    }
  });

  it("purges private data 7 days after the deal ends", async () => {
    await confirmOnChain(seeker, id);
    await callRoute(dealRoute, { token: seeker.idToken, params: params(id) }); // syncs terminalAt
    expect(await purgeExpiredPrivateData()).not.toContain(id.toString()); // not yet due
    const purged = await purgeExpiredPrivateData({ now: Date.now() + 8 * 24 * 60 * 60_000 });
    expect(purged).toContain(id.toString());
    expect((await db().doc(`deals/${id}/private/details`).get()).exists).toBe(false);
    expect((await db().doc(`deals/${id}/private/proof`).get()).exists).toBe(false);
    expect((await db().collection(`deals/${id}/files`).get()).size).toBe(0);
    expect((await db().doc(`deals/${id}`).get()).get("piiPurgedAt")).toEqual(expect.any(Number));
    expect(await purgeExpiredPrivateData({ now: Date.now() + 8 * 24 * 60 * 60_000 })).not.toContain(
      id.toString(),
    );
  });
});

describe("Pass-on Code Vault", () => {
  it("reveals the code to the paying seeker only, once timestamped and every time logged", async () => {
    const auth = await callRoute<{
      fingerprint: Hex;
      auth: { nonce: string; deadline: string; signature: Hex };
    }>(authorizeRoute, { token: sharer.idToken, body: { code: "save50now", category: "coupon" } });
    const input = listingInput({
      title: "Rs 50 off a food order",
      category: "coupon",
      faceValueInr: 50,
      priceInr: 20,
    });
    const id = await createListingOnChain(sharer, input, 5, auth.body.data);
    expect((await publishListing(sharer, id, input)).status).toBe(201);

    const beforePay = await callRoute(codeRoute, { token: seeker.idToken, params: params(id) });
    expect(beforePay.status).toBe(403);

    await acceptOnChain(seeker, id);
    const first = await callRoute<{ code: string; firstRevealedAt: string }>(codeRoute, {
      token: seeker.idToken,
      params: params(id),
    });
    expect(first.status).toBe(200);
    expect(first.headers.get("cache-control")).toBe("no-store");
    expect(first.body.data.code).toBe("SAVE50NOW");
    const second = await callRoute<{ code: string; firstRevealedAt: string }>(codeRoute, {
      token: seeker.idToken,
      params: params(id),
    });
    expect(second.body.data.firstRevealedAt).toBe(first.body.data.firstRevealedAt);

    expect((await callRoute(codeRoute, { token: sharer.idToken, params: params(id) })).status).toBe(
      403,
    );
    expect(
      (await callRoute(codeRoute, { token: outsider.idToken, params: params(id) })).status,
    ).toBe(403);

    const vault = (await db().doc(`vault/${auth.body.data.fingerprint}`).get()).data();
    expect(vault).toMatchObject({
      status: "revealed",
      revealedAt: Date.parse(first.body.data.firstRevealedAt),
    });
    const log = (await accessLog(id)).filter((entry) => entry.kind === "code");
    expect(log).toHaveLength(2);
  });

  it("refuses a code request on a Buy-for-you deal", async () => {
    const id = await openBuyForYou(sharer, { title: "Another offer" });
    await acceptOnChain(seeker, id);
    expect((await callRoute(codeRoute, { token: seeker.idToken, params: params(id) })).status).toBe(
      423,
    );
  });
});
