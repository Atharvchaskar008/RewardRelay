import "server-only";
import type { Address, Hash } from "viem";
import { weiToInr, weiToMstc } from "rewardrelay-shared";
import {
  escrowContract,
  explorerAddressUrl,
  explorerTxUrl,
  publicClient,
  readTrust,
} from "../chain";
import { serverEnv } from "../env";
import type { UserDoc } from "../repositories";

/** The signed-in user's view, always re-read from the chain (Firestore only adds onboarding state). */

export const TIER_NAMES = ["New", "Trusted", "Verified"] as const;

export interface Money {
  wei: string;
  mstc: string;
  inr: number;
}

export interface UserView {
  address: Address;
  mstscanUrl: string;
  badge: {
    hasBadge: boolean;
    status: "pending" | "minted" | "existing" | "failed" | "none";
    tier: number;
    tierName: string;
    completed: number;
    disputesLost: number;
    relayPoints: string;
    maxDealValue: Money;
    txUrl: string | null;
  };
  tier: number;
  balanceWei: string;
  balanceMstc: string;
  balanceInr: number;
  /** Payouts the escrow could not push (claim with withdraw()). */
  withdrawable: Money;
  topup: {
    status: "pending" | "sent" | "failed";
    amount: Money;
    txUrl: string | null;
  } | null;
}

export function money(wei: bigint): Money {
  return {
    wei: wei.toString(),
    mstc: weiToMstc(wei),
    inr: weiToInr(wei, serverEnv().DEMO_RATE_INR_PER_MSTC),
  };
}

export async function buildUserView(address: Address, user?: UserDoc): Promise<UserView> {
  const [trust, balance, withdrawable] = await Promise.all([
    readTrust(address),
    publicClient().getBalance({ address }),
    escrowContract().read.withdrawable([address]),
  ]);
  const tierName = TIER_NAMES[trust.tier] ?? `Tier ${trust.tier}`;
  const balanceMoney = money(balance);
  return {
    address,
    mstscanUrl: explorerAddressUrl(address),
    badge: {
      hasBadge: trust.hasBadge,
      status: trust.hasBadge
        ? user?.badge?.status === "minted"
          ? "minted"
          : "existing"
        : (user?.badge?.status ?? "none"),
      tier: trust.tier,
      tierName,
      completed: trust.completed,
      disputesLost: trust.disputesLost,
      relayPoints: trust.relayPoints.toString(),
      maxDealValue: money(trust.maxDealValue),
      txUrl: user?.badge?.txHash ? explorerTxUrl(user.badge.txHash as Hash) : null,
    },
    tier: trust.tier,
    balanceWei: balanceMoney.wei,
    balanceMstc: balanceMoney.mstc,
    balanceInr: balanceMoney.inr,
    withdrawable: money(withdrawable),
    topup: user?.topup
      ? {
          status: user.topup.status,
          amount: money(BigInt(user.topup.amountWei)),
          txUrl: user.topup.txHash ? explorerTxUrl(user.topup.txHash as Hash) : null,
        }
      : null,
  };
}
