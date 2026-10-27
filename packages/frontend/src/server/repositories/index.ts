import "server-only";
import { Timestamp } from "firebase-admin/firestore";
import { z } from "zod";
import { Collection } from "./collection";

/**
 * Firestore data model (server-only except `listings`, which the rules expose read-only).
 * Times are epoch milliseconds; `expiresAt` fields are Firestore Timestamps so a TTL policy can
 * delete expired documents. Personal data and codes are stored only as EncryptedBlob (crypto.ts).
 */

export const hex32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "expected 32-byte hex");
export const evmAddress = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "expected an address");
const millis = z.number().int().nonnegative();
const weiString = z.string().regex(/^\d+$/);
const expiresAt = z.union([z.date(), z.custom<Timestamp>((value) => value instanceof Timestamp)]);

export const encryptedBlobSchema = z.object({
  v: z.literal(1),
  alg: z.literal("A256GCM"),
  kid: z.string(),
  dek: z.string(),
  iv: z.string(),
  ct: z.string(),
  tag: z.string(),
});

export const dealTypeSchema = z.enum(["BuyForYou", "PassOn"]);

/** users/{uid}: one verified phone ↔ one wallet. */
export const userSchema = z.object({
  uid: z.string().min(1),
  wallet: evmAddress,
  phoneHash: hex32,
  createdAt: millis,
  updatedAt: millis,
  badge: z
    .object({
      status: z.enum(["pending", "minted", "existing"]),
      txHash: hex32.optional(),
      at: millis,
    })
    .optional(),
  topup: z
    .object({
      status: z.enum(["pending", "sent", "failed"]),
      amountWei: weiString,
      txHash: hex32.optional(),
      at: millis,
    })
    .optional(),
});

/** listings/{dealId}: public listing metadata, verified against the chain before it is written. */
export const listingSchema = z.object({
  dealId: z.string().regex(/^\d+$/),
  sharer: evmAddress,
  dealType: dealTypeSchema,
  category: z.string(),
  categoryId: z.number().int().min(0).max(255),
  title: z.string(),
  description: z.string(),
  faceValueInr: z.number().nonnegative(),
  priceInr: z.number().positive(),
  priceWei: weiString,
  eventTime: millis.nullable(),
  terms: z.record(z.string(), z.unknown()),
  termsHash: hex32,
  /** Cached on-chain status name; the chain stays authoritative. */
  status: z.string(),
  releaseAt: millis.nullable(),
  createdAt: millis,
  updatedAt: millis,
});

/** deals/{dealId}: server-only index of a deal's parties and timers. */
export const dealSchema = z.object({
  dealId: z.string().regex(/^\d+$/),
  sharerUid: z.string(),
  seekerUid: z.string().nullable(),
  dealType: dealTypeSchema,
  status: z.string(),
  releaseAt: millis.nullable(),
  terminalAt: millis.nullable(),
  piiPurgedAt: millis.nullable(),
  updatedAt: millis,
});

/** vault/{fingerprint}: an encrypted Pass-on code. */
export const vaultSchema = z.object({
  fingerprint: hex32,
  sharer: evmAddress,
  sharerUid: z.string(),
  status: z.enum(["pending", "listed", "revealed", "cancelled"]),
  code: encryptedBlobSchema,
  dealId: z.string().nullable(),
  createdAt: millis,
  revealedAt: millis.nullable(),
});

/** disputes/{dealId}: evidence bundles and the arbiter's ruling. */
export const disputeSchema = z.object({
  dealId: z.string().regex(/^\d+$/),
  status: z.enum(["open", "resolved"]),
  evidence: z.array(
    z.object({
      party: z.enum(["sharer", "seeker"]),
      uid: z.string(),
      evidenceHash: hex32,
      bundle: encryptedBlobSchema,
      at: millis,
    }),
  ),
  openedAt: millis,
  updatedAt: millis,
});

/** idempotency/{hash(scope)}: claimed or completed state-changing requests. */
export const idempotencySchema = z.object({
  state: z.enum(["pending", "done"]),
  requestHash: z.string(),
  status: z.number().int().optional(),
  body: z.string().optional(),
  createdAt: millis,
  expiresAt,
});

/** rateLimits/{hash(key)}: token buckets. */
export const rateLimitSchema = z.object({
  tokens: z.number(),
  updatedAt: millis,
  expiresAt,
});

/** walletBackups/{uid}: the client-encrypted key blob only (the server never sees plaintext). */
export const walletBackupSchema = z.object({
  address: evmAddress,
  ciphertext: z.string(),
  iv: z.string(),
  salt: z.string(),
  kdf: z.object({
    name: z.literal("PBKDF2"),
    iterations: z.number().int().min(310_000),
    hash: z.literal("SHA-256"),
  }),
  version: z.number().int().positive(),
  updatedAt: millis,
});

export type UserDoc = z.output<typeof userSchema>;
export type ListingDoc = z.output<typeof listingSchema>;
export type DealDoc = z.output<typeof dealSchema>;
export type VaultDoc = z.output<typeof vaultSchema>;
export type DisputeDoc = z.output<typeof disputeSchema>;
export type WalletBackupDoc = z.output<typeof walletBackupSchema>;

export const repos = {
  users: new Collection("users", userSchema),
  listings: new Collection("listings", listingSchema),
  deals: new Collection("deals", dealSchema),
  vault: new Collection("vault", vaultSchema),
  disputes: new Collection("disputes", disputeSchema),
  idempotency: new Collection("idempotency", idempotencySchema),
  rateLimits: new Collection("rateLimits", rateLimitSchema),
  walletBackups: new Collection("walletBackups", walletBackupSchema),
};
