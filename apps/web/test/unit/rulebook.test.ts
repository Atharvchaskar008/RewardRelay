import { describe, expect, it } from "vitest";
import { suggestRuling } from "@/server/disputes/rulebook";

describe("rulebook suggestion", () => {
  it("refunds with a sharer fault when no proof matches the chain", () => {
    expect(
      suggestRuling({ dealType: "BuyForYou", proofMatchesChain: false, seekerEvidence: [] }),
    ).toMatchObject({ outcome: "REFUND", seekerShareBps: 10_000, faultParty: "Sharer" });
  });

  it("refunds with a sharer fault for a cancelled booking", () => {
    expect(
      suggestRuling({
        dealType: "BuyForYou",
        proofMatchesChain: true,
        seekerEvidence: [{ claim: "booking_cancelled" }],
      }),
    ).toMatchObject({ outcome: "REFUND", seekerShareBps: 10_000, faultParty: "Sharer" });
  });

  it("releases to the sharer when a valid proof meets no committed counter-evidence", () => {
    expect(
      suggestRuling({ dealType: "BuyForYou", proofMatchesChain: true, seekerEvidence: [] }),
    ).toMatchObject({ outcome: "RELEASE", seekerShareBps: 0, faultParty: "Seeker" });
  });

  it("splits 50/50 without fault when the evidence is unclear", () => {
    expect(
      suggestRuling({
        dealType: "BuyForYou",
        proofMatchesChain: true,
        seekerEvidence: [{ claim: "not_as_described" }],
      }),
    ).toMatchObject({ outcome: "SPLIT", seekerShareBps: 5_000, faultParty: "None" });
    expect(
      suggestRuling({
        dealType: "PassOn",
        proofMatchesChain: false,
        seekerEvidence: [{ claim: "code_invalid" }],
      }),
    ).toMatchObject({ outcome: "SPLIT", faultParty: "None" });
  });

  it("applies the missing-proof rule before every other rule", () => {
    expect(
      suggestRuling({
        dealType: "BuyForYou",
        proofMatchesChain: false,
        seekerEvidence: [{ claim: "booking_cancelled" }],
      }).rule,
    ).toMatch(/No order proof/);
  });
});
