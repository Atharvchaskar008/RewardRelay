import { describe, expect, it } from "vitest";
import { ApiError, userMessage } from "@/client/sdk/errors";

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
