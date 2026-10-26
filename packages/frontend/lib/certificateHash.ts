import { keccak256, toBytes } from "viem";

export type CertificateFields = {
  holderName: string;
  credential: string;
  issuedOn: string;
};

/**
 * Deterministic fingerprint of a certificate's off-chain fields — computed
 * the same way at issuance and at verification time, so a single changed
 * character produces a different hash and fails verification.
 */
export function hashCertificate(fields: CertificateFields): `0x${string}` {
  const canonical = [fields.holderName, fields.credential, fields.issuedOn]
    .map((value) => value.trim())
    .join("|");

  return keccak256(toBytes(canonical));
}
