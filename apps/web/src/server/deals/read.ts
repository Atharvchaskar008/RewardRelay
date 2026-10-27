import "server-only";
import { publicClient, readDeal, type OnChainDeal } from "../chain";
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

/** Latest block timestamp: the clock the contract's guards use (seconds). */
export async function chainNow(): Promise<number> {
  const block = await publicClient().getBlock({ blockTag: "latest" });
  return Number(block.timestamp);
}
