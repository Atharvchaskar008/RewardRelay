/**
 * Response types of the API, re-exported for the UI. Type-only: nothing from the server is bundled.
 */
export type { UserView, Money } from "@/server/views/user";
export type { DealView, TimelineEntry, TrustView } from "@/server/views/deal";
export type { ListingView } from "@/server/listings/service";
export type { CodeAuthorization } from "@/server/vault/authorize";
export type { AdminDisputeView, EvidenceItemView } from "@/server/disputes/admin";
export type { RulingSuggestion, FaultParty } from "@/server/disputes/rulebook";
export type { HealthReport } from "@/server/health";
export type { CronSummary } from "@/server/cron/release";
export type { DeliveryDetails } from "@/server/deals/details";
export type { MyDealItem } from "@/server/deals/mine";
export type { EncryptedKey } from "@/client/wallet";

export type EvidenceClaim =
  | "not_delivered"
  | "not_as_described"
  | "booking_cancelled"
  | "code_invalid"
  | "delivered_as_agreed"
  | "other";

export interface Challenge {
  message: string;
  nonce: string;
  expiresAt: string;
}

export interface ProofReceipt {
  dealId: string;
  proofHash: `0x${string}`;
  invoice: { contentType: string; size: number } | null;
}

export interface ProofView {
  dealId: string;
  orderId: string;
  notes: string | null;
  proofHash: `0x${string}`;
  onChainProofHash: `0x${string}`;
  matchesChain: boolean;
  invoice: { contentType: string; size: number; path: string } | null;
  submittedAt: string;
}

export interface EvidenceReceipt {
  dealId: string;
  evidenceHash: `0x${string}`;
  onChainAction: "raiseDispute" | "addEvidence";
  files: { contentType: string; size: number }[];
}

export interface RevealedCode {
  dealId: string;
  code: string;
  fingerprint: `0x${string}`;
  firstRevealedAt: string;
}

export interface ListingDraft {
  title: string;
  description: string;
  category: string;
  faceValueInr: number;
  priceInr: number;
  /** Seconds since epoch, or 0 / undefined for no event. */
  eventTime?: number;
  /** Extra conditions shown to the seeker (validity, brands, notes). */
  terms?: Record<string, string | number | boolean | string[]>;
}
