import "server-only";
import { randomUUID } from "crypto";
import { DealStatus, STATUS_NAMES, relayEscrowAbi } from "rewardrelay-shared";
import { mapLimit, readDeal, readDeals } from "../chain";
import { syncDealIndex } from "../deals/dealIndex";
import { chainNow } from "../deals/read";
import { purgeExpiredPrivateData } from "../deals/retention";
import { serverEnv } from "../env";
import { AppError } from "../errors";
import { errorFields, log } from "../log";
import { repos } from "../repositories";
import { txManager, type TxResult } from "../signer";
import { acquireLease, releaseLease } from "./lease";

/**
 * The keeper behind GET /api/cron/release (every 2 minutes from cron-job.org):
 * 1. refresh the Firestore deal index for the least recently checked open deals (catches
 *    on-chain changes nobody has viewed yet, e.g. a markDelivered);
 * 2. release() every deal the index lists as Delivered with releaseAt ≤ chain time;
 * 3. defaultResolve() every dispute past its arbiter timeout;
 * 4. purge private data 7 days after a deal ends.
 * Every action re-reads the deal on-chain first. A Firestore lease keeps runs from overlapping, and a
 * second release of the same deal fails in simulation (InvalidStatus) without spending gas.
 */

export const CRON_LEASE = "cron-release";
const LEASE_TTL_MS = 90_000;
const TIME_BUDGET_MS = 45_000;
const MAX_ACTIONS_PER_RUN = 10;
const REFRESH_BATCH = 50;
const OPEN_STATUSES = [
  DealStatus.Listed,
  DealStatus.Locked,
  DealStatus.Delivered,
  DealStatus.Disputed,
].map((status) => STATUS_NAMES[status]);

export interface CronSummary {
  runId: string;
  skipped?: "locked";
  refreshed: number;
  released: string[];
  defaultResolved: string[];
  purged: string[];
  failed: { dealId: string; action: string; reason: string }[];
  durationMs: number;
}

type Action = "release" | "defaultResolve";

async function act(action: Action, id: bigint): Promise<TxResult | "already-settled"> {
  try {
    return await txManager("releaser").writeContract({
      address: serverEnv().ESCROW_ADDRESS,
      abi: relayEscrowAbi,
      functionName: action,
      args: [id],
    });
  } catch (error) {
    const reason = error instanceof AppError ? error.details?.reason : undefined;
    if (reason === "InvalidStatus") return "already-settled";
    throw error;
  }
}

async function refreshIndex(): Promise<number> {
  const snapshot = await repos.deals
    .query()
    .where("status", "in", OPEN_STATUSES)
    .orderBy("updatedAt", "asc")
    .limit(REFRESH_BATCH)
    .get();
  const ids = snapshot.docs.map((doc) => doc.id);
  const deals = await readDeals(ids.map(BigInt));
  const pairs = ids.map((dealId, index) => [dealId, deals[index]] as const);
  await mapLimit(pairs, 8, async ([dealId, deal]) => {
    if (!deal) return;
    await syncDealIndex(dealId, deal);
    await repos.deals.update(dealId, { updatedAt: Date.now() }).catch(() => undefined);
  });
  return ids.length;
}

export async function runReleaseCron(): Promise<CronSummary> {
  const started = Date.now();
  const runId = randomUUID();
  const summary: CronSummary = {
    runId,
    refreshed: 0,
    released: [],
    defaultResolved: [],
    purged: [],
    failed: [],
    durationMs: 0,
  };
  if (!(await acquireLease(CRON_LEASE, runId, LEASE_TTL_MS))) {
    return { ...summary, skipped: "locked", durationMs: Date.now() - started };
  }

  try {
    summary.refreshed = await refreshIndex();
    const now = await chainNow();
    const outOfTime = () => Date.now() - started > TIME_BUDGET_MS;
    let actions = 0;

    const due = await repos.deals
      .query()
      .where("status", "==", STATUS_NAMES[DealStatus.Delivered])
      .where("releaseAt", "<=", now * 1000)
      .limit(MAX_ACTIONS_PER_RUN)
      .get();
    for (const doc of due.docs) {
      if (actions >= MAX_ACTIONS_PER_RUN || outOfTime()) break;
      const id = BigInt(doc.id);
      const deal = await readDeal(id);
      if (deal.status !== DealStatus.Delivered || Number(deal.releaseAt) > now) {
        await syncDealIndex(doc.id, deal);
        continue;
      }
      actions++;
      try {
        const result = await act("release", id);
        if (result !== "already-settled" && result.status === "success")
          summary.released.push(doc.id);
      } catch (error) {
        summary.failed.push({
          dealId: doc.id,
          action: "release",
          reason: errorFields(error).errorMessage as string,
        });
      }
      await syncDealIndex(doc.id, await readDeal(id));
    }

    const disputes = await repos.deals
      .query()
      .where("status", "==", STATUS_NAMES[DealStatus.Disputed])
      .limit(MAX_ACTIONS_PER_RUN)
      .get();
    for (const doc of disputes.docs) {
      if (actions >= MAX_ACTIONS_PER_RUN || outOfTime()) break;
      const id = BigInt(doc.id);
      const deal = await readDeal(id);
      const dueAt = Number(deal.disputeOpenedAt) + Number(deal.arbiterTimeout);
      if (deal.status !== DealStatus.Disputed || now < dueAt) {
        await syncDealIndex(doc.id, deal);
        continue;
      }
      actions++;
      try {
        const result = await act("defaultResolve", id);
        if (result !== "already-settled" && result.status === "success")
          summary.defaultResolved.push(doc.id);
      } catch (error) {
        summary.failed.push({
          dealId: doc.id,
          action: "defaultResolve",
          reason: errorFields(error).errorMessage as string,
        });
      }
      await syncDealIndex(doc.id, await readDeal(id));
    }

    if (!outOfTime()) summary.purged = await purgeExpiredPrivateData();
  } finally {
    await releaseLease(CRON_LEASE, runId).catch(() => undefined);
  }
  summary.durationMs = Date.now() - started;
  log("info", "cron.release", { ...summary, failed: summary.failed.length });
  return summary;
}

const inFlight = new Set<string>();

/**
 * Release-on-visit: when a viewed deal is due, release it in the background (the response does not
 * wait). Best effort only: the cron remains the guarantee, and the UI also offers the button.
 */
export function releaseOnVisit(dealId: string): void {
  if (inFlight.has(dealId)) return;
  inFlight.add(dealId);
  void act("release", BigInt(dealId))
    .then(async () => syncDealIndex(dealId, await readDeal(BigInt(dealId))))
    .catch((error) =>
      log("warn", "deals.release_on_visit_failed", { dealId, ...errorFields(error) }),
    )
    .finally(() => inFlight.delete(dealId));
}
