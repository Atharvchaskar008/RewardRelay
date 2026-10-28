# RewardRelay API and client SDK

Everything the UI needs to build RewardRelay screens without touching the chain, keys or crypto.
Server code lives in `apps/web/src/server/` (Next.js route handlers under `apps/web/src/app/api/`),
the SDK in `apps/web/src/client/sdk/` (import from `@/client/sdk`).

- Chain: MST Testnet (chain id `91562037`), contracts in `packages/shared/src/deployments.ts`.
- Money: every amount is MSTC wei on-chain; views also give `mstc` (decimal string) and `inr` (number)
  at the demo rate `DEMO_RATE_INR_PER_MSTC` (₹1,00,000 per MSTC). Show **"X MSTC (≈ ₹Y)"**
  (`formatMstcInr` in `rewardrelay-shared`).
- Time: the deal room uses the chain clock (`chainTime` in the deal view).

---

## 1. Conventions

### Envelope

Every JSON response is one of

```json
{ "ok": true, "data": { "...": "..." } }
{ "ok": false, "error": { "code": "CHAIN_STATE_MISMATCH", "message": "User-safe text", "requestId": "…", "details": {} } }
```

`message` is always safe to show. `requestId` is also in the `X-Request-Id` header; quote it in bug
reports. All API responses are `Cache-Control: no-store`. Bigints are serialised as decimal strings.

### Headers

| Header                                         | When                                                                                                                                                                                                                                                                               |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Authorization: Bearer <Firebase ID token>`    | every route except the public ones (§2); writes and private reads check revocation on every call, other reads at most once a minute                                                                                                                                                |
| `Idempotency-Key: <8-128 chars [A-Za-z0-9_-]>` | every route marked **idem** (required). Same key + same request → the stored response is replayed (`Idempotent-Replayed: true`); same key + different request → `CONFLICT`; a failed request releases the key. The SDK generates keys and reuses them on its single network retry. |
| `X-Cron-Secret`                                | `/api/cron/release` only                                                                                                                                                                                                                                                           |

### Error codes

| Code                   | HTTP | Meaning / typical UI reaction                                                           |
| ---------------------- | ---- | --------------------------------------------------------------------------------------- |
| `AUTH_REQUIRED`        | 401  | not signed in or session expired → send to `/login`                                     |
| `FORBIDDEN`            | 403  | not your deal / not an admin / wallet not linked                                        |
| `VALIDATION_FAILED`    | 400  | bad input; `details.issues[]` = `{path, message}` per field                             |
| `RATE_LIMITED`         | 429  | slow down; `Retry-After` header (seconds)                                               |
| `NOT_FOUND`            | 404  | unknown deal, no backup, `/api/me` before linking                                       |
| `CONFLICT`             | 409  | duplicate (phone, wallet, code, listing, idempotency key)                               |
| `CHAIN_STATE_MISMATCH` | 409  | the on-chain deal does not allow this now (`details.status`); refresh the deal          |
| `TX_FAILED`            | 502  | a server transaction failed (`details.reason` = contract error, `details.hash` if sent) |
| `VAULT_LOCKED`         | 423  | the Pass-on code is not unlocked for you yet                                            |
| `INTERNAL`             | 500  | our bug; show the requestId                                                             |
| `NETWORK`              | 0    | (SDK only) the API could not be reached                                                 |

The SDK throws `ApiError {code, status, message, requestId, details}`. Transaction failures throw
`ChainError {message, reason, hash}` where `reason` is the contract's custom error (e.g.
`DealValueAboveLimit`) and `message` is user-safe (`REVERT_MESSAGES` in `apps/web/src/client/sdk/errors.ts`).
`userMessage(error)` returns one sentence for any error.

### Rate limits (token bucket per user, per IP when anonymous)

Writes and private reads are counted across instances (Firestore); other reads per instance.

challenge 10/min · link-wallet 5/min · backup PUT 5 burst + 2/min · backup GET **5 per hour** ·
codes/listings 10/min · deal reads 120/min · details/proof writes 10 burst + 5/min · listings feed
60/min (IP) · health 30/min (IP) · admin 30/min · resolve 10/min.

### Timing

Every response has a [`Server-Timing`](https://www.w3.org/TR/server-timing/) header with the route
phases (`auth`, `limit`, `idem`, `app`), the busy time per backend (`db` Firestore, `chain` MST RPC,
`identity` Firebase Auth, with the number of calls) and the `total`, in milliseconds. The same
numbers are in the `timing` field of the `api.request` log line.

---

## 2. Routes

| Route                                       | Auth            | Body / query                                                                                          | Returns                                                                                                                                                                                       |
| ------------------------------------------- | --------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/health`                           | public          | —                                                                                                     | `HealthReport`: `status` ok/degraded/down, `chain{ok, chainId, latestBlock, blockTime}`, `firestore{ok}`, `signers[{role, address, balanceMstc, low}]`, `contracts`; 503 when the RPC is down |
| `POST /api/auth/challenge`                  | user            | `{address}`                                                                                           | `{message, nonce, expiresAt}`: an EIP-4361 message, single use, 5 minutes                                                                                                                     |
| `POST /api/auth/link-wallet`                | user · idem     | `{address, message, signature, walletKind?}` (`embedded` default, or `injected` for a browser wallet) | `UserView`. Needs a phone-verified session. Mints the Trust Badge and sends the welcome top-up once. `CONFLICT` if the phone or wallet is linked elsewhere                                    |
| `GET /api/me`                               | user            | —                                                                                                     | `UserView` re-read from chain; `NOT_FOUND` before linking                                                                                                                                     |
| `PUT /api/wallet/backup`                    | user            | `{address, ciphertext, iv, salt, kdf{name:"PBKDF2", iterations ≥ 310000, hash:"SHA-256"}, version}`   | `{address, version, updatedAt}`. Only the linked wallet; raw keys refused                                                                                                                     |
| `GET /api/wallet/backup`                    | user            | —                                                                                                     | the stored encrypted blob                                                                                                                                                                     |
| `POST /api/codes/authorize`                 | user · idem     | `{code, category}` (Pass-on category)                                                                 | `{fingerprint, auth{nonce, deadline, signature}, category}` for `createListing`. `CONFLICT` for a code already listed                                                                         |
| `POST /api/listings`                        | user · idem     | `{dealId, title, description, category, faceValueInr, priceInr, eventTime?, terms{}}`                 | `ListingView` (201). Accepted only if it matches the on-chain deal (sharer, category, event time, price ±1 wei, terms hash)                                                                   |
| `GET /api/listings`                         | public          | `?category=&cursor=&status=open\|all`                                                                 | `{items: ListingView[], nextCursor}` (status read from chain)                                                                                                                                 |
| `GET /api/deals/:id`                        | optional        | —                                                                                                     | `DealView` (see §3); a due deal is released in the background                                                                                                                                 |
| `POST /api/deals/:id/details`               | seeker · idem   | `{name, phone, addressLines[1-4], pincode}`                                                           | `{dealId, submitted}`; only while Locked                                                                                                                                                      |
| `GET /api/deals/:id/details`                | sharer          | —                                                                                                     | `{details, submittedAt}`; Locked or Delivered; access logged                                                                                                                                  |
| `POST /api/deals/:id/proof`                 | sharer · idem   | JSON `{orderId, notes?}` or multipart `orderId`, `notes`, `invoice` (PDF/JPEG/PNG ≤ 2 MB)             | `{proofHash, invoice}`: call `markDelivered(id, proofHash)` next; only while Locked                                                                                                           |
| `GET /api/deals/:id/proof`                  | party           | —                                                                                                     | `{orderId, notes, proofHash, onChainProofHash, matchesChain, invoice{path}}`; seeker after delivery                                                                                           |
| `GET /api/deals/:id/invoice`                | party           | —                                                                                                     | the file (attachment)                                                                                                                                                                         |
| `GET /api/deals/:id/code`                   | seeker          | —                                                                                                     | `{code, firstRevealedAt}`; Pass-on, once paid (`VAULT_LOCKED` before)                                                                                                                         |
| `POST /api/disputes/:id/evidence`           | party · idem    | JSON `{claim, text}` or multipart `claim`, `text`, up to 3 `files`                                    | `{evidenceHash, onChainAction: "raiseDispute"\|"addEvidence"}`                                                                                                                                |
| `GET /api/admin/disputes`                   | admin           | —                                                                                                     | `{items: AdminDisputeView[]}`: open disputes from chain events, decrypted evidence, `committedOnChain`, proof, rulebook `suggestion`                                                          |
| `POST /api/admin/disputes/:id/resolve`      | admin · idem    | `{seekerShareBps 0-10000, faultParty None\|Sharer\|Seeker, reason}`                                   | `{status, txHash, txUrl, auditId}`; audit record written                                                                                                                                      |
| `GET /api/admin/disputes/:id/files/:fileId` | admin           | —                                                                                                     | an evidence file                                                                                                                                                                              |
| `GET /api/cron/release`                     | `X-Cron-Secret` | —                                                                                                     | `CronSummary {released[], defaultResolved[], purged[], refreshed, topupsRetried, expiredDeleted, skipped?}`                                                                                   |

Evidence claims: `not_delivered`, `not_as_described`, `booking_cancelled`, `code_invalid`,
`delivered_as_agreed`, `other`. Categories: `ecommerce`, `travel`, `food`, `movies`, `membership`
(Buy-for-you) and `coupon` (Pass-on); labels and the blocked topics are in `rewardrelay-shared`
(`CATEGORY_LABELS`, `BLOCKED_TOPICS`).

---

## 3. The deal view and the one-button rule

`GET /api/deals/:id` (`useDeal(id)`, polled every 5 s while active) returns:

`id, type (BuyForYou|PassOn), category, categoryLabel, status, statusLabel, role
(sharer|seeker|visitor), nextAction, secondaryActions[], actionReason, price{wei,mstc,inr}, priceMstc,
priceInr, deposit, depositMstc, deposits{sharer,seeker}, payAmount, feeBps, deadlines{deliverBy,
releaseAt, eventTime, evidenceUntil, defaultRulingAt}, sharer, seeker, deliveryDetailsSent (Buy-for-you
parties while Locked/Delivered, else null), counterpartTrust{tier, tierName,
completed, disputesLost}, listing{title, description, faceValueInr, priceInr, terms}, hashes,
mstscanUrls{escrow, sharer, seeker}, timeline[{event, label, at, txHash, url}], chainTime`

Show **one primary button** for `nextAction` and small buttons for `secondaryActions`. Call
`useDealAction(id).mutate({ action, input })` for any of them; it runs the API calls and the
transaction in order and returns the refreshed view.

| Action                        | Who / when                        | Button                                  | `input` needed                     | What runs                                                                                                       |
| ----------------------------- | --------------------------------- | --------------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `PAY`                         | visitor, Listed                   | "Pay X MSTC (≈ ₹Y)"                     | Buy-for-you: `details`             | details checked first (no payment without a valid address) → `acceptListing` (price + deposit) → `POST details` |
| `MARK_DELIVERED`              | sharer, Locked, before deliverBy  | "Submit order proof"                    | `proof{orderId, notes?, invoice?}` | `POST proof` → `markDelivered(proofHash)`                                                                       |
| `CONFIRM`                     | seeker, Delivered (check window)  | "Confirm received"                      | —                                  | `confirmReceipt`                                                                                                |
| `RELEASE_AVAILABLE`           | either party, after releaseAt     | "Release payment"                       | —                                  | `release`                                                                                                       |
| `CLAIM_REFUND`                | seeker, Locked, after deliverBy   | "Claim refund"                          | —                                  | `claimTimeout`                                                                                                  |
| `WAIT`                        | see `actionReason`                | none (show the reason and the deadline) | —                                  | —                                                                                                               |
| `NONE`                        | finished or not your deal         | none                                    | —                                  | —                                                                                                               |
| `CANCEL` (secondary)          | sharer, Listed                    | "Cancel listing"                        | —                                  | `cancelListing`                                                                                                 |
| `RAISE_DISPUTE` (secondary)   | seeker, check window              | "Report a problem"                      | `evidence{claim, text, files?}`    | `POST evidence` → `raiseDispute(evidenceHash)`                                                                  |
| `ADD_EVIDENCE` (secondary)    | party, evidence window            | "Add evidence"                          | `evidence`                         | `POST evidence` → `addEvidence(evidenceHash)`                                                                   |
| `CONFIRM` (secondary)         | seeker, Disputed                  | "Withdraw dispute and release"          | —                                  | `confirmReceipt`                                                                                                |
| `DEFAULT_RESOLVE` (secondary) | party, after the arbiter deadline | "Apply 50/50 ruling"                    | —                                  | `defaultResolve`                                                                                                |

`actionReason` values: `SIGN_IN`, `NO_WALLET`, `NO_BADGE`, `OVER_LIMIT`, `PAUSED`, `EVENT_STARTED`
(visitor cannot pay), `AWAITING_SEEKER`, `AWAITING_DELIVERY`, `IN_CHECK_WINDOW`, `AWAITING_ARBITER`,
`DELIVERY_WINDOW_CLOSED`, `NOT_A_PARTY`, `FINISHED`.

If a paid Buy-for-you deal has `deliveryDetailsSent: false` (the details call failed after the payment),
show the seeker the address form again and call `useSendDeliveryDetails(id).mutate(details)`; tell the
sharer to wait for it.

Panels by role: sharer while Locked/Delivered → delivery details (`getDetails`); both after delivery →
order proof (`getProof`, invoice link); Pass-on seeker once paid → "Reveal code" (`deals.code`).
Always show the "Never share card numbers, logins or OTPs" banner in the deal room.

---

## 4. SDK

```tsx
import {
  RewardRelayProvider,
  useMe,
  useWallet,
  useListings,
  useDeal,
  useDealAction,
} from "@/client/sdk";

<RewardRelayProvider
  config={{
    chain: {
      chainId: 91562037,
      rpcUrl: "/api/rpc/testnet",
      explorerUrl: "https://testnet.mstscan.com",
      escrow: "0x5aB34fB9CFce4a442b2CA773692a7D031D173C9A",
    },
    inrPerMstc: 100000,
  }}
  getIdToken={() => auth.currentUser?.getIdToken() ?? Promise.resolve(null)}
  accountId={user?.uid ?? null} // one device wallet and wallet choice per account on this browser
>
  <App />
</RewardRelayProvider>;
```

| Hook                              | Gives                                                                                                                                                                                                                                                                                                         |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `useMe()`                         | react-query result of `UserView \| null` (null = signed in but no wallet linked yet)                                                                                                                                                                                                                          |
| `useWallet()`                     | `{ready, exists, unlocked, address, kind, create(pin), unlock(pin), lock(), backup(), restore(pin), forget(), connectBrowserWallet(wallet, linkedAddress?), disconnectBrowserWallet()}`; `create` also links the wallet and uploads the backup; `unlocked` = can sign now (a connected browser wallet counts) |
| `useBrowserWallets()`             | browser wallets found in this browser (EIP-6963, or `window.ethereum`), `null` while looking                                                                                                                                                                                                                  |
| `useListings({category, status})` | infinite query of `ListingView` pages                                                                                                                                                                                                                                                                         |
| `useDeal(id)`                     | the deal view, polled every 5 s while active                                                                                                                                                                                                                                                                  |
| `useDealAction(id)`               | `mutate({action, input})`, `isPending`, `error` (use `userMessage(error)`)                                                                                                                                                                                                                                    |

Plain functions (no React): `createApiClient`, `onboardWallet`, `restoreWallet`, `listBuyForYou`,
`listPassOn`, `payForDeal`, `deliverOrder`, `raiseDispute`, `addEvidence`, `runDealAction`, and
`tx.*` (`createListing`, `acceptListing`, `markDelivered`, `confirmReceipt`, `release`,
`claimTimeout`, `raiseDispute`, `addEvidence`, `defaultResolve`, `cancelListing`, `withdraw`,
`sendMstc`). Every transaction is simulated first, sent as a legacy transaction at 1 gwei and awaited
to its receipt (`{hash, receipt, explorerUrl}`). A browser wallet (BridgeKey, MetaMask) is linked with
`onboardInjectedWallet(api, provider)` and signs through `injectedChainContext(config, provider,
address?)`, which switches the wallet to MST (adding it with the public RPC if needed) right before
each transaction; `useSdkContext()` uses it automatically while a browser wallet is connected.

The embedded wallet (`EmbeddedWallet`): key generated in the browser, stored only encrypted with the
PIN (PBKDF2-SHA-256 310,000 → AES-256-GCM) in IndexedDB, unlocked per session, auto-locked after 30
minutes idle. PIN: 6-12 digits.

---

## 5. End-to-end flows

**Onboarding**: phone OTP (Firebase) → `useWallet().create(pin)` = create key → `POST challenge` →
sign → `POST link-wallet` (badge minted, top-up sent once) → `PUT backup`. New device:
`useWallet().restore(pin)`. **Browser wallet** instead of a PIN: phone OTP →
`useWallet().connectBrowserWallet(wallet)` = the wallet signs the challenge → `POST link-wallet`
with `walletKind: "injected"` (no backup: the wallet holds the key). `UserView.walletKind` tells the UI
to offer "connect your wallet" (not a PIN) on a new device; the choice is remembered per browser
and reconnected without a prompt.

**Buy-for-you**: sharer `listBuyForYou(draft)` (createListing + `POST listings`) → seeker `PAY` with
details → sharer reads details, orders in their own account, `MARK_DELIVERED` with the order id →
seeker sees the proof, `CONFIRM` (or anyone releases after the check window; the cron does it every
2 minutes) → both badges updated.

**Pass-on**: sharer `listPassOn(draft, code)` (`POST codes/authorize` → createListing with the server's
EIP-712 authorisation → `POST listings`) → seeker `PAY` (deal goes straight to Delivered) → "Reveal
code" → `CONFIRM`, or `RAISE_DISPUTE` within the check window.

**Failure paths**: no delivery → seeker `CLAIM_REFUND` after deliverBy (sharer's deposit goes to the
seeker); dispute → admin desk `/admin` → `POST resolve` (or `DEFAULT_RESOLVE` 50/50 after the arbiter
deadline).

---

## 6. Automation: cron-job.org

Create one job at cron-job.org (free):

| Setting           | Value                                                        |
| ----------------- | ------------------------------------------------------------ |
| URL               | `https://<your-vercel-domain>/api/cron/release`              |
| Method            | GET                                                          |
| Schedule          | every 2 minutes (`*/2 * * * *`)                              |
| Request header    | `X-Cron-Secret: <the CRON_SECRET value from the Vercel env>` |
| Timeout           | 60 s                                                         |
| Notify on failure | on (non-2xx)                                                 |

Each run refreshes the deal index, releases due deals, applies default rulings and purges expired
private data (details, proofs, files 7 days after a deal ends), retries welcome top-ups that failed
before broadcast (e.g. the funder was empty at sign-up) and deletes expired idempotency, rate-limit and
challenge records. Overlapping runs are safe (Firestore lease). Watch `/api/health`: `signers[].low` turns true when a server wallet needs MSTC.

---

## 7. Local development and tests

```bash
npm run compile
npm test -w @rewardrelay/web                     # unit tests (no network)
npm run test:integration -w @rewardrelay/web     # Firebase Auth + Firestore emulators + a local Hardhat node
```

The emulator suite (Java 21 required for the Firestore emulator) starts a Hardhat node on port 8547,
deploys and configures fresh contracts with throwaway keys, signs users in with phone numbers on the
Auth emulator and calls the route handlers and the SDK directly.
