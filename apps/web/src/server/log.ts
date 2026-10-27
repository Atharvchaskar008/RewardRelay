import "server-only";

/**
 * Structured JSON logs (one line per event, readable in Vercel's log view). Fields whose names look
 * sensitive are dropped, long strings are truncated, and bigints are stringified. Callers must still
 * never pass personal data: identify users by a short hash (`uidTag`), never by phone or name.
 */

type Level = "debug" | "info" | "warn" | "error";

const SENSITIVE_KEY =
  /token|secret|password|private|authorization|cookie|signature|phone|mnemonic|seed|apikey|ciphertext|plaintext|address$|^(code|pin|otp|key|body|name|email)$/i;
const MAX_STRING = 300;

function sanitize(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string") {
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  }
  if (typeof value !== "object") return value;
  if (depth > 3) return "[depth]";
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitize(item, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    out[key] = SENSITIVE_KEY.test(key) ? "[redacted]" : sanitize(inner, depth + 1);
  }
  return out;
}

export function log(level: Level, event: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({
    level,
    time: new Date().toISOString(),
    event,
    ...(sanitize(fields) as Record<string, unknown>),
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

/** Error summary safe for logs: name, catalogue code and a truncated first message line. */
export function errorFields(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) return { errorName: typeof error };
  const cause = error.cause instanceof Error ? error.cause : undefined;
  return {
    errorName: error.name,
    errorCode: (error as { code?: unknown }).code,
    errorMessage: error.message.split("\n")[0],
    causeName: cause?.name,
    causeMessage: cause?.message.split("\n")[0],
  };
}
