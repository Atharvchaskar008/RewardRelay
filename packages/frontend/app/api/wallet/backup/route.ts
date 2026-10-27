import { getAddress } from "viem";
import { z } from "zod";
import { AppError } from "@/src/server/errors";
import { withRoute } from "@/src/server/http";
import { repos } from "@/src/server/repositories";
import { addressInput, base64Input } from "@/src/server/validation/common";

export const dynamic = "force-dynamic";

/**
 * Encrypted wallet backup. The browser encrypts the private key with the user's PIN
 * (PBKDF2-SHA-256 ≥ 310,000 iterations → AES-GCM) and uploads only the result; the server can
 * neither decrypt it nor accept anything that looks like a raw key.
 */

const RAW_KEY = /^(0x)?[0-9a-fA-F]{64}$/;
/** AES-GCM of a 32-byte key = 32 bytes ciphertext + 16 bytes tag. */
const MIN_CIPHERTEXT_BYTES = 48;

const backupBody = z
  .object({
    address: addressInput,
    ciphertext: base64Input(1_024),
    iv: base64Input(32),
    salt: base64Input(64),
    kdf: z.object({
      name: z.literal("PBKDF2"),
      iterations: z.number().int().min(310_000).max(5_000_000),
      hash: z.literal("SHA-256"),
    }),
    version: z.number().int().min(1).max(100),
  })
  .strict()
  .superRefine((value, ctx) => {
    for (const field of ["ciphertext", "iv", "salt"] as const) {
      if (RAW_KEY.test(value[field])) {
        ctx.addIssue({ code: "custom", path: [field], message: "looks like an unencrypted key" });
      }
    }
    if (Buffer.from(value.ciphertext, "base64").length < MIN_CIPHERTEXT_BYTES) {
      ctx.addIssue({
        code: "custom",
        path: ["ciphertext"],
        message: "too short to be an encrypted key",
      });
    }
    if (Buffer.from(value.iv, "base64").length !== 12) {
      ctx.addIssue({ code: "custom", path: ["iv"], message: "expected a 96-bit IV" });
    }
    if (Buffer.from(value.salt, "base64").length < 16) {
      ctx.addIssue({
        code: "custom",
        path: ["salt"],
        message: "expected at least 16 bytes of salt",
      });
    }
  });

/** PUT /api/wallet/backup → stores the encrypted key blob of the caller's linked wallet. */
export const PUT = withRoute(
  { name: "wallet.backup.put", body: backupBody, rateLimit: { capacity: 5, refillPerMinute: 2 } },
  async ({ body, user }) => {
    const record = await repos.users.get(user!.uid);
    if (!record)
      throw new AppError("NOT_FOUND", { message: "Link a wallet before backing it up." });
    if (getAddress(record.wallet) !== body.address) {
      throw new AppError("FORBIDDEN", { message: "You can only back up your own linked wallet." });
    }
    const updatedAt = Date.now();
    await repos.walletBackups.set(user!.uid, { ...body, updatedAt });
    return { address: body.address, version: body.version, updatedAt };
  },
);

/** GET /api/wallet/backup → the encrypted blob (restore). Limited to 5 per hour per user. */
export const GET = withRoute(
  { name: "wallet.backup.get", rateLimit: { capacity: 5, refillPerMinute: 5 / 60 } },
  async ({ user }) => {
    const backup = await repos.walletBackups.get(user!.uid);
    if (!backup) throw new AppError("NOT_FOUND", { message: "No wallet backup was found." });
    return backup;
  },
);
