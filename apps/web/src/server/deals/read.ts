import "server-only";
import { latestBlock, readDeal, type OnChainDeal } from "../chain";
import { AppError } from "../errors";
import { revertName } from "../signer";

/** Reads a deal or throws NOT_FOUND for an unknown id. */
export async function readDealOrThrow(id: bigint): Promise<OnChainDeal> {
  try {
    return await readDeal(id);
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
