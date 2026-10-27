/**
 * The arbiter's rulebook as a pure function: a suggestion only, the admin decides.
 *
 * 1. Buy-for-you without a matching order proof          → refund the seeker, fault: sharer
 * 2. The seeker reports a cancelled booking               → refund the seeker, fault: sharer
 * 3. A valid proof and no committed counter-evidence      → release to the sharer, fault: seeker
 * 4. Anything else (conflicting or unclear evidence)      → 50/50, no fault
 */

export type FaultParty = "None" | "Sharer" | "Seeker";

export interface RulingSuggestion {
  outcome: "REFUND" | "RELEASE" | "SPLIT";
  seekerShareBps: number;
  faultParty: FaultParty;
  rule: string;
}

export interface RulebookInput {
  dealType: "BuyForYou" | "PassOn";
  /** An off-chain proof exists and its hash equals the on-chain proofHash. */
  proofMatchesChain: boolean;
  /** Seeker evidence bundles whose hash was committed on-chain. */
  seekerEvidence: { claim: string }[];
}

export function suggestRuling(input: RulebookInput): RulingSuggestion {
  if (input.dealType === "BuyForYou" && !input.proofMatchesChain) {
    return {
      outcome: "REFUND",
      seekerShareBps: 10_000,
      faultParty: "Sharer",
      rule: "No order proof matches the on-chain proof hash: refund the seeker.",
    };
  }
  if (input.seekerEvidence.some((item) => item.claim === "booking_cancelled")) {
    return {
      outcome: "REFUND",
      seekerShareBps: 10_000,
      faultParty: "Sharer",
      rule: "The seeker reports a cancelled booking: refund and record a fault (verify the evidence).",
    };
  }
  if (input.dealType === "BuyForYou" && input.seekerEvidence.length === 0) {
    return {
      outcome: "RELEASE",
      seekerShareBps: 0,
      faultParty: "Seeker",
      rule: "A valid order proof and no committed counter-evidence: release to the sharer.",
    };
  }
  return {
    outcome: "SPLIT",
    seekerShareBps: 5_000,
    faultParty: "None",
    rule: "The evidence is unclear or conflicting: split 50/50 without fault.",
  };
}
