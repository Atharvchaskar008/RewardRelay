import { ethers } from "ethers";

/**
 * On-chain configuration applied by scripts/configure.ts. Wei values and basis points come from
 * packages/contracts/.env (see .env.example); category policies are defined here because they are
 * protocol configuration, not secrets.
 */

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Mirrors `IRelayEscrow.DealType`. */
export enum DealType {
  BuyForYou = 0,
  PassOn = 1,
}

export interface PolicyValues {
  deliveryWindow: number;
  releaseDelay: number;
  eventBuffer: number;
  disputeWindow: number;
}

export interface CategoryConfig {
  id: number;
  key: string;
  dealType: DealType;
  /** Applied on testnet and locally: windows of minutes so a full deal fits in a demo. */
  demo: PolicyValues;
  /** Documented production values (return/event windows); not applied by the MVP. */
  production: PolicyValues;
}

/**
 * The six MVP categories. Ids are stable on-chain keys; never renumber them.
 * Production windows follow typical return/cancellation windows of each benefit type.
 */
export const CATEGORIES: readonly CategoryConfig[] = [
  {
    id: 0,
    key: "ecommerce",
    dealType: DealType.BuyForYou,
    demo: {
      deliveryWindow: 5 * MINUTE,
      releaseDelay: 3 * MINUTE,
      eventBuffer: 0,
      disputeWindow: 10 * MINUTE,
    },
    production: {
      deliveryWindow: 2 * DAY,
      releaseDelay: 10 * DAY,
      eventBuffer: 0,
      disputeWindow: 3 * DAY,
    },
  },
  {
    id: 1,
    key: "travel",
    dealType: DealType.BuyForYou,
    demo: {
      deliveryWindow: 5 * MINUTE,
      releaseDelay: 3 * MINUTE,
      eventBuffer: 5 * MINUTE,
      disputeWindow: 10 * MINUTE,
    },
    production: {
      deliveryWindow: 1 * DAY,
      releaseDelay: 1 * DAY,
      eventBuffer: 1 * DAY,
      disputeWindow: 3 * DAY,
    },
  },
  {
    id: 2,
    key: "food",
    dealType: DealType.BuyForYou,
    demo: {
      deliveryWindow: 5 * MINUTE,
      releaseDelay: 3 * MINUTE,
      eventBuffer: 0,
      disputeWindow: 10 * MINUTE,
    },
    production: {
      deliveryWindow: 2 * HOUR,
      releaseDelay: 6 * HOUR,
      eventBuffer: 0,
      disputeWindow: 1 * DAY,
    },
  },
  {
    id: 3,
    key: "movies",
    dealType: DealType.BuyForYou,
    demo: {
      deliveryWindow: 5 * MINUTE,
      releaseDelay: 3 * MINUTE,
      eventBuffer: 5 * MINUTE,
      disputeWindow: 10 * MINUTE,
    },
    production: {
      deliveryWindow: 2 * HOUR,
      releaseDelay: 2 * HOUR,
      eventBuffer: 3 * HOUR,
      disputeWindow: 1 * DAY,
    },
  },
  {
    id: 4,
    key: "membership",
    dealType: DealType.BuyForYou,
    demo: {
      deliveryWindow: 5 * MINUTE,
      releaseDelay: 3 * MINUTE,
      eventBuffer: 0,
      disputeWindow: 10 * MINUTE,
    },
    production: {
      deliveryWindow: 1 * DAY,
      releaseDelay: 3 * DAY,
      eventBuffer: 0,
      disputeWindow: 3 * DAY,
    },
  },
  {
    id: 5,
    key: "coupon",
    dealType: DealType.PassOn,
    demo: {
      deliveryWindow: 0,
      releaseDelay: 3 * MINUTE,
      eventBuffer: 0,
      disputeWindow: 10 * MINUTE,
    },
    production: {
      deliveryWindow: 0,
      releaseDelay: 1 * DAY,
      eventBuffer: 0,
      disputeWindow: 2 * DAY,
    },
  },
];

export interface ProtocolConfig {
  treasury: string;
  serverSigner: string;
  relayPointUnit: bigint;
  tierLimits: [bigint, bigint, bigint];
  sharerDepositBps: [number, number, number];
  seekerDepositBps: number;
  feeBps: number;
  arbiterTimeout: number;
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not set in packages/contracts/.env (see .env.example).`);
  return value;
}

function address(name: string): string {
  const value = required(name);
  if (!ethers.isAddress(value)) throw new Error(`${name} must be a 20-byte hex address.`);
  return ethers.getAddress(value);
}

function triple<T>(name: string, parse: (part: string) => T): [T, T, T] {
  const parts = required(name)
    .split(",")
    .map((part) => part.trim());
  if (parts.length !== 3)
    throw new Error(`${name} must list exactly three comma-separated values.`);
  return [parse(parts[0]), parse(parts[1]), parse(parts[2])];
}

function integer(name: string, value: string): number {
  if (!/^\d+$/.test(value)) throw new Error(`${name} must contain non-negative integers.`);
  return Number(value);
}

function wei(name: string, value: string): bigint {
  if (!/^\d+$/.test(value)) throw new Error(`${name} must contain integer wei amounts.`);
  return BigInt(value);
}

/** Reads and validates every protocol parameter (names in errors, never values of secrets). */
export function loadProtocolConfig(): ProtocolConfig {
  return {
    treasury: address("TREASURY_ADDRESS"),
    serverSigner: address("SERVER_VERIFIER_ADDRESS"),
    relayPointUnit: wei("RELAY_POINT_UNIT_WEI", required("RELAY_POINT_UNIT_WEI")),
    tierLimits: triple("TIER_LIMITS_WEI", (part) => wei("TIER_LIMITS_WEI", part)),
    sharerDepositBps: triple("SHARER_DEPOSIT_BPS", (part) => integer("SHARER_DEPOSIT_BPS", part)),
    seekerDepositBps: integer("SEEKER_DEPOSIT_BPS", required("SEEKER_DEPOSIT_BPS")),
    feeBps: integer("FEE_BPS", required("FEE_BPS")),
    arbiterTimeout: integer("ARBITER_TIMEOUT_SECONDS", required("ARBITER_TIMEOUT_SECONDS")),
  };
}
