import "server-only";
import { latestBlock, readDeal, type OnChainDeal } from "../chain";
import { TtlCache } from "../cache";
import { AppError } from "../errors";
import { revertName } from "../signer";

/**
 * Concurrent public views of one deal share a single read. Nothing is reused once it has finished,
 * so a view is never older than the moment its request arrived.
 */
const sharedReads = new TtlCache<OnChainDeal>({ ttlMs: 0, max: 1_000 });

/**
 * Reads a deal or throws NOT_FOUND for an unknown id. `shared`: for public views only; a privileged
 * action (reveal, proof, ruling) always makes its own read.
 */
export async function readDealOrThrow(
  id: bigint,
  options: { shared?: boolean } = {},
): Promise<OnChainDeal> {
  try {
    return options.shared
      ? await sharedReads.get(id.toString(), () => readDeal(id))
      : await readDeal(id);
  } catch (error) {
    if (revertName(error) === "DealNotFound")
      throw new AppError("NOT_FOUND", { message: "This deal does not exist." });
    throw error;
  }
}

/** Latest block timestamp: the clock the contract's guards use (seconds; shared for up to 1.5 s). */
export async function chainNow(): Promise<number> {
  return (await latestBlock()).timestamp;
}
