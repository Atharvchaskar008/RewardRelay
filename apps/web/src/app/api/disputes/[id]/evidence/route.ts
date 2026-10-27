import { AppError } from "@/server/errors";
import { withRoute } from "@/server/http";
import { MAX_UPLOAD_BYTES } from "@/server/files/store";
import {
  MAX_EVIDENCE_FILES,
  evidenceInputSchema,
  submitEvidence,
  type EvidenceFileInput,
} from "@/server/disputes/evidence";

export const dynamic = "force-dynamic";

const MAX_REQUEST_BYTES = MAX_EVIDENCE_FILES * MAX_UPLOAD_BYTES + 64 * 1024;

/**
 * POST /api/disputes/:id/evidence (either party; Idempotency-Key)
 * JSON {claim, text} or multipart/form-data with claim, text and up to 3 `files`
 * (PDF/JPEG/PNG ≤ 2 MB each). Returns evidenceHash for raiseDispute (seeker, while Delivered)
 * or addEvidence (either party, during the evidence window).
 */
export const POST = withRoute(
  {
    name: "disputes.evidence.post",
    idempotent: true,
    rateLimit: { capacity: 10, refillPerMinute: 5 },
  },
  async ({ req, user, params }) => {
    if (Number(req.headers.get("content-length") ?? "0") > MAX_REQUEST_BYTES) {
      throw new AppError("VALIDATION_FAILED", { message: "Files must be 2 MB or smaller." });
    }
    let fields: Record<string, unknown>;
    const files: EvidenceFileInput[] = [];
    if ((req.headers.get("content-type") ?? "").startsWith("multipart/form-data")) {
      const form = (await req.formData().catch(() => {
        throw new AppError("VALIDATION_FAILED", { message: "The upload could not be read." });
      })) as unknown as {
        get(name: string): FormDataEntryValue | null;
        getAll(name: string): FormDataEntryValue[];
      };
      fields = { claim: form.get("claim") ?? undefined, text: form.get("text") ?? undefined };
      for (const entry of form.getAll("files")) {
        if (entry instanceof File && entry.size > 0) {
          files.push({ bytes: Buffer.from(await entry.arrayBuffer()), contentType: entry.type });
        }
      }
    } else {
      fields = (await req.json().catch(() => {
        throw new AppError("VALIDATION_FAILED", { message: "The request body must be JSON." });
      })) as Record<string, unknown>;
    }
    return submitEvidence(user!, params.id, evidenceInputSchema.parse(fields), files);
  },
);
