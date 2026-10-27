import "server-only";
import { createHash, randomBytes } from "crypto";
import { keccak256, toBytes, type Hex } from "viem";
import { z } from "zod";
import { DealStatus, canonicalJson } from "@rewardrelay/shared";
import { keyring } from "../crypto";
import { requireParty } from "../deals/access";
import { chainNow } from "../deals/read";
import { AppError } from "../errors";
import { fileStore, validateUpload, type StoredFile } from "../files/store";
import { evidenceClaimSchema, repos } from "../repositories";
import { transaction } from "../repositories/collection";
import type { AuthUser } from "../services";

/**
 * Dispute evidence. The bundle (party, claim, text, the SHA-256 of every file, a random nonce) is
 * serialised as canonical JSON; its keccak256 is the `evidenceHash` the party posts on-chain with
 * raiseDispute / addEvidence. Text and files stay encrypted off-chain; the arbiter can later prove
 * that what it reviewed is exactly what was committed on-chain.
 */

export const MAX_EVIDENCE_FILES = 3;
const MAX_ITEMS_PER_PARTY = 5;

export const evidenceInputSchema = z
  .object({
    claim: evidenceClaimSchema,
    text: z.string().trim().min(5).max(2_000),
  })
  .strict();

export interface EvidenceFileInput {
  bytes: Buffer;
  contentType: string;
}

export interface EvidenceBundle {
  v: 1;
  dealId: string;
  party: "sharer" | "seeker";
  author: string;
  claim: z.output<typeof evidenceClaimSchema>;
  text: string;
  files: { sha256: string; contentType: string; size: number }[];
  nonce: Hex;
  createdAt: number;
}

export const evidenceHashOf = (bundle: EvidenceBundle): Hex =>
  keccak256(toBytes(canonicalJson(bundle)));
export const evidenceAad = (dealId: string, evidenceHash: Hex) =>
  `disputes/${dealId}#evidence/${evidenceHash}`;

export async function submitEvidence(
  user: AuthUser,
  idParam: string | undefined,
  input: z.output<typeof evidenceInputSchema>,
  files: EvidenceFileInput[] = [],
) {
  const ctx = await requireParty(user, idParam, {
    roles: ["sharer", "seeker"],
    statuses: [DealStatus.Delivered, DealStatus.Disputed],
    stateMessage: "Evidence can be added only during the check window or an open dispute.",
  });
  // Before a dispute exists only the seeker prepares evidence (to raise it).
  if (ctx.deal.status === DealStatus.Delivered && ctx.role !== "seeker") {
    throw new AppError("CHAIN_STATE_MISMATCH", {
      message: "The sharer can add evidence once the seeker has raised a dispute.",
    });
  }
  if (ctx.deal.status === DealStatus.Disputed) {
    const closesAt = Number(ctx.deal.disputeOpenedAt) + Number(ctx.deal.policy.disputeWindow);
    if ((await chainNow()) > closesAt) {
      throw new AppError("CHAIN_STATE_MISMATCH", {
        message: "The evidence window for this dispute has closed.",
      });
    }
  }
  if (files.length > MAX_EVIDENCE_FILES) {
    throw new AppError("VALIDATION_FAILED", {
      message: `Attach at most ${MAX_EVIDENCE_FILES} files.`,
    });
  }
  const types = files.map((file) => validateUpload(file.bytes, file.contentType));

  const bundle: EvidenceBundle = {
    v: 1,
    dealId: ctx.dealId,
    party: ctx.role,
    author: ctx.wallet,
    claim: input.claim,
    text: input.text,
    files: files.map((file, index) => ({
      sha256: createHash("sha256").update(file.bytes).digest("hex"),
      contentType: types[index],
      size: file.bytes.length,
    })),
    nonce: `0x${randomBytes(16).toString("hex")}`,
    createdAt: Date.now(),
  };
  const evidenceHash = evidenceHashOf(bundle);

  const stored: StoredFile[] = [];
  for (const [index, file] of files.entries()) {
    stored.push(await fileStore().put(`disputes/${ctx.dealId}`, file.bytes, types[index]));
  }

  await transaction(async (tx) => {
    const now = Date.now();
    const dispute = (await repos.disputes.get(ctx.dealId, tx)) ?? {
      dealId: ctx.dealId,
      status: "open" as const,
      evidence: [],
      openedAt: now,
      updatedAt: now,
      resolvedAt: null,
    };
    if (dispute.status === "resolved") {
      throw new AppError("CHAIN_STATE_MISMATCH", { message: "This dispute is already resolved." });
    }
    if (dispute.evidence.filter((item) => item.party === ctx.role).length >= MAX_ITEMS_PER_PARTY) {
      throw new AppError("VALIDATION_FAILED", {
        message: "You have reached the evidence limit for this deal.",
      });
    }
    dispute.evidence.push({
      party: ctx.role,
      uid: user.uid,
      claim: input.claim,
      evidenceHash,
      bundle: keyring().encryptJson(bundle, evidenceAad(ctx.dealId, evidenceHash)),
      files: stored,
      at: now,
    });
    await repos.disputes.set(ctx.dealId, { ...dispute, updatedAt: now }, tx);
  });

  return {
    dealId: ctx.dealId,
    evidenceHash,
    /** The contract call that commits this evidence. */
    onChainAction: ctx.deal.status === DealStatus.Delivered ? "raiseDispute" : "addEvidence",
    files: stored.map((file) => ({ contentType: file.contentType, size: file.size })),
  };
}
