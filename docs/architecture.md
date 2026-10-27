# Architecture

RewardRelay is a trusted buy-it-for-me marketplace on MST Blockchain. A **Sharer** holds a benefit
(card offer, wallet credit, membership price, shareable code); a **Seeker** wants the discount and pays
in MSTC, held by an escrow smart contract until delivery.

## System overview

```mermaid
flowchart LR
  subgraph Browser
    UI[Next.js UI<br/>PWA] --> SDK[Client SDK]
    SDK --> W[Embedded wallet<br/>PIN-encrypted key]
  end
  subgraph Vercel["Next.js on Vercel"]
    API[API routes<br/>withRoute] --> S[Server modules<br/>chain · crypto · signer]
  end
  SDK -- "HTTPS + Firebase ID token" --> API
  SDK -- "signed txs via /api/rpc" --> RPC[(MST RPC)]
  S -- "server-signed txs<br/>(mint, arbiter, top-up, release)" --> RPC
  RPC --> ESC[RelayEscrow]
  ESC <--> SBT[ReputationSBT]
  S --> FS[(Firestore)]
  UI --> FA[Firebase Auth<br/>phone OTP]
  CRON[cron-job.org] -- "X-Cron-Secret" --> API
```

| Component                              | Responsibility                                                                                           |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `RelayEscrow`                          | Deals, deposits, deadlines, disputes, payouts; per-deal policy snapshot; EIP-712 Pass-on authorisation   |
| `ReputationSBT`                        | Soulbound Trust Badge (ERC-5192): tiers, deal limits, completed deals, Relay Points                      |
| API (`apps/web/src/app/api`)           | Identity and wallet linking, listing verification, private deal data, Code Vault, disputes, cron, health |
| Server modules (`apps/web/src/server`) | Env validation, chain readers, transaction manager, envelope encryption, Firestore repositories          |
| Client SDK (`apps/web/src/client/sdk`) | Typed API client, transaction helpers, flows, React hooks                                                |
| `packages/shared`                      | ABIs, addresses, chain config, enums, money/listing rules, `computeNextAction`                           |
| Firestore                              | Listing metadata (public), server-only indexes, encrypted private data                                   |

## Principles

1. **The chain is the source of truth** for money and deal status; every privileged server action
   re-reads the deal on-chain first.
2. **Only what strangers must trust goes on-chain**: escrow, deposits, deadlines, code fingerprints,
   proof and evidence hashes, reputation.
3. **Private data stays off-chain**, envelope-encrypted, and is served only to the deal's parties.
4. **The UI needs no blockchain logic**: the deal view carries `nextAction`, labels, amounts in MSTC
   and ₹, deadlines and explorer links.

## Deal lifecycle

```mermaid
stateDiagram-v2
  [*] --> Listed: createListing (sharer deposit)
  Listed --> Cancelled: cancelListing
  Listed --> Locked: acceptListing (Buy-for-you)
  Listed --> Delivered: acceptListing (Pass-on)
  Locked --> Delivered: markDelivered(proofHash)
  Locked --> Refunded: claimTimeout
  Delivered --> Completed: confirmReceipt / release
  Delivered --> Disputed: raiseDispute(evidenceHash)
  Disputed --> Completed: confirmReceipt
  Disputed --> Resolved: resolveDispute / defaultResolve
```

The full state machine, money flows, invariants and threat model are in
[protocol.md](protocol.md).

## Main flows

**Buy-for-you**: the Sharer lists (createListing + chain-verified metadata) → the Seeker pays
(acceptListing) and sends delivery details (encrypted) → the Sharer orders in their own account,
submits the order id (encrypted) and calls `markDelivered(proofHash)` → the Seeker confirms, or anyone
releases after the return window (the cron does it every 2 minutes).

**Pass-on**: the Sharer's code is fingerprinted (HMAC) and sealed in the Code Vault; the server signs
an EIP-712 authorisation used by `createListing` → the Seeker pays and the deal is delivered at once →
the code is revealed only to that Seeker → confirm, or dispute within the check window.

**Disputes**: each party submits an evidence bundle (encrypted) and commits its hash on-chain → the
admin desk shows the evidence, the order proof and a rulebook suggestion → the arbiter signer calls
`resolveDispute`; without a ruling, either party can apply the 50/50 default after the timeout.

## Data model (Firestore)

| Collection                                                          | Contents                                                         | Access      |
| ------------------------------------------------------------------- | ---------------------------------------------------------------- | ----------- |
| `listings/{dealId}`                                                 | Public listing metadata (hash-checked against the chain)         | public read |
| `users/{uid}`, `phoneIndex`, `walletIndex`                          | One phone ↔ one wallet, onboarding state                         | server only |
| `deals/{dealId}` (+ `private/`, `files/`, `access/`)                | Deal index, encrypted details/proof, encrypted files, access log | server only |
| `vault/{fingerprint}`                                               | Encrypted Pass-on codes                                          | server only |
| `disputes/{dealId}`, `audit/`                                       | Encrypted evidence bundles, append-only arbiter audit            | server only |
| `challenges`, `idempotency`, `rateLimits`, `locks`, `walletBackups` | Infrastructure                                                   | server only |

Firestore rules deny every client write and every read except `listings`.

## Repository layout

```
apps/web            Next.js app (UI + API routes + server modules + SDK)
packages/contracts  Solidity contracts, Hardhat tests, deployment scripts and records
packages/shared     ABIs, addresses, chain config, protocol rules shared by everything
docs/               This documentation
```
