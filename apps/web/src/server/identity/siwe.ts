import "server-only";
import { getAddress, verifyMessage, type Address, type Hex } from "viem";
import { createSiweMessage, generateSiweNonce, parseSiweMessage } from "viem/siwe";
import { serverEnv } from "../env";
import { AppError } from "../errors";
import { repos } from "../repositories";
import { transaction } from "../repositories/collection";

/**
 * SIWE-style (EIP-4361) wallet challenges. The server builds the exact message (domain and URI from
 * APP_URL, chain id from env), stores it under its nonce bound to the signed-in uid, and accepts it
 * once, within 5 minutes, signed by the named address. Verification compares the stored message
 * byte for byte, so no field of a client-supplied message is ever trusted.
 */

export const CHALLENGE_TTL_MS = 5 * 60_000;
export const SIWE_STATEMENT =
  "Link this wallet to your SAKER account. Signing is free and sends no transaction.";

export interface Challenge {
  message: string;
  nonce: string;
  expiresAt: string;
}

const invalidChallenge = () =>
  new AppError("VALIDATION_FAILED", {
    message: "This wallet challenge is not valid for your account. Request a new one.",
  });

export async function createChallenge(
  uid: string,
  address: Address,
  now = Date.now(),
): Promise<Challenge> {
  const env = serverEnv();
  const app = new URL(env.APP_URL);
  const nonce = generateSiweNonce();
  const expiresAt = new Date(now + CHALLENGE_TTL_MS);
  const message = createSiweMessage({
    domain: app.host,
    address: getAddress(address),
    statement: SIWE_STATEMENT,
    uri: app.origin,
    version: "1",
    chainId: env.MST_CHAIN_ID,
    nonce,
    issuedAt: new Date(now),
    expirationTime: expiresAt,
  });
  await repos.challenges.create(nonce, {
    nonce,
    uid,
    address: getAddress(address),
    message,
    issuedAt: now,
    expiresAt,
    usedAt: null,
  });
  return { message, nonce, expiresAt: expiresAt.toISOString() };
}

/**
 * Verifies the signature, then consumes the challenge in a transaction: it must exist, belong to
 * `uid`, name `address`, equal `message` exactly, be unused and unexpired. Throws otherwise.
 */
export async function consumeChallenge(
  input: { uid: string; address: Address; message: string; signature: Hex },
  now = Date.now(),
): Promise<void> {
  const nonce = parseSiweMessage(input.message).nonce;
  if (!nonce) throw invalidChallenge();

  const valid = await verifyMessage({
    address: input.address,
    message: input.message,
    signature: input.signature,
  }).catch(() => false);
  if (!valid) {
    throw new AppError("FORBIDDEN", { message: "The signature was not made by this wallet." });
  }

  await transaction(async (tx) => {
    const challenge = await repos.challenges.get(nonce, tx);
    if (
      !challenge ||
      challenge.uid !== input.uid ||
      challenge.message !== input.message ||
      getAddress(challenge.address) !== getAddress(input.address)
    ) {
      throw invalidChallenge();
    }
    if (challenge.usedAt !== null) {
      throw new AppError("VALIDATION_FAILED", {
        message: "This wallet challenge was already used. Request a new one.",
      });
    }
    if (now > challenge.issuedAt + CHALLENGE_TTL_MS) {
      throw new AppError("VALIDATION_FAILED", {
        message: "This wallet challenge has expired. Request a new one.",
      });
    }
    await repos.challenges.update(nonce, { usedAt: now }, tx);
  });
}
