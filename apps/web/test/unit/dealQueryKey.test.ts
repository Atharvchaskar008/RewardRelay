import { describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { dealQueryKey } from "@/client/sdk";

describe("deal view cache key", () => {
  it("separates a signed-out view from the signed-in view of the same deal", () => {
    expect(dealQueryKey("8", null)).not.toEqual(dealQueryKey("8", "uid-a"));
    expect(dealQueryKey("8", "uid-a")).not.toEqual(dealQueryKey("8", "uid-b"));
    expect(dealQueryKey("8", "uid-a")).toEqual(dealQueryKey("8", "uid-a"));
    expect(dealQueryKey("8", undefined)).toEqual(dealQueryKey("8", null));
  });

  it("keeps the ['deal', id] prefix so invalidating a deal reaches every account's entry", async () => {
    const client = new QueryClient();
    client.setQueryData(dealQueryKey("8", null), { status: "Listed" });
    client.setQueryData(dealQueryKey("8", "uid-a"), { status: "Listed" });
    client.setQueryData(dealQueryKey("9", "uid-a"), { status: "Listed" });
    await client.invalidateQueries({ queryKey: ["deal", "8"] });
    const invalid = client
      .getQueryCache()
      .findAll()
      .filter((query) => query.state.isInvalidated)
      .map((query) => query.queryKey);
    expect(invalid).toEqual([dealQueryKey("8", null), dealQueryKey("8", "uid-a")]);
  });
});
