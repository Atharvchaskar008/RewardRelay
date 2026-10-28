# Contributing to SAKAR

Thanks for helping build SAKAR. This guide covers the local setup, the repository layout and
the conventions every change follows.

## Prerequisites

- **Node.js 22 or newer** (`.nvmrc`; Node 24 works too) and npm 10+
- **Java 21** for the Firebase emulators used by the integration tests
- Git, and a wallet/explorer for MST Testnet if you deploy contracts

## Setup

```bash
git clone https://github.com/Atharvchaskar008/SAKAR.git
cd SAKAR
npm install
npm run compile                    # Solidity → ABIs + TypeChain types (needed by tests and builds)

cp packages/contracts/.env.example packages/contracts/.env   # only needed to deploy contracts
cp apps/web/.env.example apps/web/.env                       # server + browser configuration
npm run dev                         # local Hardhat node + Next.js dev server
```

Every variable is documented in the two `.env.example` files; the server validates its environment
at startup and names any missing or malformed variable. See [docs/deployment.md](docs/deployment.md)
for Firebase, testnet and Vercel setup.

## Repository layout

| Path                 | What lives there                                                                                                                                         |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web`           | Next.js app: UI (`src/app`, `src/components`), API routes (`src/app/api`), server modules (`src/server`), client SDK (`src/client/sdk`), tests (`test/`) |
| `packages/contracts` | Hardhat project: `RelayEscrow`, `ReputationSBT`, deploy/configure/verify/smoke scripts, deployment records                                               |
| `packages/shared`    | Code shared by contracts scripts and the app: ABIs, deployed addresses, chain config, protocol enums, money and listing rules                            |
| `docs/`              | Architecture, API, protocol specification and deployment guides                                                                                          |
| `.github/`           | CI workflow, issue and pull-request templates                                                                                                            |

## Scripts (run from the repository root)

| Command                                        | Does                                                                                                 |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `npm run dev`                                  | Hardhat node + Next.js dev server                                                                    |
| `npm run lint`                                 | Solhint, ESLint (all packages) and the Prettier check                                                |
| `npm run format`                               | Prettier, write mode                                                                                 |
| `npm test`                                     | Contract tests (Hardhat) + web unit tests (Vitest)                                                   |
| `npm run test:integration -w @rewardrelay/web` | API, SDK and end-to-end tests against the Firebase Auth/Firestore emulators and a local Hardhat node |
| `npm run contracts:coverage`                   | Solidity coverage                                                                                    |
| `npm run build`                                | Type-check and build every package                                                                   |

## Workflow

1. Branch from `main`: `feat/<topic>`, `fix/<topic>`, `docs/<topic>`, `chore/<topic>`.
2. Write short, plain commit messages: two to four words that say what changed ("Testnet
   deployment", "Faster deal pages"), without prefixes such as `feat:` or `fix:`. Keep each commit
   to one change.
3. Add a line under **Unreleased** in [CHANGELOG.md](CHANGELOG.md) for any user-visible change.
4. Open a pull request; CI must be green (lint, tests, build, integration tests).
5. Merge with a merge commit once CI passes; never force-push `main`.

## Expectations for changes

- **API routes** go through `withRoute` (auth, validation, rate limit, idempotency, error catalogue) and
  re-read on-chain state before any privileged action; add an integration test for new routes.
- **Contracts**: keep `docs/protocol.md` in sync, keep 100% coverage and the invariant test green, and
  never use Cancun opcodes (MST runs Shanghai rules).
- **UI** uses the SDK hooks only (`@/client/sdk`); no direct viem/ABI usage in components.
- **Secrets**: never commit `.env` files, keys or personal data; private notes belong in the
  git-ignored `.private/` folder. See [SECURITY.md](SECURITY.md).

## Reporting security issues

Please do not open public issues for vulnerabilities; follow [SECURITY.md](SECURITY.md).

## Code of Conduct

Everyone taking part in this project is expected to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
