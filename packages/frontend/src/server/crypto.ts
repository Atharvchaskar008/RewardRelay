import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "crypto";
import type { Address, Hex, PrivateKeyAccount } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { EIP712_DOMAIN, LISTING_AUTH_TYPES } from "rewardrelay-shared";
import { serverEnv } from "./env";

/**
 * Envelope encryption (AES-256-GCM): every record gets a fresh 256-bit data key that encrypts the
 * payload; the data key is itself encrypted ("wrapped") with a key-encryption key from DATA_KEYS,
 * identified by `kid`. Both layers use a random 96-bit IV and bind the record path as AAD, so a
 * ciphertext copied to another document fails to decrypt. Rotating DATA_KEY_ID only changes which
 * key wraps new records; old records keep decrypting while their key stays listed.
 */

const IV_BYTES = 12;
const KEY_BYTES = 32;
const TAG_BYTES = 16;

export interface EncryptedBlob {
  v: 1;
  alg: "A256GCM";
  /** Key-encryption key id (from DATA_KEYS). */
  kid: string;
  /** Wrapped data key: base64(iv ‖ ciphertext ‖ tag). */
  dek: string;
  /** Payload: base64 IV, ciphertext and tag. */
  iv: string;
  ct: string;
  tag: string;
}

export interface KeyringConfig {
  dataKeys: Map<string, Buffer>;
  activeKeyId: string;
  phoneKey: Buffer;
  codeKey: Buffer;
}

export class CryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CryptoError";
  }
}

function gcmEncrypt(key: Buffer, plaintext: Buffer, aad: Buffer) {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(aad);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { iv, ct, tag: cipher.getAuthTag() };
}

function gcmDecrypt(key: Buffer, iv: Buffer, ct: Buffer, tag: Buffer, aad: Buffer): Buffer {
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES)
    throw new CryptoError("malformed ciphertext");
  const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
  decipher.setAAD(aad);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ct), decipher.final()]);
  } catch {
    throw new CryptoError("decryption failed (tampered data, wrong key or wrong record)");
  }
}

export class Keyring {
  constructor(private readonly config: KeyringConfig) {
    if (!config.dataKeys.has(config.activeKeyId))
      throw new CryptoError("active key id is not in the keyring");
  }

  encrypt(plaintext: string | Buffer, aad: string): EncryptedBlob {
    const kid = this.config.activeKeyId;
    const kek = this.config.dataKeys.get(kid) as Buffer;
    const dataKey = randomBytes(KEY_BYTES);
    const aadBytes = Buffer.from(aad, "utf8");
    const payload = gcmEncrypt(
      dataKey,
      Buffer.isBuffer(plaintext) ? plaintext : Buffer.from(plaintext, "utf8"),
      aadBytes,
    );
    const wrapped = gcmEncrypt(kek, dataKey, Buffer.from(`${kid}|${aad}`, "utf8"));
    dataKey.fill(0);
    return {
      v: 1,
      alg: "A256GCM",
      kid,
      dek: Buffer.concat([wrapped.iv, wrapped.ct, wrapped.tag]).toString("base64"),
      iv: payload.iv.toString("base64"),
      ct: payload.ct.toString("base64"),
      tag: payload.tag.toString("base64"),
    };
  }

  decrypt(blob: EncryptedBlob, aad: string): Buffer {
    if (blob.v !== 1 || blob.alg !== "A256GCM")
      throw new CryptoError("unsupported ciphertext version");
    const kek = this.config.dataKeys.get(blob.kid);
    if (!kek) throw new CryptoError("unknown key id");
    const wrapped = Buffer.from(blob.dek, "base64");
    if (wrapped.length !== IV_BYTES + KEY_BYTES + TAG_BYTES)
      throw new CryptoError("malformed data key");
    const dataKey = gcmDecrypt(
      kek,
      wrapped.subarray(0, IV_BYTES),
      wrapped.subarray(IV_BYTES, IV_BYTES + KEY_BYTES),
      wrapped.subarray(IV_BYTES + KEY_BYTES),
      Buffer.from(`${blob.kid}|${aad}`, "utf8"),
    );
    try {
      return gcmDecrypt(
        dataKey,
        Buffer.from(blob.iv, "base64"),
        Buffer.from(blob.ct, "base64"),
        Buffer.from(blob.tag, "base64"),
        Buffer.from(aad, "utf8"),
      );
    } finally {
      dataKey.fill(0);
    }
  }

  encryptJson(value: unknown, aad: string): EncryptedBlob {
    return this.encrypt(JSON.stringify(value), aad);
  }

  decryptJson<T>(blob: EncryptedBlob, aad: string): T {
    return JSON.parse(this.decrypt(blob, aad).toString("utf8")) as T;
  }

  /** HMAC-SHA256 of a normalised phone number (E.164), as bytes32 hex. */
  phoneHash(e164: string): Hex {
    return hmacHex(this.config.phoneKey, e164.trim());
  }

  /** HMAC-SHA256 of an already-normalised Pass-on code, as the bytes32 on-chain fingerprint. */
  codeFingerprint(normalizedCode: string): Hex {
    return hmacHex(this.config.codeKey, normalizedCode);
  }
}

export function hmacHex(key: Buffer, value: string): Hex {
  return `0x${createHmac("sha256", key).update(value, "utf8").digest("hex")}`;
}

/** Constant-time equality for secrets of any length (both sides hashed to 32 bytes first). */
export function safeEqual(a: string, b: string): boolean {
  const left = createHash("sha256").update(a, "utf8").digest();
  const right = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(left, right);
}

let cachedKeyring: Keyring | undefined;

export function keyring(): Keyring {
  if (!cachedKeyring) {
    const env = serverEnv();
    cachedKeyring = new Keyring({
      dataKeys: env.DATA_KEYS,
      activeKeyId: env.DATA_KEY_ID,
      phoneKey: env.PHONE_HMAC_KEY,
      codeKey: env.CODE_HMAC_KEY,
    });
  }
  return cachedKeyring;
}

// ---------------------------------------------------------------------------------------------
// EIP-712 ListingAuth (Pass-on authorisation checked by RelayEscrow.createListing)
// ---------------------------------------------------------------------------------------------

export interface ListingAuthMessage {
  sharer: Address;
  fingerprint: Hex;
  nonce: bigint;
  deadline: bigint;
}

export function listingAuthDomain(chainId: number, escrow: Address) {
  return { ...EIP712_DOMAIN, chainId, verifyingContract: escrow } as const;
}

/** Signs `ListingAuth(address sharer,bytes32 fingerprint,uint256 nonce,uint256 deadline)`. */
export function signListingAuth(
  message: ListingAuthMessage,
  options: { account?: PrivateKeyAccount; chainId?: number; escrow?: Address } = {},
): Promise<Hex> {
  const account = options.account ?? privateKeyToAccount(serverEnv().VERIFIER_PRIVATE_KEY);
  const chainId = options.chainId ?? serverEnv().MST_CHAIN_ID;
  const escrow = options.escrow ?? serverEnv().ESCROW_ADDRESS;
  return account.signTypedData({
    domain: listingAuthDomain(chainId, escrow),
    types: LISTING_AUTH_TYPES,
    primaryType: "ListingAuth",
    message,
  });
}

/** Test hook. */
export function resetKeyringForTests(): void {
  cachedKeyring = undefined;
}
