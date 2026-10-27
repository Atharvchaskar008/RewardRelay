import { withRoute } from "@/server/http";
import { readEvidenceFile } from "@/server/disputes/admin";

export const dynamic = "force-dynamic";

/** GET /api/admin/disputes/:id/files/:fileId (ADMIN_UIDS) → a decrypted evidence file. */
export const GET = withRoute(
  { name: "admin.disputes.file", admin: true, rateLimit: { capacity: 30, refillPerMinute: 30 } },
  async ({ user, params }) => {
    const { bytes, contentType } = await readEvidenceFile(user!.uid, params.id, params.fileId);
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": "attachment",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-store",
      },
    });
  },
);
