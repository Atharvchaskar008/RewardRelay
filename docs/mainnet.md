# MST Mainnet runbook

How the RewardRelay contracts go to MST Mainnet (chain id `4646`, RPC
`https://mariorpc.mstblockchain.com`, explorer [mstscan.com](https://mstscan.com)). The contracts are
the same bytecode as on MST Testnet (solc 0.8.24, evmVersion `shanghai`, optimizer 200 runs), whose
sources are verified on testnet.mstscan.com.

**Scope for the buildathon:** deploy, configure, verify and smoke-test the contracts on mainnet (one
real deal end to end). The live app stays on MST Testnet with test MSTC: chain-specific records (the
deal index, Trust Badges, top-ups) live in Firestore, so an app on mainnet needs its own Firebase
project (see the last section). About 1 hour in total.

## 1. Before you start

| Need                                                  | Amount          | Notes                                                                                                                                                                                                                                         |
| ----------------------------------------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deployer `0xc9Dd38AB8ae9d897A0B7f34D2b58F04efD101a4E` | **≥ 0.01 MSTC** | Deploy + configure ≈ 0.0078 MSTC at 1 gwei; the smoke deal ≈ 0.001 MSTC more. Ask MST for 0.05.                                                                                                                                               |
| Deployer unused on mainnet (nonce 0)                  | —               | The contracts then get **the testnet addresses**: ReputationSBT `0x9C0a662D4eA71F9C18b0DEF392cBb1c020cAB5c6`, RelayEscrow `0x5aB34fB9CFce4a442b2CA773692a7D031D173C9A`. The deploy refuses a used deployer unless `ALLOW_NEW_ADDRESSES=true`. |
| `packages/contracts/.env`                             | —               | The same file as for testnet. Review the values below for real MSTC.                                                                                                                                                                          |

**Values to review for real MSTC** (`packages/contracts/.env`):

- `TIER_LIMITS_WEI`: the deal limits of the New / Trusted / Verified badges. Testnet uses ₹500 /
  ₹2,000 / ₹10,000 at the demo rate of ₹1,00,000 per MSTC (0.005 / 0.02 / 0.1 MSTC). On mainnet,
  divide the ₹ limits by the real ₹ price of MSTC.
- `POLICY_PROFILE`: `demo` (default) keeps windows of minutes, so a deal can be shown end to end on
  Demo Day; `production` applies the real return and event windows (for example 10 days for
  e-commerce). Policies apply to new listings only and can be changed later with `configure:mainnet`.
- Deposits (`SHARER_DEPOSIT_BPS`, `SEEKER_DEPOSIT_BPS`), `FEE_BPS` (200 = 2%, capped at 5% by the
  contract) and `ARBITER_TIMEOUT_SECONDS` can stay as on testnet.

## 2. Preflight (sends nothing)

```bash
npm run preflight:mainnet -w @rewardrelay/contracts
```

Check three lines: **Enough balance: yes**, **Same as testnet: yes**, and the planned configuration
(profile, tier limits, deposits, fee, treasury `0x820A3a10239C7c480491b96e7b5232d158BB19C1`, server
signer `0xA3136694111FAa2C04a53Cbf15d1Ed30F1c4DE50`).

## 3. Deploy, configure, verify, smoke

```bash
npm run deploy:mainnet -w @rewardrelay/contracts      # asks you to type: yes, deploy to mainnet
npm run configure:mainnet -w @rewardrelay/contracts   # roles, policies, limits, deposits, fee; reads every value back
npm run verify:mainnet -w @rewardrelay/contracts      # source verification on mstscan.com
npm run smoke:mainnet -w @rewardrelay/contracts       # mints 2 badges and runs one tiny Buy-for-you deal
```

- Every script is idempotent and resumable: rerun it after a network error and it continues where it
  stopped. `deployments/mstMainnet.json` records addresses, transactions and the configuration, and
  the deploy exports them to `packages/shared`.
- The smoke deal uses `SMOKE_SHARER_KEY` / `SMOKE_SEEKER_KEY` (funded from the deployer with
  `SMOKE_PARTY_FUND_WEI`) and prints mstscan links for every step. Expected result: the deal is
  Completed, the treasury received the 2% fee and `solvencyDelta() == 0`.
- Commit the new `deployments/mstMainnet.json` and the regenerated `packages/shared` files, then add
  the mainnet addresses and mstscan links to the README.

Rehearsed on a local Hardhat node (28 Oct): deploy, configure with `POLICY_PROFILE=production` (all six
policies read back), smoke deal Completed, fee paid, solvency delta 0.

## 4. Rollback and safety

- Nothing in the live app changes until its env does: the website keeps using MST Testnet.
- A mistake in the configuration is fixed by editing `.env` and rerunning `configure:mainnet` (it only
  sends what differs). Admin changes never touch escrowed funds or deals already in flight.
- `PAUSER_ROLE` can pause new listings and acceptances; settlements still work while paused.
- Before real users: move `DEFAULT_ADMIN_ROLE` to a multisig (SECURITY.md §5).

## 5. Later: the app on mainnet

The app switches networks by env alone (`MST_RPC_URL`, `MST_CHAIN_ID=4646`,
`MST_EXPLORER_URL=https://mstscan.com`, `ESCROW_ADDRESS`, `SBT_ADDRESS`, `NEXT_PUBLIC_CHAIN_ID=4646`,
`NEXT_PUBLIC_MSTSCAN_URL=https://mstscan.com`, `NEXT_PUBLIC_ESCROW_ADDRESS`, the ₹ rate and
`TOPUP_WEI`); the browser picks the mainnet relay (`/api/rpc/mainnet`), explorer and copy from the
chain id. Run it as a **separate deployment with its own Firebase project**: Firestore holds the deal
index, Trust Badge mints and top-ups of one chain, and deal ids restart at 1 on every chain. Fund its
verifier and funder wallets with real MSTC, and set `SIGNER_LOW_BALANCE_WEI` so `/api/health` warns
early.
