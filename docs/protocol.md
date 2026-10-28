# SAKAR protocol specification

Status: **frozen for implementation** (H1). Interfaces (in `packages/contracts`):
`contracts/interfaces/IRelayEscrow.sol`, `contracts/interfaces/IReputationSBT.sol`,
`contracts/interfaces/IERC5192.sol`. The contracts' NatSpec still calls this document `SPEC.md` (its
former name): the comments are part of the deployed, verifiable source and are left unchanged.

Target chain: MST (EVM, Shanghai rules, no Cancun opcodes), Solidity 0.8.24, OpenZeppelin 5.0.2.
All amounts are wei of MSTC. "now" is `block.timestamp`.

---

## 1. Actors and contracts

| Actor    | Who                                     | On-chain identity                     |
| -------- | --------------------------------------- | ------------------------------------- |
| Sharer   | Holds a benefit, lists a deal, delivers | Badge holder (EOA or embedded wallet) |
| Seeker   | Pays for the deal                       | Badge holder                          |
| Verifier | SAKAR server after phone OTP            | `VERIFIER_ROLE` on both contracts     |
| Arbiter  | SAKAR admin through the server          | `ARBITER_ROLE` on the escrow          |
| Keeper   | Anyone (cron, either party, a stranger) | none                                  |
| Treasury | Team BridgeKey wallet                   | fee receiver address                  |

- **ReputationSBT** (Trust Badge): soulbound ERC-721 + ERC-5192, one per address, stats and tiers.
- **RelayEscrow**: deals, deposits, deadlines, disputes, payouts. Holds `ESCROW_ROLE` on the SBT.

---

## 2. Deal state machine

```
                 cancelListing                    claimTimeout (now > deliverBy)
        ┌──────────────────────── Listed ──────────────┐       ┌──────────────▶ Refunded
        ▼                           │ acceptListing    │       │
    Cancelled          BuyForYou ───┴──▶ Locked ────────┴───────┘
                                          │ markDelivered (now <= deliverBy)
                       PassOn ───────────▶▼
                                       Delivered ──confirmReceipt / release (now >= releaseAt)──▶ Completed
                                          │ raiseDispute (now < releaseAt)                         ▲
                                          ▼                                                        │
                                       Disputed ──confirmReceipt (seeker concedes)─────────────────┘
                                          │ resolveDispute (arbiter) / defaultResolve (now >= opened + timeout)
                                          ▼
                                       Resolved
```

### 2.1 Transition table

| #   | From → To             | Function                    | Caller                      | Guards (all must hold)                                                                                                                                                                                                                                                                                                                                                                                         | Effects                                                                                                                                                                                  | Events                                            |
| --- | --------------------- | --------------------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| T1  | ∅ → Listed            | `createListing`             | badge holder                | not paused · policy active · `0 < price <= type(uint128).max` · `price <= sbt.maxDealValue(caller)` · `termsHash != 0` · `eventTime == 0` or `now < eventTime <= now + 365 d` · `msg.value == price * sharerDepositBps[tier] / 10000` · **BuyForYou:** `fingerprint == 0` · **PassOn:** `fingerprint != 0`, unused, `now <= auth.deadline`, `auth.nonce == nonces(caller)`, EIP-712 signer has `VERIFIER_ROLE` | new id; snapshot `policy`, `feeBps`, `arbiterTimeout`; `seekerDeposit = price * seekerDepositBps / 10000`; `totalEscrowed += msg.value`; PassOn: nonce consumed, fingerprint marked used | `ListingCreated`                                  |
| T2  | Listed → Cancelled    | `cancelListing`             | sharer                      | — (works while paused)                                                                                                                                                                                                                                                                                                                                                                                         | PassOn: fingerprint freed; pay sharer `sharerDeposit`                                                                                                                                    | `ListingCancelled`                                |
| T3  | Listed → Locked       | `acceptListing` (BuyForYou) | badge holder ≠ sharer       | not paused · `price <= sbt.maxDealValue(caller)` · `eventTime == 0 or now < eventTime` · `msg.value == price + seekerDeposit`                                                                                                                                                                                                                                                                                  | `seeker = caller`; `deliverBy = now + deliveryWindow`; `totalEscrowed += msg.value`                                                                                                      | `DealLocked`                                      |
| T4  | Listed → Delivered    | `acceptListing` (PassOn)    | badge holder ≠ sharer       | as T3                                                                                                                                                                                                                                                                                                                                                                                                          | `seeker = caller`; `releaseAt = max(now + releaseDelay, eventTime + eventBuffer)`; `totalEscrowed += msg.value`                                                                          | `DealLocked` (deliverBy 0), `Delivered` (proof 0) |
| T5  | Locked → Delivered    | `markDelivered`             | sharer                      | `now <= deliverBy` · `proofHash != 0`                                                                                                                                                                                                                                                                                                                                                                          | `proofHash`; `releaseAt = max(now + releaseDelay, eventTime + eventBuffer)`                                                                                                              | `Delivered`                                       |
| T6  | Locked → Refunded     | `claimTimeout`              | anyone                      | `now > deliverBy`                                                                                                                                                                                                                                                                                                                                                                                              | pay seeker everything held (§3); `sbt.recordFault(sharer)`                                                                                                                               | `Refunded`                                        |
| T7  | Delivered → Completed | `confirmReceipt`            | seeker                      | —                                                                                                                                                                                                                                                                                                                                                                                                              | `_complete` (§3)                                                                                                                                                                         | `Completed(confirmedBySeeker = true)`             |
| T8  | Delivered → Completed | `release`                   | anyone                      | `now >= releaseAt`                                                                                                                                                                                                                                                                                                                                                                                             | `_complete` (§3)                                                                                                                                                                         | `Completed(false)`                                |
| T9  | Delivered → Disputed  | `raiseDispute`              | seeker                      | `now < releaseAt` · `evidenceHash != 0`                                                                                                                                                                                                                                                                                                                                                                        | `disputeOpenedAt = now`                                                                                                                                                                  | `DisputeRaised`                                   |
| T10 | Disputed → Disputed   | `addEvidence`               | sharer or seeker            | `now <= disputeOpenedAt + disputeWindow` · `evidenceHash != 0`                                                                                                                                                                                                                                                                                                                                                 | none (log only)                                                                                                                                                                          | `EvidenceAdded`                                   |
| T11 | Disputed → Completed  | `confirmReceipt`            | seeker                      | — (concession)                                                                                                                                                                                                                                                                                                                                                                                                 | `_complete` (§3)                                                                                                                                                                         | `Completed(true)`                                 |
| T12 | Disputed → Resolved   | `resolveDispute`            | `ARBITER_ROLE`, not a party | `seekerShareBps <= 10000`                                                                                                                                                                                                                                                                                                                                                                                      | split (§3); `recordFault(faultParty)` unless None                                                                                                                                        | `DisputeResolved(arbiter)`                        |
| T13 | Disputed → Resolved   | `defaultResolve`            | anyone                      | `now >= disputeOpenedAt + arbiterTimeout`                                                                                                                                                                                                                                                                                                                                                                      | 50/50 split, deposits returned, no fee, no fault                                                                                                                                         | `DisputeResolved(address(0))`                     |

Every function first loads the deal and reverts with `DealNotFound` when `sharer == 0`, then
`InvalidStatus(id, status)` when the status is not the listed "From". Terminal states (Completed,
Refunded, Resolved, Cancelled) have no outgoing transition. `withdraw()` is not a deal transition.

### 2.2 Time rules

- `deliverBy` (inclusive for the sharer) and `claimTimeout` (`now > deliverBy`) never overlap.
- `raiseDispute` (`now < releaseAt`) and `release` (`now >= releaseAt`) never overlap.
- `releaseAt = max(deliveredAt + releaseDelay, eventTime + eventBuffer)`: a travel or show deal can never
  release before the event (plus buffer) has passed. With `eventTime == 0` this is `deliveredAt + releaseDelay`.
- Every window is at least 1 minute (§6), so the ±15 s timestamp freedom of a block producer cannot flip
  an outcome in practice; the UI warns when less than a minute remains.

---

## 3. Money flows

Notation: `P` price, `Ds` sharer deposit, `Dk` seeker deposit, `f` the deal's snapshotted `feeBps`.
Held while open: Listed `Ds`; Locked/Delivered/Disputed `P + Ds + Dk`.

| Terminal state                   | Sharer receives      | Seeker receives | Treasury receives  | Reputation                         |
| -------------------------------- | -------------------- | --------------- | ------------------ | ---------------------------------- |
| **Completed** (T7, T8, T11)      | `P − fee + Ds`       | `Dk`            | `fee = P·f/10000`  | `recordSuccess(sharer, seeker, P)` |
| **Refunded** (T6)                | 0                    | `P + Dk + Ds`   | 0                  | `recordFault(sharer)`              |
| **Resolved**, fault None (T12)   | `Pr − fee + Ds`      | `Pk + Dk`       | `fee = Pr·f/10000` | —                                  |
| **Resolved**, fault Sharer (T12) | `Pr − fee`           | `Pk + Dk + Ds`  | `fee = Pr·f/10000` | `recordFault(sharer)`              |
| **Resolved**, fault Seeker (T12) | `Pr − fee + Ds + Dk` | `Pk`            | `fee = Pr·f/10000` | `recordFault(seeker)`              |
| **Resolved**, default (T13)      | `P − ⌊P/2⌋ + Ds`     | `⌊P/2⌋ + Dk`    | 0                  | —                                  |
| **Cancelled** (T2)               | `Ds`                 | —               | —                  | —                                  |

with `Pk = P · seekerShareBps / 10000` (seeker's share of the price, rounded down) and `Pr = P − Pk`.
The fee is charged only on the sharer's share of the price; deposits are never charged.

**Conservation:** in every row the payouts sum exactly to the amount held. Each payout goes through
`_payout(id, to, amount)`:

1. `totalEscrowed -= amount` (before the call),
2. `to.call{value: amount, gas: 30_000}("")` without copying return data,
3. on failure `withdrawable[to] += amount; totalWithdrawable += amount` and `PayoutDeferred`.

`withdraw()` zeroes `withdrawable[caller]`, decrements `totalWithdrawable`, then sends with all
remaining gas and reverts with `TransferFailed` if the send fails (state rolls back).

---

## 4. Invariants

| ID                   | Invariant                                                                                                                                                                                                                                                                                                            |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I1 **Solvency**      | `address(this).balance == totalEscrowed + totalWithdrawable` before and after every external call made by the escrow. `solvencyDelta()` returns `balance − (totalEscrowed + totalWithdrawable)`; only ether forced in from outside (SELFDESTRUCT, block rewards) can make it positive, nothing can make it negative. |
| I2 Escrow accounting | `totalEscrowed == Σ held(d)` over open deals (Listed: `Ds`; Locked/Delivered/Disputed: `P + Ds + Dk`).                                                                                                                                                                                                               |
| I3 Pull accounting   | `totalWithdrawable == Σ withdrawable[a]`.                                                                                                                                                                                                                                                                            |
| I4 State machine     | A deal only moves along T1–T13; terminal states never change.                                                                                                                                                                                                                                                        |
| I5 Conservation      | A settlement pays out exactly what the deal held (table §3).                                                                                                                                                                                                                                                         |
| I6 Snapshot          | After T1, `policy`, `feeBps`, `arbiterTimeout`, `price`, `Ds`, `Dk`, `termsHash`, `eventTime` and `codeFingerprint` never change.                                                                                                                                                                                    |
| I7 Fingerprints      | A fingerprint is attached to at most one non-cancelled deal; a signature can be used once (nonce).                                                                                                                                                                                                                   |
| I8 Limits            | `price <= maxDealValue` of each party at the moment it joins; unbadged addresses can do neither.                                                                                                                                                                                                                     |
| I9 Badges            | At most one badge per address; badges never move (`locked == true` for every token).                                                                                                                                                                                                                                 |
| I10 Reputation       | `completed` increases only through a Completed deal; `disputesLost` only through a timeout or an arbiter fault ruling.                                                                                                                                                                                               |

---

## 5. Roles

### 5.1 RelayEscrow

| Function                                                       | DEFAULT_ADMIN | POLICY_ADMIN | ARBITER | VERIFIER | PAUSER | Anyone        |
| -------------------------------------------------------------- | ------------- | ------------ | ------- | -------- | ------ | ------------- |
| grant/revoke roles                                             | ✅            |              |         |          |        |               |
| `setTreasury`                                                  | ✅            |              |         |          |        |               |
| `setPolicy`, `setFeeBps`, `setDepositBps`, `setArbiterTimeout` |               | ✅           |         |          |        |               |
| `resolveDispute`                                               |               |              | ✅      |          |        |               |
| sign `ListingAuth` (off-chain)                                 |               |              |         | ✅       |        |               |
| `pause`, `unpause`                                             |               |              |         |          | ✅     |               |
| `release`, `claimTimeout`, `defaultResolve`, `withdraw`        |               |              |         |          |        | ✅            |
| `createListing`, `acceptListing`                               |               |              |         |          |        | badge holders |
| `cancelListing`, `markDelivered`                               |               |              |         |          |        | deal sharer   |
| `confirmReceipt`, `raiseDispute`                               |               |              |         |          |        | deal seeker   |
| `addEvidence`                                                  |               |              |         |          |        | deal parties  |

Constructor `(sbt, treasury, verifier, admin)`: `admin` receives DEFAULT_ADMIN, POLICY_ADMIN and PAUSER;
`verifier` receives VERIFIER. ARBITER is granted by the configuration script.

### 5.2 ReputationSBT

| Function                                             | DEFAULT_ADMIN | VERIFIER | ESCROW | POLICY_ADMIN |
| ---------------------------------------------------- | ------------- | -------- | ------ | ------------ |
| grant/revoke roles                                   | ✅            |          |        |              |
| `mint`                                               |               | ✅       |        |              |
| `recordSuccess`, `recordFault`                       |               |          | ✅     |              |
| `setTierLimits`, `setTierRules`, `setRelayPointUnit` |               |          |        | ✅           |

Constructor `(admin, relayPointUnit)`: `admin` receives DEFAULT_ADMIN and POLICY_ADMIN.

---

## 6. Parameters and bounds

| Parameter                | Where   | Bound                                           | Default                                           |
| ------------------------ | ------- | ----------------------------------------------- | ------------------------------------------------- |
| `feeBps`                 | escrow  | `<= 500` (5%)                                   | 200                                               |
| `sharerDepositBps[tier]` | escrow  | `<= 10000` each                                 | 5000 / 3000 / 2000                                |
| `seekerDepositBps`       | escrow  | `<= 10000`                                      | 500                                               |
| `arbiterTimeout`         | escrow  | 1 min … 30 days                                 | 72 h                                              |
| `deliveryWindow`         | policy  | BuyForYou 1 min … 30 days; PassOn must be 0     | per category                                      |
| `releaseDelay`           | policy  | 1 min … 90 days                                 | per category                                      |
| `eventBuffer`            | policy  | 0 … 30 days                                     | per category                                      |
| `disputeWindow`          | policy  | 1 min … 30 days                                 | per category                                      |
| `eventTime`              | listing | 0, or `now < eventTime <= now + 365 days`       | —                                                 |
| payout gas stipend       | escrow  | 30 000 gas (constant)                           | —                                                 |
| `tierLimit[3]`           | SBT     | non-decreasing                                  | 0 until configured                                |
| tier rules               | SBT     | tier 2 ≥ tier 1 on completed and counterparties | T1: 5 completed, 3 unique, 0 lost · T2: 20, 10, 0 |
| `relayPointUnit`         | SBT     | `> 0`                                           | constructor argument                              |

All wei values (tier limits, top-ups) are configuration, never constants. Demo configuration (H5) uses the
rate 1 tMSTC = ₹1,00,000: tier limits 0.005 / 0.02 / 0.1 tMSTC (₹500 / ₹2,000 / ₹10,000).

---

## 7. Pause semantics

`pause()` blocks **new commitments only**: `createListing` and `acceptListing`.
Everything else stays available while paused, so every open deal can always reach a terminal state:

| State     | Exit while paused                                                   |
| --------- | ------------------------------------------------------------------- |
| Listed    | `cancelListing`                                                     |
| Locked    | `markDelivered` (sharer) or `claimTimeout`                          |
| Delivered | `confirmReceipt`, `release`, `raiseDispute`                         |
| Disputed  | `addEvidence`, `confirmReceipt`, `resolveDispute`, `defaultResolve` |
| credits   | `withdraw`                                                          |

Rationale: if `markDelivered` were paused while `claimTimeout` is not, a pause during a Locked deal would
let the seeker slash an honest sharer's deposit; pausing `raiseDispute` but not `release` would do the same
to a seeker. Pausing intake stops new money while no deadline can be turned against a user.

---

## 8. `nextActionFor(id, account)`

| Status                                      | Sharer         | Seeker           | Arbiter (non-party) | Anyone else                                                                                                       |
| ------------------------------------------- | -------------- | ---------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Listed                                      | Cancel         | —                | —                   | Accept if not paused, the event has not started, the account holds a badge and `price <= maxDealValue`; else None |
| Locked, `now <= deliverBy`                  | MarkDelivered  | Wait             | None                | None                                                                                                              |
| Locked, `now > deliverBy`                   | None           | ClaimRefund      | ClaimRefund         | ClaimRefund                                                                                                       |
| Delivered, `now < releaseAt`                | Wait           | ConfirmOrDispute | None                | None                                                                                                              |
| Delivered, `now >= releaseAt`               | Release        | Release          | Release             | Release                                                                                                           |
| Disputed, evidence window open              | AddEvidence    | AddEvidence      | Resolve             | None                                                                                                              |
| Disputed, window closed, before timeout     | Wait           | Wait             | Resolve             | None                                                                                                              |
| Disputed, `now >= opened + arbiterTimeout`  | DefaultResolve | DefaultResolve   | Resolve             | DefaultResolve                                                                                                    |
| Completed / Refunded / Resolved / Cancelled | None           | None             | None                | None                                                                                                              |

Unknown ids revert with `DealNotFound`. The backend maps these to its UI actions (H8).

---

## 9. Refinements of the harness text

1. Pause blocks only `createListing`/`acceptListing` (§7) instead of every user function.
2. `Policy.disputeWindow` is the evidence window (T10); disputes may be raised until `releaseAt`.
3. `feeBps` and `arbiterTimeout` are snapshotted per deal like the policy and the seeker deposit.
4. `claimTimeout` is permissionless (the proceeds always go to the seeker).
5. The seeker may `confirmReceipt` while Disputed (T11).
6. `cancelListing` frees the Pass-on fingerprint and works while paused.
7. `defaultResolve` charges no fee.
8. The arbiter cannot rule on a deal in which it is a party.
9. One `releaseAt` formula for both deal types; accepting after `eventTime` reverts.
10. Nonces are sequential per sharer (OpenZeppelin `Nonces`).
11. Tier 2 also requires zero lost disputes by default (configurable).
12. `setTreasury` (DEFAULT_ADMIN) was added so a lost treasury key does not strand future fees.

---

## 10. Threat model

| Threat                                                          | Mitigation                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Reentrancy**                                                  | `nonReentrant` (classic `ReentrancyGuard`, no transient storage) on every value-moving function; checks-effects-interactions: status and accounting are final before any call; pushed payouts get a 30 000 gas stipend; `withdraw` zeroes the balance before sending.                                                                                            |
| **Payout denial of service** (reverting receiver, gas griefing) | A failed push is credited to `withdrawable` instead of reverting, so one party can never block the other's settlement. A keeper that sends too little gas can only defer a payout to `withdraw`, never lose it. No loops over users.                                                                                                                             |
| **Signature replay**                                            | EIP-712 domain binds chain id and escrow address; `ListingAuth` binds the sharer, fingerprint, sequential nonce and deadline; OpenZeppelin ECDSA rejects malleable (high-s) signatures.                                                                                                                                                                          |
| **Front-running a Pass-on authorisation**                       | The signature names the sharer and is checked against `msg.sender`; a copied signature is useless to anyone else.                                                                                                                                                                                                                                                |
| **Duplicate codes**                                             | `usedFingerprint` blocks a second listing of the same code fingerprint (HMAC computed server-side over the normalised code).                                                                                                                                                                                                                                     |
| **Front-running an accept**                                     | The first seeker wins; a second accept reverts with `InvalidStatus` and keeps its funds. A sharer cancelling first makes the accept revert without loss.                                                                                                                                                                                                         |
| **Bait-and-switch**                                             | `price`, `termsHash` and the policy are fixed at listing time; the backend checks `termsHash` against the displayed terms.                                                                                                                                                                                                                                       |
| **Griefing with deposits**                                      | Both sides lock a deposit. A sharer who never delivers loses `Ds` to the seeker and gets a fault; a seeker who disputes in bad faith risks `Dk` and a fault; an abandoned dispute ends 50/50 after `arbiterTimeout` without fault, so freezing funds has a bounded cost of time only. Deposits scale with the sharer's tier.                                     |
| **Arbiter abuse**                                               | The arbiter can act only on Disputed deals, only split the deal's own price within [0, P], only move a deposit to the counterparty, cannot rule on its own deals, and every ruling is an on-chain event mirrored by an off-chain audit record. If it does nothing, `defaultResolve` applies. The arbiter can never move funds of other deals or of the treasury. |
| **Admin abuse**                                                 | Policy, fee, deposit and timeout changes apply to new listings only (I6); fee ≤ 5%, deposits ≤ 100%, windows bounded. Admins cannot touch escrowed funds. Trust assumption: DEFAULT_ADMIN could revoke the escrow's `ESCROW_ROLE` on the SBT, which would make settlements revert; this key is held by the deployer and should move to a multisig.               |
| **Pause abuse**                                                 | Pause blocks only new commitments (§7), so funds can never be frozen by pausing.                                                                                                                                                                                                                                                                                 |
| **Timestamp manipulation**                                      | Windows ≥ 1 minute and strict, non-overlapping comparisons (§2.2).                                                                                                                                                                                                                                                                                               |
| **Forced ether**                                                | Can only create surplus (`solvencyDelta() > 0`); accounting never relies on `address(this).balance`.                                                                                                                                                                                                                                                             |
| **Sybil reputation farming**                                    | Badges are minted only after phone verification (one phone ↔ one wallet, off-chain); tiers need several **unique** counterparties, so self-dealing between two wallets cannot reach tier 1.                                                                                                                                                                      |
| **Cancun opcodes on MST mainnet**                               | `evmVersion: shanghai`, classic `ReentrancyGuard`, local network runs the Shanghai hardfork.                                                                                                                                                                                                                                                                     |
| **Integer overflow**                                            | Prices and deposits are `uint128`; multiplications happen in `uint256`; checked arithmetic everywhere.                                                                                                                                                                                                                                                           |
| **Direct transfers**                                            | `receive`/`fallback` revert, so stray MSTC cannot enter the accounting.                                                                                                                                                                                                                                                                                          |
| **Privacy**                                                     | Only hashes and fingerprints go on-chain; personal data and codes stay encrypted off-chain.                                                                                                                                                                                                                                                                      |

---

## 11. Gas

hardhat-gas-reporter 1.0.10 on the local network (Shanghai rules, solc 0.8.24, optimizer 200 runs),
measured over the badge, smoke and lifecycle suites (`npm run contracts:gas`). Cost column: gas × 1 gwei,
the fixed MST gas price.

| Contract       | Function         | Min     | Max     | Avg       | Cost at 1 gwei (avg) | Notes                                                                             |
| -------------- | ---------------- | ------- | ------- | --------- | -------------------- | --------------------------------------------------------------------------------- |
| RelayEscrow    | `createListing`  | 204,674 | 312,091 | 243,815   | 0.000244 MSTC        | min = Buy-for-you; max = Pass-on with EIP-712 check and fingerprint write         |
| RelayEscrow    | `acceptListing`  | 69,033  | 74,048  | 69,638    | 0.000070 MSTC        |                                                                                   |
| RelayEscrow    | `markDelivered`  | 61,559  | 61,569  | 61,560    | 0.000062 MSTC        |                                                                                   |
| RelayEscrow    | `confirmReceipt` | 104,432 | 194,663 | 187,114   | 0.000187 MSTC        | includes `recordSuccess` and three pushed payouts; max = first deal of a new pair |
| RelayEscrow    | `release`        | —       | —       | 197,140   | 0.000197 MSTC        | same settlement, paid by a keeper                                                 |
| RelayEscrow    | `claimTimeout`   | —       | —       | 77,520    | 0.000078 MSTC        | includes `recordFault`                                                            |
| RelayEscrow    | `raiseDispute`   | —       | —       | 33,792    | 0.000034 MSTC        |                                                                                   |
| RelayEscrow    | `addEvidence`    | 29,028  | 31,165  | 30,097    | 0.000030 MSTC        | event only                                                                        |
| RelayEscrow    | `resolveDispute` | 75,075  | 104,540 | 92,815    | 0.000093 MSTC        |                                                                                   |
| RelayEscrow    | `defaultResolve` | —       | —       | 62,417    | 0.000062 MSTC        |                                                                                   |
| RelayEscrow    | `cancelListing`  | 42,588  | 44,304  | 42,931    | 0.000043 MSTC        |                                                                                   |
| RelayEscrow    | `setPolicy`      | 36,619  | 53,767  | 46,869    | 0.000047 MSTC        |                                                                                   |
| ReputationSBT  | `mint`           | —       | —       | 74,247    | 0.000074 MSTC        |                                                                                   |
| ReputationSBT  | `recordSuccess`  | 55,075  | 145,348 | 88,956    | 0.000089 MSTC        | max = first deal for both users and the pair                                      |
| ReputationSBT  | `recordFault`    | —       | —       | 31,150    | 0.000031 MSTC        |                                                                                   |
| ReputationSBT  | `setTierLimits`  | 41,295  | 92,763  | 81,326    | 0.000081 MSTC        |                                                                                   |
| **Deployment** | RelayEscrow      |         |         | 4,250,002 | 0.00425 MSTC         | 7.1% of the block gas limit; runtime 18,440 bytes                                 |
| **Deployment** | ReputationSBT    |         |         | 2,474,851 | 0.00247 MSTC         | runtime 10,336 bytes                                                              |

A complete Buy-for-you deal (list, accept, deliver, confirm) costs about 523,000 gas = 0.00052 MSTC across
both parties. Deploying and configuring both contracts (roles, six category policies, limits, deposits,
fee) is about 7.4 M gas = 0.0074 tMSTC, well inside the 0.05 tMSTC deployment budget.

---

## 12. Static analysis

Slither 0.11.6 (102 detectors), run with `npm run slither -w @rewardrelay/contracts` (config `slither.config.json`:
dependencies and `contracts/mocks` excluded, fails on medium or high). 32 contracts analysed.

| Impact        | Detector            | Count                    | Disposition                                                                                                                                                                                                                                                                                                                         |
| ------------- | ------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| High          | —                   | 0                        | —                                                                                                                                                                                                                                                                                                                                   |
| Medium        | `unused-return`     | 3 (suppressed in source) | False positives: tuple destructuring deliberately drops `trustOf`'s history counters in `_requireTrust`/`_canAccept` and `tryRecover`'s error argument in `_consumeListingAuth`; every value that matters is checked. Each line carries a `slither-disable-next-line` with the reason.                                              |
| Low           | `timestamp`         | 12                       | By design: every window is ≥ 1 minute with strict, non-overlapping comparisons (§2.2); a block producer's few seconds of freedom cannot change an outcome in practice.                                                                                                                                                              |
| Low           | `reentrancy-benign` | 3                        | `_complete`, `_settleDispute`, `claimTimeout` write accounting after calling the trusted, immutable badge contract and between payouts. All run under `nonReentrant`, status is final before the first call, and `totalEscrowed` is lowered before each push so I1 holds during every callback (tested with re-entering receivers). |
| Low           | `events-maths`      | 1                        | False positive: `createListing` emits `ListingCreated` through `_emitListingCreated` (kept out of line to avoid stack-too-deep).                                                                                                                                                                                                    |
| Informational | `assembly`          | 1                        | `_payout` uses a 30 000-gas `call` that copies no return data, so a receiver cannot make the escrow pay for a large revert payload.                                                                                                                                                                                                 |
| Informational | `low-level-calls`   | 1                        | `withdraw` must send native MSTC; the balance is zeroed first and failure reverts.                                                                                                                                                                                                                                                  |
| Informational | `naming-convention` | 2                        | `SBT` (immutable, solhint naming rule) and `LISTING_AUTH_TYPEHASH` (EIP-712 convention).                                                                                                                                                                                                                                            |

Fixed during the analysis: `shadowing-local` (Low, 2) — the interface parameters of `setFeeBps` and
`setTreasury` shadowed the `feeBps()`/`treasury()` getters; renamed to `newFeeBps`/`newTreasury`
(selectors unchanged).

---

## 13. Verification summary

| Suite                             | Cases                | What it proves                                                                                                                                        |
| --------------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ReputationSBT.test.ts`           | 34                   | minting, soulbound transfer/approval paths, ERC-165/5192, tiers with unique-counterparty gating, faults, outcome accounting, administration, metadata |
| `RelayEscrow.smoke.test.ts`       | 1                    | both deal types end to end with `solvencyDelta() == 0` after every step                                                                               |
| `RelayEscrow.lifecycle.test.ts`   | 36                   | harness scenarios 1, 3, 4, 5, 6, 9, cancellation, views and the §8 table                                                                              |
| `RelayEscrow.adversarial.test.ts` | 28                   | scenarios 2, 7, 8, 10 with a real attacker contract, plus input validation                                                                            |
| `RelayEscrow.invariant.test.ts`   | 1 (300 random steps) | I1–I4 after every step of a seeded random walk (seed 20261027; also run with seeds 1, 42, 777)                                                        |

Coverage (solidity-coverage 0.8.17, mocks and interfaces excluded): **100% statements, 100% branches,
100% functions, 100% lines** on both RelayEscrow and ReputationSBT.
