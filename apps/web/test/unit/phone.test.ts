import { describe, expect, it } from "vitest";
import { toE164 } from "@/client/phone";

describe("toE164", () => {
  it("accepts the ways people type an Indian mobile number", () => {
    for (const typed of [
      "+919000000001",
      "+91 90000 00001",
      "+91-90000-00001",
      "9000000001",
      "09000000001",
      "919000000001",
      "+91919000000001", // "+91" prefilled, then "91…" typed
      "+9109000000001", // "+91" prefilled, then "0…" typed
    ]) {
      expect(toE164(typed), typed).toBe("+919000000001");
    }
  });

  it("keeps national numbers that start with 91", () => {
    expect(toE164("+91 91234 56789")).toBe("+919123456789");
  });

  it("passes other country codes and incomplete numbers through as digits", () => {
    expect(toE164("+1 555 010 0001")).toBe("+15550100001");
    expect(toE164("+91 90000")).toBe("+9190000");
    expect(toE164("+91")).toBe("+91");
  });
});
