import "server-only";
import { randomBytes } from "crypto";
import { encodeAbiParameters, keccak256, type Hex } from "viem";
import { z } from "zod";
import { DealStatus } from "rewardrelay-shared";
import { keyring } from "../crypto";
import { AppError } from "../errors";
import { errorFields, log } from "../log";
import { encryptedBlobSchema, hex32 } from "../repositories";
import type { AuthUser } from "../services";
import { fileStore, storeFor, validateUpload, type StoredFile } from "../files/store";
import { logAccess, requireParty } from "./access";
import { pathOf, privateDocs } from "./privateDocs";

/**
 * Order proof: written by the sharer while Locked; proofHash = keccak256(abi.encode(dealId, orderId,
 * salt)) is what markDelivered commits on-chain (the salt stays encrypted here, so the order id
 * cannot be brute-forced from the chain). Optional invoice: PDF/JPEG/PNG ≤ 2 MB, sniffed, encrypted,
 * served to the deal's parties only.
 */

export const proofInputSchema = z
  .object({
    orderId: z
      .string()
      .trim()
      .min(3)
      .max(64)
      .regex(/^[A-Za-z0-9][A-Za-z0-9 _/-]*$/, "letters, digits, spaces, - _ /"),
    notes: z.string().trim().max(500).optional(),
  })
  .strict();

const storedFileSchema = z.object({
  fileId: z.string(),
  backend: z.enum(["firestore", "blob"]),
  contentType: z.enum(["application/pdf", "image/jpeg", "image/png"]),
  size: z.number().int().positive(),
  url: z.string().optional(),
});

export const proofDocSchema = z.object({
  orderId: encryptedBlobSchema,
  notes: encryptedBlobSchema.nullable(),
  salt: encryptedBlobSchema,
  proofHash: hex32,
  invoice: storedFileSchema.nullable(),
  submittedBy: z.string(),
  submittedAt: z.number(),
});

export function computeProofHash(dealId: bigint, orderId: string, salt: Hex): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "uint256" }, { type: "string" }, { type: "bytes32" }],
      [dealId, orderId, salt],
    ),
  );
}

export interface InvoiceUpload {
  bytes: Buffer;
  contentType: string;
}

export async function submitProof(
  user: AuthUser,
  idParam: string | undefined,
  input: z.output<typeof proofInputSchema>,
  invoice?: InvoiceUpload,
) {
  const ctx = await requireParty(user, idParam, {
    roles: ["sharer"],
    statuses: [DealStatus.Locked],
    stateMessage: "Proof can be submitted only before the deal is marked delivered.",
  });
  const type = invoice ? validateUpload(invoice.bytes, invoice.contentType) : undefined;
  const salt = `0x${randomBytes(32).toString("hex")}` as Hex;
  const proofHash = computeProofHash(ctx.id, input.orderId, salt);
  const docs = privateDocs(ctx.dealId, proofDocSchema);
  const previous = await docs.get("proof");

  const stored: StoredFile | null =
    invoice && type ? await fileStore().put(`deals/${ctx.dealId}`, invoice.bytes, type) : null;
  const ring = keyring();
  await docs.set("proof", {
    orderId: ring.encrypt(input.orderId, pathOf(ctx.dealId, "proof", "orderId")),
    notes: input.notes ? ring.encrypt(input.notes, pathOf(ctx.dealId, "proof", "notes")) : null,
    salt: ring.encrypt(salt, pathOf(ctx.dealId, "proof", "salt")),
    proofHash,
    invoice: stored ?? previous?.invoice ?? null,
    submittedBy: user.uid,
    submittedAt: Date.now(),
  });
  if (stored && previous?.invoice) {
    await storeFor(previous.invoice)
      .delete(`deals/${ctx.dealId}`, previous.invoice)
      .catch((error) => log("warn", "proof.old_invoice_delete_failed", errorFields(error)));
  }
  return {
    dealId: ctx.dealId,
    proofHash,
    invoice: stored ? { contentType: stored.contentType, size: stored.size } : null,
  };
}

const PROOF_STATUSES = {
  sharer: [
    DealStatus.Locked,
    DealStatus.Delivered,
    DealStatus.Disputed,
    DealStatus.Completed,
    DealStatus.Resolved,
  ],
  seeker: [DealStatus.Delivered, DealStatus.Disputed, DealStatus.Completed, DealStatus.Resolved],
};

async function requireProofReader(user: AuthUser, idParam: string | undefined) {
  const ctx = await requireParty(user, idParam, {
    roles: ["sharer", "seeker"],
    statuses: PROOF_STATUSES.sharer,
    stateMessage: "The order proof is not available for this deal now.",
  });
  if (!PROOF_STATUSES[ctx.role].includes(ctx.deal.status as DealStatus)) {
    throw new AppError("CHAIN_STATE_MISMATCH", {
      message: "The order proof is shown once the deal is delivered.",
    });
  }
  const doc = await privateDocs(ctx.dealId, proofDocSchema).get("proof");
  if (!doc) throw new AppError("NOT_FOUND", { message: "No order proof has been submitted yet." });
  return { ctx, doc };
}

export async function readProof(user: AuthUser, idParam: string | undefined) {
  const { ctx, doc } = await requireProofReader(user, idParam);
  const ring = keyring();
  const orderId = ring
    .decrypt(doc.orderId, pathOf(ctx.dealId, "proof", "orderId"))
    .toString("utf8");
  const notes = doc.notes
    ? ring.decrypt(doc.notes, pathOf(ctx.dealId, "proof", "notes")).toString("utf8")
    : null;
  await logAccess(ctx.dealId, user.uid, "proof", ctx.role);
  return {
    dealId: ctx.dealId,
    orderId,
    notes,
    proofHash: doc.proofHash as Hex,
    onChainProofHash: ctx.deal.proofHash,
    matchesChain: doc.proofHash.toLowerCase() === ctx.deal.proofHash.toLowerCase(),
    invoice: doc.invoice
      ? {
          contentType: doc.invoice.contentType,
          size: doc.invoice.size,
          path: `/api/deals/${ctx.dealId}/invoice`,
        }
      : null,
    submittedAt: new Date(doc.submittedAt).toISOString(),
  };
}

export async function readInvoice(user: AuthUser, idParam: string | undefined) {
  const { ctx, doc } = await requireProofReader(user, idParam);
  if (!doc.invoice) throw new AppError("NOT_FOUND", { message: "No invoice was uploaded." });
  const bytes = await storeFor(doc.invoice).get(`deals/${ctx.dealId}`, doc.invoice);
  await logAccess(ctx.dealId, user.uid, "invoice", ctx.role);
  return { dealId: ctx.dealId, bytes, contentType: doc.invoice.contentType };
}
