import fs from "fs";
import path from "path";
import { randomBytes } from "crypto";
import { describe, expect, it } from "vitest";
import {
  encodeAbiParameters,
  hashTypedData,
  keccak256,
  recoverTypedDataAddress,
  concat,
  toHex,
  type Address,
  type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { LISTING_AUTH_TYPES } from "rewardrelay-shared";
import {
  CryptoError,
  Keyring,
  hmacHex,
  listingAuthDomain,
  safeEqual,
  signListingAuth,
  type EncryptedBlob,
} from "@/src/server/crypto";

const key = () => randomBytes(32);

function makeKeyring(dataKeys = new Map([["k1", key()]]), activeKeyId = "k1") {
  return new Keyring({ dataKeys, activeKeyId, phoneKey: key(), codeKey: key() });
}

/** Flips one bit of a base64 field. */
function flip(value: string): string {
  const bytes = Buffer.from(value, "base64");
  bytes[0] ^= 0x01;
  return bytes.toString("base64");
}

describe("envelope encryption", () => {
  const aad = "deals/7/private/details";

  it("round-trips strings and JSON with the record path as AAD", () => {
    const ring = makeKeyring();
    const blob = ring.encrypt("Asha Rao, 221B MG Road", aad);
    expect(blob).toMatchObject({ v: 1, alg: "A256GCM", kid: "k1" });
    expect(ring.decrypt(blob, aad).toString("utf8")).toBe("Asha Rao, 221B MG Road");

    const json = ring.encryptJson({ pincode: "411018", lines: ["Flat 4"] }, aad);
    expect(ring.decryptJson(json, aad)).toEqual({ pincode: "411018", lines: ["Flat 4"] });
  });

  it("uses a fresh IV and data key for every record", () => {
    const ring = makeKeyring();
    const a = ring.encrypt("same", aad);
    const b = ring.encrypt("same", aad);
    expect(a.iv).not.toBe(b.iv);
    expect(a.dek).not.toBe(b.dek);
    expect(a.ct).not.toBe(b.ct);
    expect(Buffer.from(a.iv, "base64")).toHaveLength(12);
  });

  it("detects tampering with ciphertext, tag, IV or wrapped key", () => {
    const ring = makeKeyring();
    const blob = ring.encrypt("secret code ABC-123", aad);
    for (const field of ["ct", "tag", "iv", "dek"] as const) {
      const tampered: EncryptedBlob = { ...blob, [field]: flip(blob[field]) };
      expect(() => ring.decrypt(tampered, aad), field).toThrow(CryptoError);
    }
  });

  it("refuses a ciphertext moved to another record (AAD binding)", () => {
    const ring = makeKeyring();
    const blob = ring.encrypt("order 402-123", aad);
    expect(() => ring.decrypt(blob, "deals/8/private/details")).toThrow(CryptoError);
  });

  it("refuses a relabelled key id and an unknown key id", () => {
    const ring = makeKeyring(
      new Map([
        ["k1", key()],
        ["k2", key()],
      ]),
    );
    const blob = ring.encrypt("x", aad);
    expect(() => ring.decrypt({ ...blob, kid: "k2" }, aad)).toThrow(CryptoError);
    expect(() => ring.decrypt({ ...blob, kid: "k9" }, aad)).toThrow(/unknown key id/);
  });

  it("keeps decrypting old records after rotating the active key", () => {
    const k1 = key();
    const old = makeKeyring(new Map([["k1", k1]]), "k1").encrypt("old record", aad);
    const rotated = makeKeyring(
      new Map([
        ["k1", k1],
        ["k2", key()],
      ]),
      "k2",
    );
    expect(rotated.decrypt(old, aad).toString()).toBe("old record");
    expect(rotated.encrypt("new record", aad).kid).toBe("k2");
  });

  it("does not leak the plaintext into the blob", () => {
    const blob = makeKeyring().encrypt("PLAINTEXT-MARKER-42", aad);
    expect(JSON.stringify(blob)).not.toContain("PLAINTEXT-MARKER-42");
    expect(Buffer.from(blob.ct, "base64").toString("utf8")).not.toContain("PLAINTEXT");
  });
});

describe("HMAC helpers", () => {
  it("are deterministic, bytes32-shaped and key-separated", () => {
    const ring = makeKeyring();
    const phone = ring.phoneHash("+16505550101");
    expect(phone).toMatch(/^0x[0-9a-f]{64}$/);
    expect(ring.phoneHash("+16505550101")).toBe(phone);
    expect(ring.phoneHash("+16505550102")).not.toBe(phone);
    // Same input, different purpose → different key → different output.
    expect(ring.codeFingerprint("+16505550101")).not.toBe(phone);
  });

  it("matches RFC 4231 test case 2", () => {
    expect(hmacHex(Buffer.from("Jefe"), "what do ya want for nothing?")).toBe(
      "0x5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843",
    );
  });

  it("compares secrets in constant time and correctly", () => {
    expect(safeEqual("a-long-cron-secret-value", "a-long-cron-secret-value")).toBe(true);
    expect(safeEqual("a-long-cron-secret-value", "a-long-cron-secret-valuE")).toBe(false);
    expect(safeEqual("short", "a much longer value")).toBe(false);
    expect(safeEqual("", "")).toBe(true);
  });
});

describe("EIP-712 ListingAuth", () => {
  const escrow: Address = "0x5aB34fB9CFce4a442b2CA773692a7D031D173C9A";
  const chainId = 91562037;
  const verifier = privateKeyToAccount(generatePrivateKey());
  const message = {
    sharer: privateKeyToAccount(generatePrivateKey()).address,
    fingerprint: keccak256(toHex("fingerprint")),
    nonce: 3n,
    deadline: 1_900_000_000n,
  };

  it("mirrors the typehash string declared in RelayEscrow.sol", () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, "../../../contracts/contracts/RelayEscrow.sol"),
      "utf8",
    );
    const declared = source.match(/LISTING_AUTH_TYPEHASH = keccak256\(\s*"([^"]+)"/)?.[1];
    const fields = LISTING_AUTH_TYPES.ListingAuth.map((field) => `${field.type} ${field.name}`);
    expect(declared).toBe(`ListingAuth(${fields.join(",")})`);
  });

  it("produces a signature that recovers to the verifier", async () => {
    const signature = await signListingAuth(message, { account: verifier, chainId, escrow });
    const recovered = await recoverTypedDataAddress({
      domain: listingAuthDomain(chainId, escrow),
      types: LISTING_AUTH_TYPES,
      primaryType: "ListingAuth",
      message,
      signature,
    });
    expect(recovered).toBe(verifier.address);
  });

  it("signs exactly the digest the contract computes (OpenZeppelin EIP712 + typehash)", async () => {
    const typeHash = keccak256(
      toHex("ListingAuth(address sharer,bytes32 fingerprint,uint256 nonce,uint256 deadline)"),
    );
    const domainTypeHash = keccak256(
      toHex("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
    );
    const domainSeparator = keccak256(
      encodeAbiParameters(
        [
          { type: "bytes32" },
          { type: "bytes32" },
          { type: "bytes32" },
          { type: "uint256" },
          { type: "address" },
        ],
        [
          domainTypeHash,
          keccak256(toHex("RewardRelay")),
          keccak256(toHex("1")),
          BigInt(chainId),
          escrow,
        ],
      ),
    );
    const structHash = keccak256(
      encodeAbiParameters(
        [
          { type: "bytes32" },
          { type: "address" },
          { type: "bytes32" },
          { type: "uint256" },
          { type: "uint256" },
        ],
        [typeHash, message.sharer, message.fingerprint, message.nonce, message.deadline],
      ),
    );
    const contractDigest = keccak256(concat(["0x1901", domainSeparator, structHash]) as Hex);
    const viemDigest = hashTypedData({
      domain: listingAuthDomain(chainId, escrow),
      types: LISTING_AUTH_TYPES,
      primaryType: "ListingAuth",
      message,
    });
    expect(viemDigest).toBe(contractDigest);
  });

  it("does not verify for another chain or another escrow (no replay)", async () => {
    const signature = await signListingAuth(message, { account: verifier, chainId, escrow });
    const otherChain = await recoverTypedDataAddress({
      domain: listingAuthDomain(4646, escrow),
      types: LISTING_AUTH_TYPES,
      primaryType: "ListingAuth",
      message,
      signature,
    });
    const otherEscrow = await recoverTypedDataAddress({
      domain: listingAuthDomain(chainId, "0x0000000000000000000000000000000000000001"),
      types: LISTING_AUTH_TYPES,
      primaryType: "ListingAuth",
      message,
      signature,
    });
    expect(otherChain).not.toBe(verifier.address);
    expect(otherEscrow).not.toBe(verifier.address);
  });
});
