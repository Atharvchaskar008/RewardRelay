import { AppError } from "@/src/server/errors";
import { withRoute } from "@/src/server/http";
import { MAX_UPLOAD_BYTES } from "@/src/server/files/store";
import {
  proofInputSchema,
  readProof,
  submitProof,
  type InvoiceUpload,
} from "@/src/server/deals/proof";

export const dynamic = "force-dynamic";

/** Multipart overhead allowance on top of the 2 MB file limit. */
const MAX_REQUEST_BYTES = MAX_UPLOAD_BYTES + 64 * 1024;

/**
 * POST /api/deals/:id/proof (sharer, while Locked; Idempotency-Key)
 * JSON {orderId, notes?} or multipart/form-data with fields orderId, notes and an optional
 * `invoice` file (PDF/JPEG/PNG ≤ 2 MB). Returns proofHash for markDelivered(id, proofHash).
 */
export const POST = withRoute(
  { name: "deals.proof.post", idempotent: true, rateLimit: { capacity: 10, refillPerMinute: 5 } },
  async ({ req, user, params }) => {
    if (Number(req.headers.get("content-length") ?? "0") > MAX_REQUEST_BYTES) {
      throw new AppError("VALIDATION_FAILED", { message: "Files must be 2 MB or smaller." });
    }
    const contentType = req.headers.get("content-type") ?? "";
    let fields: Record<string, unknown>;
    let invoice: InvoiceUpload | undefined;
    if (contentType.startsWith("multipart/form-data")) {
      const form = (await req.formData().catch(() => {
        throw new AppError("VALIDATION_FAILED", { message: "The upload could not be read." });
      })) as unknown as { get(name: string): FormDataEntryValue | null };
      fields = { orderId: form.get("orderId") ?? undefined, notes: form.get("notes") || undefined };
      const file = form.get("invoice");
      if (file instanceof File && file.size > 0) {
        invoice = { bytes: Buffer.from(await file.arrayBuffer()), contentType: file.type };
      }
    } else {
      fields = (await req.json().catch(() => {
        throw new AppError("VALIDATION_FAILED", { message: "The request body must be JSON." });
      })) as Record<string, unknown>;
    }
    return submitProof(user!, params.id, proofInputSchema.parse(fields), invoice);
  },
);

/** GET /api/deals/:id/proof (either party, once delivered; sharer also while Locked). */
export const GET = withRoute(
  { name: "deals.proof.get", rateLimit: { capacity: 30, refillPerMinute: 30 } },
  async ({ user, params }) => readProof(user!, params.id),
);
