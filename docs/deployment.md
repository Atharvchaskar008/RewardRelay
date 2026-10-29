# Deployment

How to run SAKAR locally, deploy the contracts to MST, and deploy the web app.

## Networks

| Network       | Chain id | RPC                                    | Explorer                    |
| ------------- | -------- | -------------------------------------- | --------------------------- |
| MST Testnet   | 91562037 | `https://testnetrpc.mstblockchain.com` | https://testnet.mstscan.com |
| MST Mainnet   | 4646     | `https://mariorpc.mstblockchain.com`   | https://mstscan.com         |
| Local Hardhat | 31337    | `http://127.0.0.1:8545`                | —                           |

MST runs Shanghai EVM rules with no base fee: every transaction is a legacy transaction at a fixed
1 gwei gas price (the scripts and the SDK do this for you).

## Current testnet deployment

| Contract      | Address                                                                                                                        |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| ReputationSBT | [`0x9C0a662D4eA71F9C18b0DEF392cBb1c020cAB5c6`](https://testnet.mstscan.com/address/0x9C0a662D4eA71F9C18b0DEF392cBb1c020cAB5c6) |
| RelayEscrow   | [`0x5aB34fB9CFce4a442b2CA773692a7D031D173C9A`](https://testnet.mstscan.com/address/0x5aB34fB9CFce4a442b2CA773692a7D031D173C9A) |

The full record (transactions, configuration read back from the chain, smoke deal) is in
`packages/contracts/deployments/mstTestnet.json`; addresses and ABIs are exported to
`packages/shared`.

## Local development

```bash
npm install
npm run compile
npm run dev          # Hardhat node on :8545 + Next.js on :3000
```

For a fully local stack, deploy the contracts to the local node and point the app at it:

```bash
npm run deploy:local -w @rewardrelay/contracts
npm run configure:local -w @rewardrelay/contracts
# apps/web/.env: MST_RPC_URL=http://127.0.0.1:8545, MST_CHAIN_ID=31337,
#                ESCROW_ADDRESS/SBT_ADDRESS from packages/contracts/deployments/localhost.local.json,
#                FIRESTORE_EMULATOR_HOST / FIREBASE_AUTH_EMULATOR_HOST for the Firebase emulators
```

## Contracts (MST Testnet)

Configuration lives in `packages/contracts/.env` (see `.env.example`): the deployer key, the treasury,
the server signer address, tier limits, deposits and fee. Every script is idempotent and records each
transaction in `deployments/<network>.json`; a spend cap is checked against a gas estimate before
every broadcast.

```bash
npm run deployer:generate -w @rewardrelay/contracts   # fresh deployer key (prints the address only)
npm run preflight:testnet -w @rewardrelay/contracts   # sends nothing: balance, gas, addresses, planned config
npm run deploy:testnet -w @rewardrelay/contracts      # ReputationSBT, then RelayEscrow
npm run configure:testnet -w @rewardrelay/contracts   # roles, category policies, limits, deposits, fee
npm run verify:testnet -w @rewardrelay/contracts      # source verification on mstscan (Blockscout)
npm run smoke:testnet -w @rewardrelay/contracts       # mints 2 badges and runs one tiny Buy-for-you deal
```

`POLICY_PROFILE` (`demo`, the default, or `production`) picks the category windows `configure` applies.
MST Mainnet uses the same scripts with `:mainnet`; see [mainnet.md](mainnet.md).

## Firebase

1. **Firestore**: Firebase console → Build → Firestore Database → Create database → production mode
   → location `asia-south1`. Deploy the rules and indexes from `apps/web`:
   `npx firebase-tools deploy --only firestore:rules,firestore:indexes --project <project-id>`.
   Expired `idempotency`, `rateLimits` and `challenges` documents are deleted by the keeper
   (`/api/cron/release`), so no TTL policy is needed: TTL policies require billing (Blaze).
2. **Phone sign-in**: Authentication → Sign-in method → Phone → enable; add test phone numbers for
   demos (never commit them); add the production domain under Authorized domains. Then Authentication
   → Settings → **SMS region policy** → Allow → **India**: with an empty allowlist every request,
   including test numbers, fails with `OPERATION_NOT_ALLOWED`.
3. **Web app**: Project settings → Your apps → Add app (Web) → copy the config into
   `NEXT_PUBLIC_FIREBASE_API_KEY`, `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`, `NEXT_PUBLIC_FIREBASE_PROJECT_ID`,
   `NEXT_PUBLIC_FIREBASE_APP_ID`.
4. **Service account**: Project settings → Service accounts → Generate new private key → set
   `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` (keep `\n` escapes). Keep the
   JSON file out of the repository.
5. After the first phone login, add your Firebase uid to `ADMIN_UIDS` to use `/admin`.

## Web app (Vercel)

- Import the repository, set the **Root Directory** to `apps/web` (framework: Next.js, Node 22+).
  Set Settings → Functions → **Function Region** to Mumbai (`bom1`), next to Firestore in
  `asia-south1` (`apps/web/vercel.json` says the same, but a CLI deploy from the repository root
  does not read it). The site is live at https://rewardrelay.vercel.app.
- Copy every variable from `apps/web/.env.example` into the project settings (server secrets are
  never prefixed with `NEXT_PUBLIC_`). Set `APP_URL` to the production origin: wallet-link messages
  name it.
- Fund the server signers (`VERIFIER_PRIVATE_KEY` for badge mints and rulings, `FUNDER_PRIVATE_KEY`
  for welcome top-ups and releases); `GET /api/health` warns when one runs low.
- Seed the demo marketplace (one offer per category):
  `SEED_PHONE=<test number> SEED_CODE=<its code> SEED_PIN=<pin> SEED_API_URL=https://<domain> npm run seed:demo -w @rewardrelay/web`.
  The first run creates and links the demo Sharer's wallet and prints its address; fund it with
  about 0.01 tMSTC and run again.
- Schedule the keeper: cron-job.org, `GET https://<domain>/api/cron/release` every 2 minutes with the
  header `X-Cron-Secret: <CRON_SECRET>` (details in [api.md](api.md#6-automation-cron-joborg)).

## Operations

- `GET /api/health`: RPC and latest block, Firestore, signer balances, contract addresses.
- Key rotation, pausing and incident response: see [SECURITY.md](../.github/SECURITY.md#6-operations).
