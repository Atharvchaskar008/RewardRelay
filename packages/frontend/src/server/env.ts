import { z } from "zod";

/**
 * Server-side environment schema. Every API route reads configuration through `serverEnv()`, so a
 * missing or malformed variable fails the first request loudly instead of misbehaving later.
 * Error messages name the variable and the rule only, never the value.
 */

const privateKey = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/, "expected a 0x-prefixed 32-byte hex private key");

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "expected a 0x-prefixed 20-byte address");

const wei = z
  .string()
  .regex(/^\d+$/, "expected an integer amount in wei")
  .transform((value) => BigInt(value));

const KEY_BYTES = 32;

function decodeKey(value: string): Buffer | undefined {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return undefined;
  const bytes = Buffer.from(value, "base64");
  return bytes.length === KEY_BYTES ? bytes : undefined;
}

const secretKey = z.string().transform((value, ctx) => {
  const bytes = decodeKey(value);
  if (!bytes) {
    ctx.addIssue({ code: "custom", message: `expected ${KEY_BYTES} random bytes, base64-encoded` });
    return z.NEVER;
  }
  return bytes;
});

/** `keyId:base64,keyId:base64` → Map(keyId → 32-byte key). Old keys stay listed to decrypt old data. */
const dataKeys = z.string().transform((value, ctx) => {
  const keys = new Map<string, Buffer>();
  for (const entry of value.split(",").map((part) => part.trim())) {
    const separator = entry.indexOf(":");
    const keyId = entry.slice(0, separator);
    const bytes = separator > 0 ? decodeKey(entry.slice(separator + 1)) : undefined;
    if (!/^[A-Za-z0-9_-]{1,16}$/.test(keyId) || !bytes || keys.has(keyId)) {
      ctx.addIssue({
        code: "custom",
        message: `expected unique keyId:base64 pairs of ${KEY_BYTES}-byte keys`,
      });
      return z.NEVER;
    }
    keys.set(keyId, bytes);
  }
  return keys;
});

const commaList = z.string().transform((value) =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0),
);

const optionalPrivateKey = z.preprocess(
  (value) => (value === "" ? undefined : value),
  privateKey.optional(),
);

export const serverEnvSchema = z
  .object({
    MST_RPC_URL: z.url(),
    MST_CHAIN_ID: z.coerce.number().int().positive(),
    MST_EXPLORER_URL: z.url(),
    ESCROW_ADDRESS: address,
    SBT_ADDRESS: address,

    VERIFIER_PRIVATE_KEY: privateKey,
    FUNDER_PRIVATE_KEY: privateKey,
    RELEASER_PRIVATE_KEY: optionalPrivateKey,

    FIREBASE_PROJECT_ID: z.string().min(1),
    FIREBASE_CLIENT_EMAIL: z.email(),
    FIREBASE_PRIVATE_KEY: z
      .string()
      .min(1)
      .transform((value) => value.replace(/\\n/g, "\n")),

    DATA_KEYS: dataKeys,
    DATA_KEY_ID: z.string().min(1),
    PHONE_HMAC_KEY: secretKey,
    CODE_HMAC_KEY: secretKey,

    ADMIN_UIDS: commaList,
    CRON_SECRET: z.string().min(32, "expected at least 32 characters"),

    DEMO_RATE_INR_PER_MSTC: z.coerce.number().positive(),
    TOPUP_WEI: wei,
    SIGNER_LOW_BALANCE_WEI: wei.default(10_000_000_000_000_000n),

    BLOB_READ_WRITE_TOKEN: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    if (!env.DATA_KEYS.has(env.DATA_KEY_ID)) {
      ctx.addIssue({
        code: "custom",
        path: ["DATA_KEY_ID"],
        message: "must name a key in DATA_KEYS",
      });
    }
    if (env.PHONE_HMAC_KEY.equals(env.CODE_HMAC_KEY)) {
      ctx.addIssue({
        code: "custom",
        path: ["CODE_HMAC_KEY"],
        message: "must differ from PHONE_HMAC_KEY",
      });
    }
    const signers = [env.VERIFIER_PRIVATE_KEY, env.FUNDER_PRIVATE_KEY, env.RELEASER_PRIVATE_KEY];
    const present = signers.filter((key): key is string => key !== undefined);
    if (new Set(present.map((key) => key.toLowerCase())).size !== present.length) {
      ctx.addIssue({ code: "custom", message: "server signer keys must be distinct" });
    }
  });

export type ServerEnv = z.infer<typeof serverEnvSchema>;

/** Parses an environment record; throws one error listing every invalid variable (no values). */
export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  const result = serverEnvSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `${issue.path.join(".") || "env"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid server environment: ${problems}`);
  }
  return result.data;
}

let cached: ServerEnv | undefined;

/** The validated server environment, parsed once per process. */
export function serverEnv(): ServerEnv {
  cached ??= parseServerEnv(process.env);
  return cached;
}
