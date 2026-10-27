import { randomBytes } from "crypto";
import { generatePrivateKey } from "viem/accounts";
import { resetServerEnvForTests } from "@/server/env";

const b64 = () => randomBytes(32).toString("base64");

/** A complete, valid server environment with throwaway keys (never the real .env values). */
export function testEnv(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    MST_RPC_URL: "http://127.0.0.1:8545",
    MST_CHAIN_ID: "31337",
    MST_EXPLORER_URL: "http://localhost:4000",
    ESCROW_ADDRESS: `0x${"11".repeat(20)}`,
    SBT_ADDRESS: `0x${"22".repeat(20)}`,
    VERIFIER_PRIVATE_KEY: generatePrivateKey(),
    FUNDER_PRIVATE_KEY: generatePrivateKey(),
    RELEASER_PRIVATE_KEY: "",
    FIREBASE_PROJECT_ID: "demo-rewardrelay",
    FIREBASE_CLIENT_EMAIL: "",
    FIREBASE_PRIVATE_KEY: "",
    FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8085",
    FIREBASE_AUTH_EMULATOR_HOST: process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099",
    DATA_KEYS: `k1:${b64()}`,
    DATA_KEY_ID: "k1",
    PHONE_HMAC_KEY: b64(),
    CODE_HMAC_KEY: b64(),
    ADMIN_UIDS: "admin-uid",
    CRON_SECRET: randomBytes(32).toString("base64url"),
    DEMO_RATE_INR_PER_MSTC: "100000",
    TOPUP_WEI: "2000000000000000",
    SIGNER_LOW_BALANCE_WEI: "",
    BLOB_READ_WRITE_TOKEN: "",
    ...overrides,
  };
}

/** Writes `env` into process.env and clears the cached server env. */
export function applyEnv(env: Record<string, string>): void {
  for (const [key, value] of Object.entries(env)) process.env[key] = value;
  resetServerEnvForTests();
}
