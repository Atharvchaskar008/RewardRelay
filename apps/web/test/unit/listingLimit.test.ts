import { describe, expect, it, vi } from "vitest";
import { ChainError, listBuyForYou, listPassOn, type SdkContext } from "@/client/sdk";

/** A Sharer whose New badge allows ₹500 (0.005 MSTC at the demo rate) and who holds almost nothing. */
function sdkWithLimit() {
  const authorize = vi.fn();
  const sdk = {
    api: {
      me: vi.fn(async () => ({
        badge: { maxDealValue: { wei: "5000000000000000", mstc: "0.005", inr: 500 } },
      })),
      codes: { authorize },
    },
    // Any chain call would fail the test: the limit check must come first.
    chain: new Proxy({}, { get: () => () => Promise.reject(new Error("chain was called")) }),
    inrPerMstc: 100_000,
  } as unknown as SdkContext;
  return { sdk, authorize };
}

describe("listing above the Trust Badge limit", () => {
  it("is refused with the limit reason before anything is signed (Buy-for-you)", async () => {
    const { sdk } = sdkWithLimit();
    const error = await listBuyForYou(sdk, {
      title: "Too expensive",
      description: "",
      category: "ecommerce",
      faceValueInr: 900,
      priceInr: 800,
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ChainError);
    expect(error).toMatchObject({ reason: "DealValueAboveLimit" });
    expect((error as Error).message).toMatch(/Trust Badge limit/);
  });

  it("is refused before the code is sealed (Pass-on)", async () => {
    const { sdk, authorize } = sdkWithLimit();
    const error = await listPassOn(
      sdk,
      {
        title: "Big voucher",
        description: "",
        category: "coupon",
        faceValueInr: 900,
        priceInr: 600,
      },
      "BIGCODE",
    ).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ name: "ChainError", reason: "DealValueAboveLimit" });
    expect(authorize).not.toHaveBeenCalled();
  });
});
