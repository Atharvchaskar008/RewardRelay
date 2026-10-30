import { ApiError, type ApiErrorCode } from "./errors";
import type {
  AdminDisputeView,
  Challenge,
  CodeAuthorization,
  DealView,
  DeliveryDetails,
  EncryptedKey,
  EvidenceClaim,
  EvidenceReceipt,
  FaultParty,
  HealthReport,
  ListingView,
  MyDealItem,
  ProofReceipt,
  ProofView,
  RevealedCode,
  UserView,
} from "./types";

/**
 * Typed client for the SAKER API. Adds the Firebase ID token and an Idempotency-Key to every
 * state-changing call, unwraps the `{ ok, data }` envelope and throws `ApiError` with the server's
 * catalogue code. A network failure is retried once with the *same* idempotency key, so a retried
 * POST can never run twice.
 */

export interface ApiClientOptions {
  /** API origin; "" (default) = same origin. */
  baseUrl?: string;
  /** Returns the current Firebase ID token (or null when signed out). */
  getIdToken: () => Promise<string | null>;
  fetch?: typeof fetch;
}

interface RequestOptions {
  body?: unknown;
  form?: FormData;
  query?: Record<string, string | undefined>;
  idempotent?: boolean;
  auth?: boolean;
  raw?: boolean;
}

const newKey = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export function createApiClient(options: ApiClientOptions) {
  const baseUrl = options.baseUrl ?? "";
  const doFetch = options.fetch ?? ((input, init) => fetch(input, init));

  async function request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
    const url = new URL(
      `${baseUrl}${path}`,
      baseUrl ? undefined : (globalThis.location?.origin ?? "http://localhost"),
    );
    for (const [key, value] of Object.entries(opts.query ?? {})) {
      if (value !== undefined && value !== "") url.searchParams.set(key, value);
    }
    const headers: Record<string, string> = { accept: "application/json" };
    if (opts.auth !== false) {
      const token = await options.getIdToken();
      if (token) headers.authorization = `Bearer ${token}`;
    }
    if (opts.idempotent) headers["idempotency-key"] = newKey();
    let body: BodyInit | undefined;
    if (opts.form) body = opts.form;
    else if (opts.body !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(opts.body);
    }
    const target = baseUrl ? url.toString() : `${url.pathname}${url.search}`;

    let response: Response | undefined;
    for (let attempt = 1; attempt <= 2 && !response; attempt++) {
      try {
        response = await doFetch(target, { method, headers, body });
      } catch {
        if (attempt === 2) {
          throw new ApiError("NETWORK", "We could not reach SAKER. Check your connection.", 0);
        }
      }
    }
    if (!response) throw new ApiError("NETWORK", "We could not reach SAKER.", 0);
    if (opts.raw && response.ok) return (await response.blob()) as T;

    const json = (await response.json().catch(() => null)) as
      | { ok: true; data: T }
      | {
          ok: false;
          error: {
            code: ApiErrorCode;
            message: string;
            requestId: string;
            details?: Record<string, unknown>;
          };
        }
      | null;
    if (!json)
      throw new ApiError("INTERNAL", "Unexpected response from the server.", response.status);
    if (!json.ok) {
      throw new ApiError(
        json.error.code,
        json.error.message,
        response.status,
        json.error.requestId,
        json.error.details,
      );
    }
    return json.data;
  }

  const enc = encodeURIComponent;

  return {
    request,
    health: () => request<HealthReport>("GET", "/api/health", { auth: false }),

    auth: {
      token: (address: string) =>
        request<{ token: string; uid: string }>("POST", "/api/auth/token", {
          body: { address },
          auth: false,
        }),
      challenge: (address: string) =>
        request<Challenge>("POST", "/api/auth/challenge", { body: { address } }),
      linkWallet: (input: {
        address: string;
        message: string;
        signature: string;
        walletKind?: "embedded" | "injected";
      }) => request<UserView>("POST", "/api/auth/link-wallet", { body: input, idempotent: true }),
    },

    /** The signed-in user, or null before a wallet is linked. */
    me: async (): Promise<UserView | null> => {
      try {
        return await request<UserView>("GET", "/api/me");
      } catch (error) {
        if (error instanceof ApiError && error.code === "NOT_FOUND") return null;
        throw error;
      }
    },

    /** The caller's deals as sharer or seeker. */
    myDeals: () => request<{ items: MyDealItem[] }>("GET", "/api/me/deals"),

    wallet: {
      putBackup: (backup: EncryptedKey) =>
        request<{ address: string; version: number; updatedAt: number }>(
          "PUT",
          "/api/wallet/backup",
          { body: backup },
        ),
      getBackup: () => request<EncryptedKey & { updatedAt: number }>("GET", "/api/wallet/backup"),
    },

    codes: {
      authorize: (input: { code: string; category: string }) =>
        request<CodeAuthorization>("POST", "/api/codes/authorize", {
          body: input,
          idempotent: true,
        }),
    },

    listings: {
      create: (input: {
        dealId: string;
        title: string;
        description: string;
        category: string;
        faceValueInr: number;
        priceInr: number;
        eventTime?: number | null;
        terms?: Record<string, unknown>;
      }) => request<ListingView>("POST", "/api/listings", { body: input, idempotent: true }),
      list: (query: { category?: string; cursor?: string; status?: "open" | "all" } = {}) =>
        request<{ items: ListingView[]; nextCursor: string | null }>("GET", "/api/listings", {
          query,
          auth: false,
        }),
    },

    deals: {
      get: (id: string) => request<DealView>("GET", `/api/deals/${enc(id)}`),
      submitDetails: (id: string, details: DeliveryDetails) =>
        request<{ dealId: string; submitted: boolean }>("POST", `/api/deals/${enc(id)}/details`, {
          body: details,
          idempotent: true,
        }),
      getDetails: (id: string) =>
        request<{ dealId: string; details: DeliveryDetails; submittedAt: string }>(
          "GET",
          `/api/deals/${enc(id)}/details`,
        ),
      submitProof: (id: string, input: { orderId: string; notes?: string; invoice?: Blob }) => {
        if (!input.invoice) {
          return request<ProofReceipt>("POST", `/api/deals/${enc(id)}/proof`, {
            body: { orderId: input.orderId, notes: input.notes },
            idempotent: true,
          });
        }
        const form = new FormData();
        form.set("orderId", input.orderId);
        if (input.notes) form.set("notes", input.notes);
        form.set("invoice", input.invoice, "invoice");
        return request<ProofReceipt>("POST", `/api/deals/${enc(id)}/proof`, {
          form,
          idempotent: true,
        });
      },
      getProof: (id: string) => request<ProofView>("GET", `/api/deals/${enc(id)}/proof`),
      invoice: (id: string) => request<Blob>("GET", `/api/deals/${enc(id)}/invoice`, { raw: true }),
      code: (id: string) => request<RevealedCode>("GET", `/api/deals/${enc(id)}/code`),
    },

    disputes: {
      submitEvidence: (
        id: string,
        input: { claim: EvidenceClaim; text: string; files?: Blob[] },
      ) => {
        if (!input.files?.length) {
          return request<EvidenceReceipt>("POST", `/api/disputes/${enc(id)}/evidence`, {
            body: { claim: input.claim, text: input.text },
            idempotent: true,
          });
        }
        const form = new FormData();
        form.set("claim", input.claim);
        form.set("text", input.text);
        for (const file of input.files) form.append("files", file, "evidence");
        return request<EvidenceReceipt>("POST", `/api/disputes/${enc(id)}/evidence`, {
          form,
          idempotent: true,
        });
      },
    },

    admin: {
      disputes: () => request<{ items: AdminDisputeView[] }>("GET", "/api/admin/disputes"),
      resolve: (
        id: string,
        ruling: { seekerShareBps: number; faultParty: FaultParty; reason: string },
      ) =>
        request<{ dealId: string; status: string; txHash: string; txUrl: string; auditId: string }>(
          "POST",
          `/api/admin/disputes/${enc(id)}/resolve`,
          { body: ruling, idempotent: true },
        ),
      evidenceFile: (path: string) => request<Blob>("GET", path, { raw: true }),
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
