import "server-only";
import { latestBlock, readDeal, type OnChainDeal } from "../chain";
import { AppError } from "../errors";
import { revertName } from "../signer";

/**
 * Reads a deal or throws NOT_FOUND for an unknown id.
 * Active deals are cached for 3 seconds; terminal deals are cached indefinitely.
 */
export async function readDealOrThrow(
  id: bigint,
  options: { shared?: boolean; fresh?: boolean } = {},
): Promise<OnChainDeal> {
  try {
    return await readDeal(id, { fresh: options.fresh });
  } catch (error) {
    if (revertName(error) === "DealNotFound")
      throw new AppError("NOT_FOUND", { message: "This deal does not exist." });
    throw error;
  }
}

/** Latest block timestamp: the clock the contract's guards use (seconds; shared for up to 2.5 s). */
export async function chainNow(): Promise<number> {
  return (await latestBlock()).timestamp;
}
