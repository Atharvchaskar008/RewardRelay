import { beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  getAbiItem,
  pad,
  toHex,
  toEventSelector,
  zeroAddress,
  type AbiEvent,
  type Hex,
} from "viem";
import { relayEscrowAbi } from "rewardrelay-shared";
import { GET as cronRoute } from "@/app/api/cron/release/route";
import { GET as dealRoute } from "@/app/api/deals/[id]/route";
import { GET as healthRoute } from "@/app/api/health/route";
import { POST as evidenceRoute } from "@/app/api/disputes/[id]/evidence/route";
import { acquireLease, releaseLease } from "@/src/server/cron/lease";
import type { CronSummary } from "@/src/server/cron/release";
import { db } from "@/src/server/firebaseAdmin";
import type { HealthReport } from "@/src/server/health";
import {
  callRoute,
  chainFixture,
  onboard,
  resetEmulators,
  useIntegrationEnv,
} from "../helpers/integration";
import {
  deliverWithProof,
  increaseTime,
  raiseDisputeOnChain,
  readDealOnChain,
  type User,
} from "../helpers/deals";

const silence = (["log", "warn", "error"] as const).map((method) =>
  vi.spyOn(console, method).mockImplementation(() => undefined),
);

let env: Record<string, string>;
let sharer: User;
let seeker: User;

beforeAll(async () => {
  env = useIntegrationEnv();
  await resetEmulators();
  [sharer, seeker] = [await onboard(), await onboard()];
  return () => silence.forEach((spy) => spy.mockRestore());
});

async function cron(secret: string | null = env.CRON_SECRET) {
  const req = new NextRequest("http://localhost:3000/api/cron/release", {
    headers: secret ? { "x-cron-secret": secret } : {},
  });
  const res = await cronRoute(req, { params: {} });
  return { status: res.status, body: (await res.json()) as { ok: boolean; data: CronSummary } };
}

async function eventCount(name: "Completed" | "DisputeResolved", id: bigint) {
  const logs = await sharer.publicClient.request({
    method: "eth_getLogs",
    params: [
      {
        address: chainFixture().escrow,
        topics: [
          toEventSelector(getAbiItem({ abi: relayEscrowAbi, name }) as AbiEvent),
          pad(toHex(id), { size: 32 }),
        ],
        fromBlock: "0x0",
        toBlock: "latest",
      },
    ],
  });
  return (logs as { topics: Hex[] }[]).length;
}

describe("cron auth and lease", () => {
  it("refuses a missing or wrong secret", async () => {
    expect((await cron(null)).status).toBe(403);
    expect((await cron("not-the-secret-but-long-enough-0000000")).status).toBe(403);
    const bearer = await cronRoute(
      new NextRequest("http://localhost:3000/api/cron/release", {
        headers: { authorization: `Bearer ${env.CRON_SECRET}` },
      }),
      { params: {} },
    );
    expect(bearer.status).toBe(200);
  });

  it("admits exactly one holder of a lease at a time", async () => {
    const results = await Promise.all([
      acquireLease("test-lease", "a", 60_000),
      acquireLease("test-lease", "b", 60_000),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const winner = results[0] ? "a" : "b";
    expect(await acquireLease("test-lease", winner === "a" ? "b" : "a", 60_000)).toBe(false);
    await releaseLease("test-lease", winner);
    expect(await acquireLease("test-lease", "c", 60_000)).toBe(true);
  });
});

describe("auto-release", () => {
  it("refreshes the index for a delivery nobody has viewed", async () => {
    const id = await deliverWithProof(sharer, seeker);
    expect((await db().doc(`deals/${id}`).get()).get("status")).toBe("Listed");
    const run = await cron();
    expect(run.body.data.refreshed).toBeGreaterThan(0);
    const index = (await db().doc(`deals/${id}`).get()).data();
    expect(index).toMatchObject({ status: "Delivered", releaseAt: expect.any(Number) });
  });

  it("releases a due deal exactly once even when called twice concurrently", async () => {
    const id = await deliverWithProof(sharer, seeker);
    await cron(); // index learns Delivered + releaseAt
    await increaseTime(sharer, 3 * 60 + 5); // past the demo release delay

    const [a, b] = await Promise.all([cron(), cron()]);
    expect([a.status, b.status]).toEqual([200, 200]);
    const released = [...a.body.data.released, ...b.body.data.released].filter(
      (dealId) => dealId === id.toString(),
    );
    expect(released).toHaveLength(1);
    expect((await readDealOnChain(sharer, id)).status).toBe(3); // Completed
    expect(await eventCount("Completed", id)).toBe(1);

    const third = await cron();
    expect(third.body.data.released).not.toContain(id.toString());
    expect((await db().doc(`deals/${id}`).get()).get("status")).toBe("Completed");
  });

  it("releases on visit when a viewed deal is due", async () => {
    const id = await deliverWithProof(sharer, seeker);
    await increaseTime(sharer, 3 * 60 + 5);
    const view = await callRoute<{ nextAction: string }>(dealRoute, {
      token: seeker.idToken,
      params: { id: id.toString() },
    });
    expect(view.body.data.nextAction).toBe("RELEASE_AVAILABLE");
    const deadline = Date.now() + 15_000;
    let status = Number((await readDealOnChain(sharer, id)).status);
    while (status !== 3 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      status = Number((await readDealOnChain(sharer, id)).status);
    }
    expect(status).toBe(3);
  });

  it("applies the 50/50 default ruling after the arbiter timeout", async () => {
    const id = await deliverWithProof(sharer, seeker);
    const evidence = await callRoute<{ evidenceHash: Hex }>(evidenceRoute, {
      token: seeker.idToken,
      params: { id: id.toString() },
      body: { claim: "not_delivered", text: "Nothing arrived at my address" },
    });
    await raiseDisputeOnChain(seeker, id, evidence.body.data.evidenceHash);
    await cron(); // index learns Disputed
    const deal = await readDealOnChain(sharer, id);
    await increaseTime(sharer, Number(deal.arbiterTimeout) + 5);

    const run = await cron();
    expect(run.body.data.defaultResolved).toContain(id.toString());
    expect((await readDealOnChain(sharer, id)).status).toBe(6); // Resolved
    expect(await eventCount("DisputeResolved", id)).toBe(1);
    const logs = await sharer.publicClient.getContractEvents({
      address: chainFixture().escrow,
      abi: relayEscrowAbi,
      eventName: "DisputeResolved",
      args: { id },
      fromBlock: 0n,
    });
    expect(logs[0].args.arbiter).toBe(zeroAddress);
  });
});

describe("health", () => {
  it("reports chain, Firestore and every signer's balance without secrets", async () => {
    const res = await callRoute<HealthReport>(healthRoute, {});
    expect(res.status).toBe(200);
    const report = res.body.data;
    expect(report.status).toBe("ok");
    expect(report.chain).toMatchObject({ ok: true, chainId: 31337 });
    expect(report.firestore.ok).toBe(true);
    expect(report.signers.map((signer) => signer.role)).toEqual(["verifier", "funder", "releaser"]);
    for (const signer of report.signers) {
      expect(Number(signer.balanceMstc)).toBeGreaterThan(0);
      expect(signer.low).toBe(false);
    }
    const json = JSON.stringify(res.body);
    for (const secret of [
      env.VERIFIER_PRIVATE_KEY,
      env.FUNDER_PRIVATE_KEY,
      env.RELEASER_PRIVATE_KEY,
      env.CRON_SECRET,
    ]) {
      expect(json).not.toContain(secret.slice(2));
    }
  });

  it("warns when a signer runs low", async () => {
    useIntegrationEnv({ SIGNER_LOW_BALANCE_WEI: (10n ** 30n).toString() });
    const report = (await callRoute<HealthReport>(healthRoute, {})).body.data;
    expect(report.status).toBe("degraded");
    expect(report.signers.every((signer) => signer.low)).toBe(true);
  });
});
