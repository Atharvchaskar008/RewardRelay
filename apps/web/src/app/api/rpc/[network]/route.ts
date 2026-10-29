import { RPC_RELAY_NETWORKS } from "@rewardrelay/shared";
import { serverEnv } from "@/server/env";
import { AppError } from "@/server/errors";
import { withRoute } from "@/server/http";
import { MemoryRateLimiter } from "@/server/services";

export const dynamic = "force-dynamic";

/**
 * Same-origin JSON-RPC relay for the browser: the MST Testnet RPC sends no CORS headers, so the
 * embedded wallet reads state and broadcasts its signed transactions through here.
 *
 * Hardened so it is not an open relay: only the chain this deployment is configured for, only the
 * JSON-RPC methods the app needs (reads, gas estimation and `eth_sendRawTransaction` of transactions
 * the user already signed), bodies ≤ 32 KiB, batches ≤ 20 calls, a per-IP rate limit and an upstream
 * timeout. The upstream receives a body **rebuilt** from the validated calls (only `jsonrpc`, `id`,
 * `method`, `params`), so a node whose JSON parser differs (case-insensitive or duplicate keys) cannot
 * be steered to another method. The relay never signs anything and holds no keys.
 */

const ALLOWED_METHODS = new Set([
  "eth_chainId",
  "net_version",
  "eth_blockNumber",
  "eth_syncing",
  "eth_getBlockByNumber",
  "eth_getBlockByHash",
  "eth_getBalance",
  "eth_getCode",
  "eth_getTransactionCount",
  "eth_call",
  "eth_estimateGas",
  "eth_gasPrice",
  "eth_maxPriorityFeePerGas",
  "eth_feeHistory",
  "eth_sendRawTransaction",
  "eth_getTransactionByHash",
  "eth_getTransactionReceipt",
  "eth_getLogs",
]);

const MAX_BODY_BYTES = 32 * 1024;
const MAX_BATCH = 20;
const UPSTREAM_TIMEOUT_MS = 15_000;
/**
 * Per-instance, in-memory limit: a wallet polling receipts sends many small calls, so a Firestore
 * transaction per call would be costly and contended; this is abuse protection, not accounting.
 * Generous enough for several users behind one NAT.
 */
const RELAY_LIMIT = { capacity: 300, refillPerMinute: 600 };
const limiter = new MemoryRateLimiter();

interface RpcCall {
  jsonrpc: "2.0";
  id: number | string | null;
  method: string;
  params: unknown[] | Record<string, unknown>;
}

interface RpcErrorReply {
  jsonrpc: "2.0";
  id: RpcCall["id"];
  error: { code: number; message: string };
}

/**
 * A method outside the allowlist gets a standard JSON-RPC "method not found" reply rather than an
 * HTTP error: viem then marks it unsupported for the session (e.g. its optional
 * `eth_fillTransaction`, which would turn our legacy transactions into EIP-1559 ones) instead of
 * retrying it as a network failure on every transaction.
 */
function methodNotFound(id: RpcCall["id"]): RpcErrorReply {
  return {
    jsonrpc: "2.0",
    id,
    error: { code: -32601, message: "Method not found: not available through SAKER." },
  };
}

function sanitize(call: unknown): RpcCall | RpcErrorReply {
  const { id, method, params } = (call ?? {}) as Record<string, unknown>;
  const validId =
    id === undefined || id === null || typeof id === "number" || typeof id === "string";
  const validParams = params === undefined || Array.isArray(params) || typeof params === "object";
  if (typeof method !== "string" || !validId || !validParams) {
    throw new AppError("VALIDATION_FAILED", { message: "The request is not valid JSON-RPC." });
  }
  if (!ALLOWED_METHODS.has(method)) return methodNotFound((id as RpcCall["id"]) ?? null);
  return {
    jsonrpc: "2.0",
    id: (id as RpcCall["id"]) ?? null,
    method,
    params: (params as RpcCall["params"]) ?? [],
  };
}

export const POST = withRoute(
  { name: "rpc.relay", auth: "none", rateLimit: false },
  async ({ req, params, ipTag }) => {
    const decision = await limiter.consume(`rpc|${ipTag}`, RELAY_LIMIT);
    if (!decision.allowed) throw new AppError("RATE_LIMITED", { retryAfter: decision.retryAfter });

    const env = serverEnv();
    if (RPC_RELAY_NETWORKS[params.network] !== env.MST_CHAIN_ID) {
      throw new AppError("NOT_FOUND", { message: "Unknown network." });
    }
    const tooLarge = () =>
      new AppError("VALIDATION_FAILED", { message: "The request is too large." });
    if (Number(req.headers.get("content-length") ?? "0") > MAX_BODY_BYTES) throw tooLarge();
    const text = await req.text();
    if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) throw tooLarge();

    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new AppError("VALIDATION_FAILED", { message: "The request body must be JSON-RPC." });
    }
    const calls = Array.isArray(payload) ? payload : [payload];
    if (calls.length === 0 || calls.length > MAX_BATCH) {
      throw new AppError("VALIDATION_FAILED", {
        message: `Send 1 to ${MAX_BATCH} calls per request.`,
      });
    }
    const isBatch = Array.isArray(payload);
    const sanitized = calls.map(sanitize);
    const forward = sanitized.filter((call): call is RpcCall => "method" in call);
    const refused = sanitized.filter((call): call is RpcErrorReply => "error" in call);
    if (forward.length === 0) return Response.json(isBatch ? refused : refused[0]);

    const upstream = await fetch(env.MST_RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(isBatch ? forward : forward[0]),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      cache: "no-store",
    }).catch((error: unknown) => {
      throw new AppError("INTERNAL", {
        message: "The blockchain node is not reachable.",
        cause: error,
      });
    });
    const reply = await upstream.text();
    if (refused.length > 0 && upstream.ok) {
      // A batch with refused calls: merge the node's replies with ours (replies match by id).
      const replies: unknown = (() => {
        try {
          return JSON.parse(reply);
        } catch {
          return undefined;
        }
      })();
      if (Array.isArray(replies)) return Response.json([...replies, ...refused]);
    }
    return new Response(reply, {
      status: upstream.status,
      headers: { "Content-Type": "application/json" },
    });
  },
);
