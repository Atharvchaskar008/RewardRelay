import { withRoute } from "@/server/http";
import { readInvoice } from "@/server/deals/proof";

export const dynamic = "force-dynamic";

const EXTENSIONS: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
};

/** GET /api/deals/:id/invoice → the decrypted invoice file, for the deal's parties only. */
export const GET = withRoute(
  { name: "deals.invoice.get", rateLimit: { capacity: 20, refillPerMinute: 10 } },
  async ({ user, params }) => {
    const { dealId, bytes, contentType } = await readInvoice(user!, params.id);
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(bytes.length),
        "Content-Disposition": `attachment; filename="invoice-${dealId}.${EXTENSIONS[contentType] ?? "bin"}"`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-store",
      },
    });
  },
);
