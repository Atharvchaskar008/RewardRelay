import { describe, expect, it } from "vitest";
import {
  DealStatus,
  buildListingTerms,
  canonicalJson,
  computeNextAction,
  findBlockedTopic,
  inrToWei,
  normalizeCode,
  weiToInr,
  weiToMstc,
  type AcceptBlock,
  type DealRole,
  type NextActionInput,
} from "@rewardrelay/shared";
import { listingTermsHash } from "@/common/terms";

/**
 * Exhaustive next-action matrix: every status × role × time window. Times (seconds) are chosen
 * around the deal's deadlines: deliverBy = 1000, releaseAt = 2000, eventTime = 0 unless stated,
 * dispute opened at 3000 with a 600 s evidence window and a 3600 s arbiter timeout.
 */

const BASE: Omit<NextActionInput, "status" | "role" | "now"> = {
  deliverBy: 1000,
  releaseAt: 2000,
  eventTime: 0,
  disputeOpenedAt: 3000,
  disputeWindow: 600,
  arbiterTimeout: 3600,
};

type Row = [
  DealStatus,
  string,
  number,
  Partial<Record<DealRole, string>>,
  Partial<NextActionInput>?,
];

/** Expected "PRIMARY[secondary,…]" per role; omitted roles expect "NONE". */
const MATRIX: Row[] = [
  // Listed: the sharer waits (may cancel); a visitor pays unless blocked; there is no seeker yet.
  [DealStatus.Listed, "open", 500, { sharer: "WAIT[CANCEL]", visitor: "PAY" }],
  [DealStatus.Listed, "event started", 600, { sharer: "WAIT[CANCEL]" }, { eventTime: 600 }],
  [
    DealStatus.Listed,
    "before event",
    599,
    { sharer: "WAIT[CANCEL]", visitor: "PAY" },
    { eventTime: 600 },
  ],
  // Locked: the sharer delivers until deliverBy (inclusive); after it the seeker claims the refund.
  [DealStatus.Locked, "before deliverBy", 999, { sharer: "MARK_DELIVERED", seeker: "WAIT" }],
  [DealStatus.Locked, "at deliverBy", 1000, { sharer: "MARK_DELIVERED", seeker: "WAIT" }],
  [DealStatus.Locked, "after deliverBy", 1001, { seeker: "CLAIM_REFUND" }],
  // Delivered: the seeker confirms or disputes before releaseAt; from releaseAt anyone releases.
  [
    DealStatus.Delivered,
    "check window",
    1999,
    { sharer: "WAIT", seeker: "CONFIRM[RAISE_DISPUTE]" },
  ],
  [
    DealStatus.Delivered,
    "at releaseAt",
    2000,
    { sharer: "RELEASE_AVAILABLE", seeker: "RELEASE_AVAILABLE" },
  ],
  [
    DealStatus.Delivered,
    "after releaseAt",
    9999,
    { sharer: "RELEASE_AVAILABLE", seeker: "RELEASE_AVAILABLE" },
  ],
  // Disputed: evidence until opened + window; default ruling from opened + timeout; seeker may concede.
  [
    DealStatus.Disputed,
    "evidence window",
    3600,
    { sharer: "WAIT[ADD_EVIDENCE]", seeker: "WAIT[ADD_EVIDENCE,CONFIRM]" },
  ],
  [DealStatus.Disputed, "evidence closed", 3601, { sharer: "WAIT", seeker: "WAIT[CONFIRM]" }],
  [
    DealStatus.Disputed,
    "default ruling due",
    6600,
    { sharer: "WAIT[DEFAULT_RESOLVE]", seeker: "WAIT[DEFAULT_RESOLVE,CONFIRM]" },
  ],
  [DealStatus.Disputed, "just before default", 6599, { sharer: "WAIT", seeker: "WAIT[CONFIRM]" }],
  [
    DealStatus.Disputed,
    "long evidence window overlaps default",
    6600,
    {
      sharer: "WAIT[ADD_EVIDENCE,DEFAULT_RESOLVE]",
      seeker: "WAIT[ADD_EVIDENCE,DEFAULT_RESOLVE,CONFIRM]",
    },
    { disputeWindow: 7200 },
  ],
  // Terminal states: nothing to do for anyone at any time.
  ...[DealStatus.Completed, DealStatus.Refunded, DealStatus.Resolved, DealStatus.Cancelled].flatMap(
    (status) => [0, 1000, 2000, 99_999].map((now): Row => [status, `terminal t=${now}`, now, {}]),
  ),
];

const ROLES: DealRole[] = ["sharer", "seeker", "visitor"];

const render = (result: ReturnType<typeof computeNextAction>) =>
  result.secondary.length
    ? `${result.nextAction}[${result.secondary.join(",")}]`
    : result.nextAction;

describe("computeNextAction matrix", () => {
  for (const [status, window, now, expected, overrides] of MATRIX) {
    for (const role of ROLES) {
      it(`${DealStatus[status]} · ${window} · ${role} → ${expected[role] ?? "NONE"}`, () => {
        const result = computeNextAction({ ...BASE, ...overrides, status, role, now });
        expect(render(result)).toBe(expected[role] ?? "NONE");
      });
    }
  }

  it("covers every status and every role", () => {
    const statuses = new Set(MATRIX.map(([status]) => status));
    expect(statuses.size).toBe(8);
  });

  it.each<AcceptBlock>(["SIGN_IN", "NO_WALLET", "NO_BADGE", "OVER_LIMIT", "PAUSED"])(
    "a blocked visitor (%s) gets NONE with the reason",
    (block) => {
      const result = computeNextAction({
        ...BASE,
        status: DealStatus.Listed,
        role: "visitor",
        now: 0,
        acceptBlock: block,
      });
      expect(result).toEqual({ nextAction: "NONE", secondary: [], reason: block });
    },
  );

  it("explains waits and closed windows", () => {
    expect(
      computeNextAction({ ...BASE, status: DealStatus.Locked, role: "sharer", now: 1001 }).reason,
    ).toBe("DELIVERY_WINDOW_CLOSED");
    expect(
      computeNextAction({ ...BASE, status: DealStatus.Locked, role: "seeker", now: 10 }).reason,
    ).toBe("AWAITING_DELIVERY");
    expect(
      computeNextAction({ ...BASE, status: DealStatus.Completed, role: "seeker", now: 10 }).reason,
    ).toBe("FINISHED");
  });
});

describe("listing rules", () => {
  it("canonical JSON sorts keys recursively and drops undefined", () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { y: 1, x: 2 }], c: "é" }, z: undefined })).toBe(
      '{"a":{"c":"é","d":[3,{"x":2,"y":1}]},"b":1}',
    );
  });

  it("hashes listing terms independently of key order", () => {
    const input = {
      title: "Rs 400 off with Bank A",
      description: "Delivered to your address",
      category: "ecommerce",
      faceValueInr: 2000,
      priceInr: 1530,
      eventTime: 0,
      conditions: { validTill: "2026-11-30", brands: ["Any"] },
    };
    const reordered = { ...input, conditions: { brands: ["Any"], validTill: "2026-11-30" } };
    expect(listingTermsHash(input)).toBe(listingTermsHash(reordered));
    expect(listingTermsHash({ ...input, priceInr: 1531 })).not.toBe(listingTermsHash(input));
    expect(buildListingTerms(input).version).toBe(1);
  });

  it("normalises codes and screens blocked topics", () => {
    expect(normalizeCode("  save 20 now ")).toBe("SAVE20NOW");
    expect(findBlockedTopic("Selling my IRCTC tatkal booking")?.key).toBe("irctc");
    expect(findBlockedTopic("Paytm wallet cash-out at 90%")?.key).toBe("wallet-cash-out");
    expect(findBlockedTopic("Student discount on laptops")?.key).toBe("employee-student");
    expect(findBlockedTopic("I will share my login and OTP")?.key).toBe("account-sharing");
    expect(findBlockedTopic("Craft beer voucher")?.key).toBe("regulated-goods");
    expect(findBlockedTopic("Rs 400 off with Bank A on electronics")).toBeUndefined();
  });

  it("converts ₹ and MSTC exactly at the demo rate", () => {
    expect(inrToWei(1530, 100_000)).toBe(15_300_000_000_000_000n);
    expect(weiToMstc(15_300_000_000_000_000n)).toBe("0.0153");
    expect(weiToInr(15_300_000_000_000_000n, 100_000)).toBe(1530);
    expect(inrToWei(0.01, 100_000)).toBe(100_000_000_000n);
    expect(weiToMstc(0n)).toBe("0");
    expect(weiToInr(inrToWei(499.99, 100_000), 100_000)).toBe(499.99);
  });
});
