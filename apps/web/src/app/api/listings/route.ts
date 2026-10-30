import { z } from "zod";
import { respond, withRoute } from "@/server/http";
import { listListings, registerListing } from "@/server/listings/service";

export const dynamic = "force-dynamic";

const termValue = z.union([
  z.string().max(300),
  z.number(),
  z.boolean(),
  z.array(z.string().max(120)).max(10),
]);

/**
 * POST /api/listings (after the createListing transaction; Idempotency-Key)
 * The metadata is published only if it matches the on-chain deal: status Listed, the caller is the
 * sharer, the category/event time match, the ₹ price matches the wei price at the demo rate (±1 wei)
 * and keccak256(canonical terms) equals the on-chain termsHash.
 */
export const POST = withRoute(
  {
    name: "listings.create",
    idempotent: true,
    body: z
      .object({
        dealId: z.string().regex(/^[1-9]\d{0,18}$/, "expected a deal id"),
        title: z.string().trim().min(3).max(80),
        description: z.string().trim().max(500).default(""),
        category: z.string().min(1).max(32),
        faceValueInr: z.number().min(0).max(10_000_000),
        priceInr: z.number().positive().max(10_000_000),
        eventTime: z.number().int().min(0).nullable().optional(),
        terms: z.record(z.string().max(40), termValue).default({}),
      })
      .strict()
      .refine((body) => Object.keys(body.terms).length <= 20, {
        message: "at most 20 terms",
        path: ["terms"],
      }),
    rateLimit: { capacity: 10, refillPerMinute: 10 },
  },
  async ({ body, user }) => respond(await registerListing(user!.uid, body), { status: 201 }),
);

/** GET /api/listings?category=&cursor=&status=open|all → public, paginated, status read from chain. */
export const GET = withRoute(
  {
    name: "listings.list",
    auth: "none",
    query: z.object({
      category: z.string().max(32).optional(),
      cursor: z
        .string()
        .regex(/^\d{1,19}$/)
        .optional(),
      status: z.enum(["open", "all"]).default("open"),
    }),
    rateLimit: { capacity: 60, refillPerMinute: 60 },
    cacheControl: "public, s-maxage=5, stale-while-revalidate=20",
  },
  async ({ query }) => listListings(query),
);
