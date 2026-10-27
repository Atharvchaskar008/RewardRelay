/**
 * TypeScript mirrors of the Solidity enums in IRelayEscrow.sol. The numeric values are the on-chain
 * encoding; keep the order identical to the contract.
 */

export enum DealType {
  BuyForYou = 0,
  PassOn = 1,
}

export enum DealStatus {
  Listed = 0,
  Locked = 1,
  Delivered = 2,
  Completed = 3,
  Refunded = 4,
  Disputed = 5,
  Resolved = 6,
  Cancelled = 7,
}

export enum Party {
  None = 0,
  Sharer = 1,
  Seeker = 2,
}

/** `RelayEscrow.nextActionFor(id, account)`. */
export enum OnChainAction {
  None = 0,
  Wait = 1,
  Accept = 2,
  Cancel = 3,
  MarkDelivered = 4,
  ConfirmOrDispute = 5,
  Release = 6,
  ClaimRefund = 7,
  AddEvidence = 8,
  Resolve = 9,
  DefaultResolve = 10,
}

export const TERMINAL_STATUSES: readonly DealStatus[] = [
  DealStatus.Completed,
  DealStatus.Refunded,
  DealStatus.Resolved,
  DealStatus.Cancelled,
];

/** EIP-712 domain name/version and the ListingAuth type used for Pass-on authorisations. */
export const EIP712_DOMAIN = { name: "RewardRelay", version: "1" } as const;

export const LISTING_AUTH_TYPES = {
  ListingAuth: [
    { name: "sharer", type: "address" },
    { name: "fingerprint", type: "bytes32" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

/** Short user-facing labels per on-chain status. */
export const STATUS_LABELS: Record<DealStatus, string> = {
  [DealStatus.Listed]: "Open",
  [DealStatus.Locked]: "Paid, waiting for delivery",
  [DealStatus.Delivered]: "Delivered, in the check window",
  [DealStatus.Completed]: "Completed",
  [DealStatus.Refunded]: "Refunded",
  [DealStatus.Disputed]: "In dispute",
  [DealStatus.Resolved]: "Resolved",
  [DealStatus.Cancelled]: "Cancelled",
};

export const STATUS_NAMES: Record<DealStatus, string> = {
  [DealStatus.Listed]: "Listed",
  [DealStatus.Locked]: "Locked",
  [DealStatus.Delivered]: "Delivered",
  [DealStatus.Completed]: "Completed",
  [DealStatus.Refunded]: "Refunded",
  [DealStatus.Disputed]: "Disputed",
  [DealStatus.Resolved]: "Resolved",
  [DealStatus.Cancelled]: "Cancelled",
};
