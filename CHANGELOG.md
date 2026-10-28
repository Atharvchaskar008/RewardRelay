# Changelog

All notable changes to SAKAR are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- A listing above the Sharer's Trust Badge limit is refused with that reason before anything is
  signed (a wallet that could not cover the deposit used to see "not enough MSTC" instead).
- The keeper starts no new action after 20 s, so a busy run stays inside cron-job.org's 30 s timeout.

- **Faster API** (production build against Firebase and MST Testnet, median of warm requests): deal
  page 1.5 s → 0.29 s, `/api/me` 0.88 s → 0.32 s, my deals 0.86 s → 0.32 s, health 1.36 s → 0.30 s,
  listings feed 0.25 s → 0.05 s. Reads that do not depend on each other run side by side; block
  timestamps and deal events are cached (events are rescanned only from the last scanned block); the
  latest block, the pause flag and other users' badges are reused for a few seconds; the deal index
  sync and release-on-visit run after the response; the health checks run in parallel; Firestore uses
  REST instead of gRPC against the real service (faster cold starts).
- Reads that return no private data check session revocation at most once a minute per user and are
  rate-limited per instance; writes, admin routes and private reads keep the per-request checks.
- Wallet setup mints the Trust Badge and sends the welcome top-up at the same time (about half the
  wait).
- The browser SDK checks for transaction receipts every second instead of every 4 s.

### Added

- Live deployment: https://rewardrelay.vercel.app (Vercel, functions in Mumbai). `npm run check:live`
  checks a deployment from the outside: health, feed, deal view, RPC relay, auth and keeper refusals,
  security headers and latency; with `LIVE_DEALS=1` it also runs Buy-for-you, Pass-on, a dispute
  ruling and the cheat demos with test accounts.

- MST Mainnet readiness: `preflight:<network>` prints the deployer, nonce, balance, gas, the
  predicted addresses and the planned configuration without sending anything; a mainnet deploy refuses
  a used deployer (its addresses would differ from testnet's) or a short balance; `POLICY_PROFILE`
  picks demo or production windows; `smoke:mainnet`; the browser takes its relay, explorer, escrow and
  copy from the chain id. Runbook in `docs/mainnet.md`.
- Contract sources verified on testnet.mstscan.com (full match).

- **Browser wallets:** after phone sign-in, a user can link BridgeKey, MetaMask or any EIP-1193
  wallet instead of a PIN wallet (it signs the link challenge, then approves each deal); MST is added
  to the wallet with its public RPC and switched to before each transaction; the choice is remembered
  per account and reconnected without a prompt; the account records `walletKind` so a new device
  asks to connect the wallet rather than for a PIN. Each installed wallet (the BridgeKey extension
  announces itself through EIP-6963) gets its own button.
- Each phone account has its own device wallet in the browser (`RewardRelayProvider accountId`), so
  several accounts can use one browser and a PIN wallet left by another account no longer hides the
  crypto-wallet option. A PIN wallet stored before this change is restored once from its backup.
- Demo data: `npm run seed:demo -w @rewardrelay/web` lists one offer per category from a demo
  Sharer (Firebase test number), checks the balance first and never duplicates an open offer.
- The keeper deletes expired rate-limit, idempotency and wallet-link challenge records (up to 200
  per collection per run; works on the free Spark plan, where Firestore TTL policies are unavailable).
- `apps/web/vercel.json` runs the functions in Mumbai (`bom1`), next to Firestore.
- A `Server-Timing` header on every API response (route phases and busy time per backend) and the
  same timing in the request log.
- Testing guide (`docs/testing.md`), demo walkthrough (`docs/demo.md`), this changelog and a Code of
  Conduct.

### Fixed

- Firestore queries, the file store, the keeper's lease and Firebase Auth lookups now have the 8 s
  deadline, and a timeout names the operation in the logs.
- When the MST RPC hangs, a deal or badge page now answers "SAKAR is temporarily unavailable"
  within about 10 s (it took about 25 s and said "something went wrong"): every RPC read is capped
  at 9 s, the error mapper finds a user-safe error inside wrapped library errors, and the server
  signer still retries a timed-out call as a network error.
- A deal page is still served from the chain when its off-chain parts (the listing's text, the
  delivery-details flag) fail or take longer than 3 s, and the listings feed leaves out a Sharer
  whose badge cannot be read instead of failing; both sync the deal index after the response.
- Concurrent views of one deal share a single in-flight read of the deal and its listing (150
  simultaneous requests: no errors).
- Release-on-visit is no longer cut off when a serverless response ends.
- A dispute ruling that succeeded on-chain is no longer reported as failed when its audit record
  cannot be written at once (the write is retried, then logged in full).
- The in-memory rate limiter drops refilled buckets, so its memory no longer grows with every caller.
- Phone sign-in shows the actual reason when Firebase rejects a request, and accepts a mobile number
  typed with a repeated `+91`, a leading `0` or spaces; the code screen shows the number used and has
  a "Change number" button.
- The server configures Firestore once per process, so API routes no longer crash with "Firestore has
  already been initialized" when several routes run in the same process.
- Buy-for-you payments validate the Seeker's delivery details before any transaction, and a paid deal
  without an address lets the Seeker send it from the deal room (`deliveryDetailsSent` in the deal view,
  `useSendDeliveryDetails` in the SDK).
- The JSON-RPC relay answers methods outside its allowlist with a standard JSON-RPC `-32601` error
  instead of HTTP 403, so the wallet stops retrying them on every transaction.
- The keeper retries welcome top-ups that failed before broadcast (for example when the funder wallet
  was empty at sign-up).

### Removed

- Dependabot version updates; dependencies are updated deliberately in reviewed commits.

## [0.1.0] - 2026-10-27

First complete MVP, deployed on MST Testnet.

### Added

- **Smart contracts:** `RelayEscrow` (listings, escrow, deposits, deadlines, disputes, push payouts with
  a pull fallback, per-deal policy snapshots, EIP-712 listing authorisations) and `ReputationSBT`
  (soulbound ERC-5192 Trust Badge with tiers, unique-counterparty gating and faults). 100 tests,
  100% coverage, Slither clean at medium and above.
- **Deployment tooling:** idempotent deploy, configure, verify and smoke scripts with spend caps and
  on-chain deployment records; contracts deployed and configured on MST Testnet.
- **API and services:** route wrapper (auth, validation, rate limits, idempotency, structured logs),
  phone-verified onboarding with SIWE-style wallet linking, badge minting and gas top-ups, listings,
  encrypted delivery details and order proofs, the Code Vault for Pass-on codes, disputes with an
  admin desk and rulebook suggestions, and a keeper for releases, default rulings and data retention.
- **Client SDK:** typed API client, transaction helpers, React hooks and a PIN-encrypted embedded wallet.
- **Web app:** login, explore, listing creation, deal room driven by `nextAction`, wallet, Trust Badge,
  admin and terms pages; installable PWA.
- **Security:** threat model and review results (`SECURITY.md`), CSP and security headers, a hardened
  JSON-RPC relay, Firestore rules that deny client writes, dependency audit with no known issues.
- **Repository:** npm workspaces (`apps/web`, `packages/contracts`, `packages/shared`), documentation,
  CI with unit and integration jobs, issue and pull-request templates, MIT license.
