import { NextRequest } from "next/server";

/**
 * An in-process `fetch` for the SDK: requests to http://localhost:3000/api/... are dispatched to the
 * real Next.js route handlers (same wrapper, same validation), with no server process.
 */

type Handler = (
  req: NextRequest,
  ctx: { params: Promise<Record<string, string>> },
) => Promise<Response>;
type RouteModule = Partial<Record<"GET" | "POST" | "PUT", Handler>>;

const ROUTES: [string, () => Promise<RouteModule>][] = [
  ["/api/health", () => import("@/app/api/health/route")],
  ["/api/auth/challenge", () => import("@/app/api/auth/challenge/route")],
  ["/api/auth/link-wallet", () => import("@/app/api/auth/link-wallet/route")],
  ["/api/me", () => import("@/app/api/me/route")],
  ["/api/wallet/backup", () => import("@/app/api/wallet/backup/route")],
  ["/api/codes/authorize", () => import("@/app/api/codes/authorize/route")],
  ["/api/listings", () => import("@/app/api/listings/route")],
  ["/api/deals/:id", () => import("@/app/api/deals/[id]/route")],
  ["/api/deals/:id/details", () => import("@/app/api/deals/[id]/details/route")],
  ["/api/deals/:id/proof", () => import("@/app/api/deals/[id]/proof/route")],
  ["/api/deals/:id/invoice", () => import("@/app/api/deals/[id]/invoice/route")],
  ["/api/deals/:id/code", () => import("@/app/api/deals/[id]/code/route")],
  ["/api/disputes/:id/evidence", () => import("@/app/api/disputes/[id]/evidence/route")],
  ["/api/admin/disputes", () => import("@/app/api/admin/disputes/route")],
  ["/api/admin/disputes/:id/resolve", () => import("@/app/api/admin/disputes/[id]/resolve/route")],
  [
    "/api/admin/disputes/:id/files/:fileId",
    () => import("@/app/api/admin/disputes/[id]/files/[fileId]/route"),
  ],
];

function match(pattern: string, path: string): Record<string, string> | null {
  const a = pattern.split("/");
  const b = path.split("/");
  if (a.length !== b.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith(":")) params[a[i].slice(1)] = decodeURIComponent(b[i]);
    else if (a[i] !== b[i]) return null;
  }
  return params;
}

export const routerFetch: typeof fetch = async (input, init) => {
  const url = new URL(
    typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
  );
  for (const [pattern, load] of ROUTES) {
    const params = match(pattern, url.pathname);
    if (!params) continue;
    const routeModule = await load();
    const handler = routeModule[(init?.method ?? "GET") as "GET" | "POST" | "PUT"];
    if (!handler) return new Response(null, { status: 405 });
    return handler(new NextRequest(url, init as ConstructorParameters<typeof NextRequest>[1]), {
      params: Promise.resolve(params),
    });
  }
  return new Response(
    JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: url.pathname } }),
    {
      status: 404,
    },
  );
};
