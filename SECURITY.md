# RewardRelay security

Status: **MVP on MST Testnet** (test MSTC only, no real money). This document covers the web app and
API (`apps/web`); the smart-contract protocol, its invariants and its threat model are in
[docs/protocol.md](docs/protocol.md) (§4 invariants, §10 threat model, §12 static analysis).

**Reporting a vulnerability:** please do not open a public issue. Use GitHub's private
[security advisory form](https://github.com/Atharvchaskar008/RewardRelay/security/advisories/new);
expect an acknowledgement within 72 hours.

---

## 1. What we protect

| Asset                                                   | Where it lives                                                                | Who may use it                                                                             |
| ------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Escrowed MSTC (prices, deposits)                        | `RelayEscrow` contract                                                        | only the contract's state machine; nobody can withdraw another party's funds               |
| Trust Badges                                            | `ReputationSBT` (soulbound)                                                   | minted by the server signer after phone verification; outcomes recorded only by the escrow |
| Delivery details (name, phone, address)                 | Firestore `deals/{id}/private/details`, envelope-encrypted                    | the deal's sharer, while the deal is Locked or Delivered                                   |
| Order ids, invoices                                     | Firestore `deals/{id}/private/proof` + encrypted file chunks                  | both parties after delivery (sharer from Locked); the admin during a dispute               |
| Pass-on codes                                           | Firestore `vault/{fingerprint}`, envelope-encrypted                           | the paying seeker only, once the chain shows the payment in escrow                         |
| Dispute evidence                                        | Firestore `disputes/{id}` + encrypted files                                   | the admin (arbiter desk); the hash is on-chain                                             |
| User wallet keys                                        | the user's browser (IndexedDB), PIN-encrypted; encrypted backup on the server | the user (PIN)                                                                             |
| Server signer keys (verifier/arbiter, funder, releaser) | server environment variables                                                  | the API only                                                                               |
| Data keys (`DATA_KEYS`), HMAC keys, `CRON_SECRET`       | server environment variables                                                  | the API only                                                                               |

Trust boundaries: browser ↔ API (Firebase ID token over HTTPS), API ↔ Firestore (Admin SDK, service
account), API/browser ↔ MST RPC, cron-job.org ↔ `/api/cron/release` (shared secret).

---

## 2. Threat model

| #   | Threat                                                         | Mitigation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Residual risk                                                                               |
| --- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| T1  | Contract-level theft, reentrancy, stuck funds                  | Reviewed state machine, CEI + `nonReentrant`, push-with-pull payouts, solvency invariant, 100 tests incl. a randomized invariant run, 100% coverage, Slither 0 high/medium (SPEC.md)                                                                                                                                                                                                                                                                                                                   | No external audit yet                                                                       |
| T2  | Account takeover                                               | Firebase phone OTP; every write and every read of private data verifies the ID token **with revocation check**, other reads within a minute of the last check (§5 item 13); wallet key never leaves the browser unencrypted                                                                                                                                                                                                                                                                            | SIM-swap on the phone number                                                                |
| T3  | Sybil / badge or top-up farming                                | One phone ↔ one wallet ↔ one uid, enforced in a Firestore transaction; a deleted and re-registered phone is still blocked (phone hash index); welcome top-up at most once (transactional claim; never resent after broadcast)                                                                                                                                                                                                                                                                          | Many real phone numbers                                                                     |
| T4  | Wallet-link replay / hijack                                    | SIWE-style message built by the server (domain/URI from `APP_URL`, chain id), single-use nonce bound to the uid, 5-minute expiry, byte-exact message comparison, signature by the named address                                                                                                                                                                                                                                                                                                        | —                                                                                           |
| T5  | Pass-on authorisation replay or theft                          | EIP-712 `ListingAuth(sharer, fingerprint, nonce, deadline)` bound to chain id + escrow; sequential nonce consumed on-chain; deadline from the chain clock; fingerprint = HMAC of the normalised code (duplicates refused off- and on-chain)                                                                                                                                                                                                                                                            | —                                                                                           |
| T6  | Duplicate side effects (double POST, retries)                  | `Idempotency-Key` required on state-changing POSTs; stored response replayed; different payload with the same key → `CONFLICT`; server transactions are signed locally so a network retry rebroadcasts the same raw transaction                                                                                                                                                                                                                                                                        | —                                                                                           |
| T7  | Bait-and-switch listings                                       | The on-chain `termsHash` commits to everything the listing shows (title, description, category, ₹ values, event time, conditions); the API publishes metadata only if it hashes to the on-chain value and the ₹ price matches the wei price                                                                                                                                                                                                                                                            | —                                                                                           |
| T8  | Access to private data by the wrong party or at the wrong time | `requireParty`: the deal is **re-read from the chain** on every request; non-parties are refused before any state is revealed; status allowlists per path (details only while Locked/Delivered, code only once paid); every read is logged (who/when, never what)                                                                                                                                                                                                                                      | The server operator can decrypt (see §5)                                                    |
| T9  | Fake delivery proof                                            | `proofHash = keccak256(abi.encode(dealId, orderId, salt))` committed by `markDelivered`; salt kept encrypted so the order id cannot be brute-forced from the chain; the API shows whether the stored proof matches the chain; the rulebook refunds when it does not                                                                                                                                                                                                                                    | The order id itself is a claim; disputes cover it                                           |
| T10 | Dispute abuse                                                  | Evidence bundles hashed and committed on-chain by each party; only committed evidence counts in the rulebook; per-party evidence limits; default 50/50 ruling after the arbiter timeout                                                                                                                                                                                                                                                                                                                | Admin judgement is centralised (MVP)                                                        |
| T11 | Arbiter / admin abuse                                          | Admin routes limited to `ADMIN_UIDS`; the contract bounds rulings to the deal's own funds and forbids the arbiter signer from being a party; **the API also refuses an admin ruling on a deal the admin is part of**; append-only audit record (admin uid, ruling, reason, tx hash)                                                                                                                                                                                                                    | A malicious admin could still rule unfairly on others' deals (visible on-chain + audit log) |
| T12 | Server key compromise                                          | Separate keys per role; signers hold only small gas balances (health check warns when low); roles can be revoked on-chain by the admin key                                                                                                                                                                                                                                                                                                                                                             | Deployer/admin key is a single EOA (should be a multisig)                                   |
| T13 | Firestore data exfiltration                                    | All personal data, codes and evidence are envelope-encrypted (AES-256-GCM, per-record data key wrapped by a key id from `DATA_KEYS`, AAD = record path); phone numbers stored only as HMAC; Firestore rules deny every client write and every read except public listings                                                                                                                                                                                                                              | Data keys live in env (no KMS)                                                              |
| T14 | Malicious uploads                                              | PDF/JPEG/PNG only, ≤ 2 MB each, ≤ 3 per evidence item, **magic-byte sniffing must match the declared type**; stored encrypted; served as `attachment` with `nosniff` and `no-store`                                                                                                                                                                                                                                                                                                                    | Platform body limit (4.5 MB on Vercel) bounds chunked uploads                               |
| T15 | Abuse / denial of service                                      | Token-bucket rate limits per uid (per IP hash when anonymous) on every route except the secret-protected cron; JSON bodies ≤ 64 KiB; every Firestore call (repository layer, queries, the file store, the cron lease) and every Firebase Auth call has an 8 s deadline that names the operation in the logs (fail fast with a user-safe 500 instead of hanging); RPC calls have timeouts and retries, and every read is capped at 9 s (an outage answers "temporarily unavailable" instead of hanging) | Rate limiting depends on Firestore (fails closed during an outage)                          |
| T16 | Open RPC relay                                                 | `/api/rpc/[network]` serves only the configured chain, an allowlist of read methods + `eth_sendRawTransaction` (already-signed transactions; any other method gets a JSON-RPC `-32601` reply and never reaches the node), ≤ 20 calls per batch, ≤ 32 KiB (checked before reading), per-IP in-memory rate limit, upstream timeout; the node receives a body rebuilt from the validated calls, so parser differences cannot smuggle another method                                                       | —                                                                                           |
| T17 | XSS, clickjacking, mixed content                               | React escaping; CSP (`default-src 'self'`, no `unsafe-eval` in production, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, **`frame-ancestors 'none'`**, `upgrade-insecure-requests`); `X-Frame-Options: DENY`; `nosniff`; strict referrer policy; Permissions-Policy denies camera/mic/geolocation/payment/USB; HSTS                                                                                                                                                                    | `script-src 'unsafe-inline'` (see §5)                                                       |
| T18 | CSRF                                                           | The API authenticates with bearer ID tokens, not cookies, so a cross-site request carries no credentials; no CORS headers are sent                                                                                                                                                                                                                                                                                                                                                                     | —                                                                                           |
| T19 | Secret leakage                                                 | Secrets only in git-ignored env files; env validation errors name variables, never values; structured logs redact sensitive keys and identify users by a short uid hash; full git-history secret scan clean (§4)                                                                                                                                                                                                                                                                                       | —                                                                                           |
| T20 | Vulnerable dependencies                                        | `npm audit --omit=dev` = 0 vulnerabilities after the H14 upgrades and overrides (§4)                                                                                                                                                                                                                                                                                                                                                                                                                   | New advisories over time                                                                    |

---

## 3. Controls by layer

- **Every API route** goes through `withRoute` (`apps/web/src/server/http.ts`): request id → Firebase ID token
  (`checkRevoked` on writes, private reads and admin routes; other reads reuse a per-user revocation check
  for up to a minute) → admin allowlist → rate limit (Firestore for writes and private reads, in-memory
  per instance for other reads) → zod validation → idempotency → handler → one error
  catalogue (`{ ok: false, error: { code, message, requestId } }`, messages always user-safe) →
  structured log without personal data.
- **Chain is the source of truth**: private-data access, code reveal, listing publication, dispute
  resolution and the cron all re-read the deal on-chain before acting.
- **Server transactions** (`TxManager`): simulate first, legacy 1 gwei, per-signer nonce mutex,
  idempotent rebroadcast, receipt timeout.
- **Firestore rules** (`apps/web/firestore.rules`): public read on `listings` only; every client write denied;
  covered by an emulator test.
- **Embedded wallet**: key generated in the browser; stored only encrypted with the PIN
  (PBKDF2-SHA-256 310,000 iterations → AES-256-GCM, address as AAD); auto-lock after 30 minutes idle;
  server backups refuse anything that looks like a raw key.

---

## 4. H14 review results (27 Oct 2026)

Method: a manual review of the backend, SDK and UI against the H14 checklist (access control on
every route, chain-state gating, replay, idempotency, rate limits, uploads, headers, dependencies,
secrets, Firestore rules, contract invariants), `npm audit --omit=dev`, a secret scan of the full git
history, and the automated code review (`/code-review` at high effort) of the H14 changes.

| ID  | Severity              | Finding                                                                                                                                                                                                 | Status                                                                                                                                                  |
| --- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Critical (dependency) | Next.js 14.2 (end of life) affected by advisories incl. an App Router request-deserialization DoS; no patched 14.x exists                                                                               | **Fixed**: upgraded to Next 15.5.28 + React 19.3 (async route params, `serverExternalPackages`)                                                         |
| R2  | High (dependency)     | postcss < 8.5.23 (Next's CSS pipeline), zod < 4.6.6 (under `@vercel/blob` → `@vercel/cli-config`), `@grpc/grpc-js` ≤ 1.13.5 (Firebase client SDK), glob CLI 10.2-10.4.5                                 | **Fixed**: npm `overrides` (postcss 8.5.32, grpc-js 1.14.6, zod 4.6.7) and `npm audit fix`                                                              |
| R3  | Medium                | No CSP / security headers                                                                                                                                                                               | **Fixed**: headers in `next.config.js` (see T17)                                                                                                        |
| R4  | Medium                | `/api/rpc/[network]` was an open JSON-RPC relay (any method, no limits)                                                                                                                                 | **Fixed**: see T16; integration-tested                                                                                                                  |
| R5  | Medium                | API requests hung when Firestore was unreachable (rate limiter / idempotency waits)                                                                                                                     | **Fixed**: 8 s deadline on Firestore calls and token verification; an outage returns 500 "temporarily unavailable" (not "session expired"); unit-tested |
| R6  | Medium                | An admin could resolve a dispute on a deal they are a party to (the contract only blocks the arbiter signer)                                                                                            | **Fixed**: API refuses it (403); integration-tested                                                                                                     |
| R7  | Low                   | `X-Powered-By` header                                                                                                                                                                                   | **Fixed** (`poweredByHeader: false`)                                                                                                                    |
| R8  | Low                   | Multipart uploads without `Content-Length` are read fully before the size check                                                                                                                         | Accepted: the platform body limit applies; browsers always send the length                                                                              |
| R9  | Low                   | Rate limiter keys anonymous callers by the first `X-Forwarded-For` entry                                                                                                                                | Accepted on Vercel (the edge sets it); revisit on other hosts                                                                                           |
| R10 | Medium                | (automated review) The RPC relay validated its own parse of the body but forwarded the raw text, so a node with case-insensitive or duplicate-key JSON parsing could run a method outside the allowlist | **Fixed**: the forwarded body is rebuilt from the validated calls; integration-tested                                                                   |
| R11 | Medium                | (automated review) A failure while storing an idempotent response turned a request that had already taken effect into an error and released its key, so a retry could run it twice                      | **Fixed**: the success response is returned and the claim stays "pending" (a retry gets CONFLICT); unit-tested                                          |
| R12 | Medium                | (automated review) An admin who is a party could still list the dispute and read the other side's evidence and files                                                                                    | **Fixed**: one guard for the desk, evidence files and resolve; integration-tested                                                                       |
| R13 | Medium                | (automated review) The deadline covered only the wrapper's Firestore calls; handler-level calls could still hang                                                                                        | **Fixed**: the deadline is in the repository layer (`Collection` methods and `transaction()`)                                                           |
| R14 | Medium                | (automated review) The relay ran a Firestore transaction per JSON-RPC call with a low per-IP limit (cost, contention, users behind one NAT)                                                             | **Fixed**: in-memory per-instance limiter, 300 burst / 600 per minute per IP                                                                            |
| R15 | Low                   | (automated review) The client's default RPC path was always `/api/rpc/testnet`, which the relay refuses on other chains                                                                                 | **Fixed**: the path is derived from the chain id (`rpcRelayPath` in `packages/shared`)                                                                  |
| R16 | Low                   | (automated review) The relay read the whole body before its size check, and duplicated the chain ids                                                                                                    | **Fixed**: `Content-Length` precheck; ids from `packages/shared`                                                                                        |
| R17 | Low                   | (automated review) A Firestore transaction that outlives its deadline may still commit an idempotency claim; retries with that key get CONFLICT until the claim expires                                 | Accepted: bounded by the 2-minute pending TTL; the alternative is hanging                                                                               |

The automated review covered the H14 changes (R10-R17); every high/medium finding is fixed in the
same commit as R1-R7, and all test suites were re-run afterwards.

**Dependency audit:** before 11 vulnerabilities (1 critical, 10 high) → after **0**.
**Secret scan:** `git log --all -p` checked for every non-public value of the local `.env` files,
private-key/API-token patterns and forbidden paths (`.env`, keys, service-account JSON, `docs/`,
`harness.md`): **nothing found**; no AI attribution in commit messages.

---

## 5. Known MVP shortcuts (accepted for the buildathon)

1. **Test MSTC only** and a **demo ₹ rate** (₹1,00,000 per MSTC); no real-money flows.
2. **Server-side Code Vault**: the server decrypts Pass-on codes to reveal them; whoever controls the
   server and its data keys can read codes and delivery details. Roadmap: client-side encryption to
   the seeker's key, or zkTLS-style proofs.
3. **Admin arbiter**: disputes are decided by allowlisted admins through one server signer
   (`ARBITER_ROLE`); bounded by the contract and logged, but centralised. Roadmap: jury/DAO arbitration.
4. **Firebase test phone numbers** for the demo (configured in the Firebase console, never in the repo).
5. **PIN-protected wallet**: a 6-12 digit PIN with PBKDF2 310k slows but cannot stop an offline
   brute force of a stolen backup blob; backups are only served to the authenticated owner (5 per hour).
   Roadmap: passkeys / SARAL onboarding.
6. **Keys in environment variables**: data keys, HMAC keys and signer keys live in Vercel env (no KMS
   or HSM); key ids support rotation of data keys.
7. **CSP allows inline scripts** (`'unsafe-inline'`) because the App Router bootstrap needs them
   without nonces; nonce-based CSP via middleware is the next step.
8. **Single-EOA admin**: the deployer holds DEFAULT_ADMIN/POLICY_ADMIN/PAUSER on both contracts;
   move to a multisig before mainnet.
9. **Contracts not externally audited**. Their sources are verified on testnet.mstscan.com (full
   match: solc 0.8.24, evmVersion shanghai, optimizer 200 runs).
10. **Vercel Blob adapter** exists behind the file-store interface but is not exercised by the tests
    (Firestore storage is used).
11. **EOA signatures only** for wallet linking (no ERC-1271 smart-contract wallets); a linked browser
    wallet (BridgeKey, MetaMask) holds its own key, so RewardRelay keeps no backup for it.
12. **Release-on-visit** is best effort; the cron (every 2 minutes) is the guarantee.
13. **Lighter checks on public reads** (for speed): reads that return no private data (deal views,
    feeds, `/api/me`, badges) accept a revoked session for up to a minute after the last per-user
    revocation check and are rate-limited per instance in memory. Writes, admin routes and private
    reads (delivery details, order proofs, invoices, codes, wallet backups) keep the per-request
    revocation check and the shared Firestore rate limit.

---

## 6. Operations

- **Rotate a data key**: add `kN:<base64>` to `DATA_KEYS`, set `DATA_KEY_ID=kN`; old records keep
  decrypting while their key stays listed.
- **Rotate a server signer**: generate a new key, grant the role(s) on-chain from the admin key, update
  the env, revoke the old address's roles.
- **Incident**: `pause()` the escrow (blocks new listings and payments only; every open deal can still
  finish), revoke compromised roles, rotate secrets, check `/api/health` and the audit collection.
- **Live deployment** (rewardrelay.vercel.app): deployed from the Vercel CLI without a Git
  integration, so no bot has access to the repository; `.vercelignore` keeps every `.env` file and
  private notes out of the upload; server secrets are Vercel _sensitive_ variables (write-only, never
  shown in the dashboard); functions run in Mumbai (`bom1`). Logs carry request ids, routes and
  timings, never phone numbers, delivery details or codes. `npm run check:live` re-checks auth
  refusals, the keeper secret and the security headers from the outside.
- **Reporting a vulnerability**: open a private security advisory on the GitHub repository.
