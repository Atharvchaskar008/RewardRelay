# Changelog

All notable changes to RewardRelay are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

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

### Added

- Testing guide (`docs/testing.md`), demo walkthrough (`docs/demo.md`), this changelog and a Code of
  Conduct.

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
