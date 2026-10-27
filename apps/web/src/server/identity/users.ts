import "server-only";
import { getAddress, type Address } from "viem";
import { AppError } from "../errors";
import { repos, type UserDoc } from "../repositories";

/** The caller's linked wallet, or FORBIDDEN when onboarding is not finished. */
export async function requireLinkedUser(uid: string): Promise<UserDoc & { address: Address }> {
  const user = await repos.users.get(uid);
  if (!user) throw new AppError("FORBIDDEN", { message: "Link your wallet first." });
  return { ...user, address: getAddress(user.wallet) };
}

/** The caller's linked wallet address, or null. */
export async function walletOf(uid: string): Promise<Address | null> {
  const user = await repos.users.get(uid);
  return user ? getAddress(user.wallet) : null;
}
