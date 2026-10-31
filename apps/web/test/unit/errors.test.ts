import { describe, expect, it } from "vitest";
import { ApiError, toChainError, userMessage } from "@/client/sdk/errors";

describe("toChainError", () => {
  const wrapped = (cause: unknown, message = "An unknown RPC error occurred.") =>
    Object.assign(new Error(message), { name: "TransactionExecutionError", cause });

  it("shows what the wallet actually said instead of a bare failure", () => {
    const error = toChainError(wrapped({ code: -32603, message: "nonce too low: next 11\nraw" }));
    expect(error.message).toBe("The transaction failed: nonce too low: next 11");
  });

  it("reads details nested below viem's wrapper, in plain objects too", () => {
    expect(toChainError(wrapped({ code: 4001, message: "nope" })).reason).toBe("UserRejected");
    expect(toChainError(wrapped({ code: -32002, message: "busy" })).reason).toBe("PendingRequest");
    expect(toChainError(wrapped({ details: "insufficient funds for gas" })).reason).toBe(
      "InsufficientFunds",
    );
    expect(toChainError("User cancelled").reason).toBe("UserRejected");
  });

  it("names a wallet on the wrong network", () => {
    const mismatch = Object.assign(
      new Error("The current chain of the wallet (id: 1) does not match the target chain"),
      { name: "ChainMismatchError" },
    );
    expect(toChainError(wrapped(mismatch))).toMatchObject({ reason: "WrongChain" });
  });

  it("is not fooled by function names in viem's messages", () => {
    const message = (fn: string) =>
      `Execution failed.\n\nContract Call:\n  function: ${fn}(uint256)`;
    expect(toChainError(new Error(message("claimTimeout"))).reason).toBeUndefined();
    expect(toChainError(new Error(message("cancelListing"))).reason).toBeUndefined();
  });

  it("never calls a sent transaction failed when its result is unknown", () => {
    const error = toChainError(new Error("connection lost"), "0xabc");
    expect(error).toMatchObject({ reason: "Unconfirmed", hash: "0xabc" });
    expect(error.message).not.toMatch(/failed/i);
  });

  it("keeps the plain sentence when there is nothing more to say", () => {
    expect(toChainError(undefined).message).toBe("The transaction failed. Please try again.");
    expect(toChainError(new Error("Transaction failed")).message).toBe(
      "The transaction failed. Please try again.",
    );
  });
});

/** Shape of a FirebaseError from firebase/auth (an Error with a string `code`). */
function firebaseError(code: string): Error {
  return Object.assign(new Error(`Firebase: Error (${code}).`), { name: "FirebaseError", code });
}

describe("userMessage", () => {
  it("passes API errors through", () => {
    expect(userMessage(new ApiError("NOT_FOUND", "No such deal.", 404))).toBe("No such deal.");
  });

  it("explains phone sign-in errors the user can act on", () => {
    expect(userMessage(firebaseError("auth/operation-not-allowed"))).toBe(
      "Sign-in by SMS is not enabled for this number's region yet.",
    );
    expect(userMessage(firebaseError("auth/invalid-verification-code"))).toBe(
      "That code is not right. Check it and try again.",
    );
  });

  it("falls back to a generic sentence for anything else", () => {
    expect(userMessage(firebaseError("auth/internal-error"))).toBe(
      "Something went wrong. Please try again.",
    );
    expect(userMessage(new Error("boom"))).toBe("Something went wrong. Please try again.");
    expect(userMessage(null)).toBe("Something went wrong. Please try again.");
  });
});
