import "server-only";
import { DealStatus, STATUS_LABELS, STATUS_NAMES } from "@rewardrelay/shared";
import { readDeals } from "../chain";
import { repos } from "../repositories";
import { runQuery } from "../repositories/collection";

export interface MyDealItem {
  dealId: string;
  role: "sharer" | "seeker";
  title: string;
  status: string;
  statusLabel: string;
}

/** The caller's deals (as sharer or seeker) from the index, newest first, statuses read from chain. */
export async function myDeals(uid: string): Promise<{ items: MyDealItem[] }> {
  const [asSharer, asSeeker] = await Promise.all([
    runQuery(
      repos.deals.query().where("sharerUid", "==", uid).limit(50),
      "firestore.query deals by sharer",
    ),
    runQuery(
      repos.deals.query().where("seekerUid", "==", uid).limit(50),
      "firestore.query deals by seeker",
    ),
  ]);
  const roles = new Map<string, "sharer" | "seeker">();
  for (const doc of asSharer.docs) roles.set(doc.id, "sharer");
  for (const doc of asSeeker.docs) roles.set(doc.id, "seeker");
  const ids = [...roles.keys()].sort((a, b) => Number(b) - Number(a));
  const [deals, listings] = await Promise.all([
    readDeals(ids.map(BigInt)),
    Promise.all(ids.map((id) => repos.listings.get(id))),
  ]);
  return {
    items: ids.flatMap((dealId, index) => {
      const deal = deals[index];
      if (!deal) return [];
      const status = deal.status as DealStatus;
      return [
        {
          dealId,
          role: roles.get(dealId)!,
          title: listings[index]?.title ?? `Deal #${dealId}`,
          status: STATUS_NAMES[status],
          statusLabel: STATUS_LABELS[status],
        },
      ];
    }),
  };
}
