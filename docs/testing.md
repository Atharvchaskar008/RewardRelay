# Testing

SAKAR is tested in four layers, from fast and isolated to slow and real. Every layer runs
without the real `.env` values: tests generate throwaway keys and use fake phone numbers.

| Layer                      | Where                                                 | Runs on                                   | Count                |
| -------------------------- | ----------------------------------------------------- | ----------------------------------------- | -------------------- |
| Smart contracts            | `packages/contracts/test`                             | Hardhat network (Shanghai, 1 gwei)        | 100 tests            |
| Web unit                   | `apps/web/test/unit`                                  | Node, no network                          | 204 tests            |
| Integration and end-to-end | `apps/web/test/integration`, `apps/web/test/emulator` | Firebase emulators + a local Hardhat node | 61 tests             |
| Live network               | [demo guide](demo.md)                                 | MST Testnet, browser and scripted runs    | 3 deal types checked |

## Smart contracts

```bash
npm run contracts:test        # all contract tests
npm run contracts:coverage    # solidity-coverage report
npm run contracts:gas         # gas report for the main functions
npm run slither -w @rewardrelay/contracts   # static analysis (pip install slither-analyzer)
```

| File                              | Tests | Covers                                                                                                                             |
| --------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `ReputationSBT.test.ts`           | 34    | minting, soulbound behaviour, ERC-165/5192, tiers with unique counterparties, faults, admin                                        |
| `RelayEscrow.smoke.test.ts`       | 1     | one complete Buy-for-you deal                                                                                                      |
| `RelayEscrow.lifecycle.test.ts`   | 36    | every state transition and money flow, both deal types, deadlines, disputes                                                        |
| `RelayEscrow.adversarial.test.ts` | 28    | forged, replayed or cross-chain authorisations, reentrancy, refused payouts, pausing, parameter bounds and roles, input validation |
| `RelayEscrow.invariant.test.ts`   | 1     | 300 random steps over 60 deals: solvency and conservation hold after every step                                                    |

Coverage is 100% of statements, branches, functions and lines on both contracts. Slither reports no
high or medium findings; the triage of low and informational findings is in
[protocol.md](protocol.md) §12, and the gas table in §11.

## Web unit tests

```bash
npm test -w @rewardrelay/web
```

Pure logic with no network or emulator: environment parsing, envelope encryption and HMACs, the HTTP
route wrapper, backend deadlines and outage handling, the `nextAction` mapping, the dispute rulebook, the signer's
nonce and retry handling, the embedded wallet (PIN encryption, signing, locking), sign-in error
messages, phone-number normalisation, delivery-details rules, and Firestore initialisation across
separately bundled route modules.

## Integration and end-to-end tests

```bash
npm run test:integration      # needs Java 21 on PATH and `npm run compile` beforehand
```

`firebase emulators:exec` starts the Auth and Firestore emulators (project `demo-rewardrelay`), and
the global setup starts a local Hardhat node and deploys and configures fresh contracts. The tests call
the real route handlers in-process and sign transactions with real wallets on that node.

| File                               | What it proves                                                                                                |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `emulator/firestore.rules.test.ts` | clients can only read public listings; every other read and write is denied                                   |
| `emulator/stores.test.ts`          | the Firestore-backed rate limiter and idempotency store under concurrency                                     |
| `integration/onboarding.test.ts`   | phone sign-in, wallet-link challenges, one phone per wallet, badge mint, top-up once, retries, backups        |
| `integration/listings.test.ts`     | listing creation for both deal types, terms hashes, duplicate codes, the feed and deal views                  |
| `integration/private.test.ts`      | delivery details, order proofs, invoice uploads and code reveal gated by on-chain state; 7-day purge          |
| `integration/disputes.test.ts`     | evidence, the admin desk, rulings and their audit trail                                                       |
| `integration/cron.test.ts`         | the keeper secret and lease, automatic release (also on visit), default rulings, the health endpoint          |
| `integration/hardening.test.ts`    | the JSON-RPC relay allowlist and limits, admin conflicts of interest                                          |
| `integration/sdk.e2e.test.ts`      | both deal types end to end through the client SDK only, errors, no payment without an address, wallet restore |

## Continuous integration

`.github/workflows/ci.yml` runs on every pull request and on pushes to `main`:

1. **Lint, test, build:** install, compile the contracts, `npm run lint`, `npm test`, `npm run build`.
2. **Integration tests:** Java 21, compile, `npm run test:integration -w @rewardrelay/web`.

A pull request is merged only when both jobs pass.

## Live checks on MST Testnet

Changes that touch money flows or the deal room are also checked on MST Testnet with tiny values,
following the [demo guide](demo.md). The deals verified this way are listed in the
[README](../README.md#deployments).
