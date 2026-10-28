import { describe, expect, it } from "vitest";
import { parseServerEnv } from "@/server/env";
import { testEnv } from "../helpers/env";

describe("server env", () => {
  it("parses a complete emulator-mode environment", () => {
    const env = parseServerEnv(testEnv());
    expect(env.firebaseEmulator).toBe(true);
    expect(env.MST_CHAIN_ID).toBe(31337);
    expect(env.TOPUP_WEI).toBe(2_000_000_000_000_000n);
    expect(env.SIGNER_LOW_BALANCE_WEI).toBe(10_000_000_000_000_000n);
    expect(env.DATA_KEYS.get("k1")?.length).toBe(32);
    expect(env.ADMIN_UIDS).toEqual(["admin-uid"]);
    expect(env.RELEASER_PRIVATE_KEY).toBeUndefined();
    // Addresses are checksummed.
    expect(env.ESCROW_ADDRESS).toBe("0x1111111111111111111111111111111111111111");
  });

  it("requires service-account credentials outside emulator mode", () => {
    const source = testEnv({ FIRESTORE_EMULATOR_HOST: "", FIREBASE_AUTH_EMULATOR_HOST: "" });
    expect(() => parseServerEnv(source)).toThrow(/FIREBASE_CLIENT_EMAIL: required unless/);
    expect(() => parseServerEnv(source)).toThrow(/FIREBASE_PRIVATE_KEY: required unless/);
  });

  it("names every invalid variable without echoing values", () => {
    const secret = "not-a-real-key-but-secret-looking-value";
    const source = testEnv({
      VERIFIER_PRIVATE_KEY: secret,
      PHONE_HMAC_KEY: secret,
      CRON_SECRET: "short",
    });
    let message = "";
    try {
      parseServerEnv(source);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/VERIFIER_PRIVATE_KEY/);
    expect(message).toMatch(/PHONE_HMAC_KEY/);
    expect(message).toMatch(/CRON_SECRET: expected at least 32 characters/);
    expect(message).not.toContain(secret);
    expect(message).not.toContain("short");
  });

  it("rejects reused signer keys, equal HMAC keys and an unknown active data key", () => {
    const base = testEnv();
    expect(() =>
      parseServerEnv({ ...base, FUNDER_PRIVATE_KEY: base.VERIFIER_PRIVATE_KEY }),
    ).toThrow(/server signer keys must be distinct/);
    expect(() => parseServerEnv({ ...base, CODE_HMAC_KEY: base.PHONE_HMAC_KEY })).toThrow(
      /CODE_HMAC_KEY: must differ/,
    );
    expect(() => parseServerEnv({ ...base, DATA_KEY_ID: "k9" })).toThrow(
      /DATA_KEY_ID: must name a key/,
    );
  });

  it("accepts several data keys for rotation and rejects duplicates", () => {
    const base = testEnv();
    const second = `k2:${Buffer.alloc(32, 7).toString("base64")}`;
    const env = parseServerEnv({
      ...base,
      DATA_KEYS: `${base.DATA_KEYS},${second}`,
      DATA_KEY_ID: "k2",
    });
    expect([...env.DATA_KEYS.keys()]).toEqual(["k1", "k2"]);
    expect(() => parseServerEnv({ ...base, DATA_KEYS: `${second},${second}` })).toThrow(
      /DATA_KEYS/,
    );
  });
});
