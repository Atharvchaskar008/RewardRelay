# Demo guide

A click-by-click walkthrough of SAKER's main flows on MST Testnet. Each flow takes a few minutes
because the testnet policies use short demo windows: **5 minutes to deliver, release 3 minutes after
delivery, 10 minutes for dispute evidence**. Production windows are days (see
[protocol.md](protocol.md)).

## The live site

Everything below works on **https://**SAKER_APP_URL**** (MST Testnet). The landing page is at
`/`; **Open app** leads to the app (`/dashboard`) with **Explore · Share · Deals · Profile** in the top
bar (bottom bar on phones). A quick path for a live demo on one laptop:

1. **Two browser windows side by side** (for example Chrome and Chrome Incognito): the Sharer on the
   left, the Seeker on the right. Each phone account keeps its own wallet in the browser, so one
   window can also switch accounts by signing out and in.
2. **Buy-for-you** (section 1) end to end: list, pay, deliver with an order id, confirm. Open the
   mstscan links on the deal page to show each step on-chain.
3. **The cheat demo**: list the same Pass-on code a second time (refused), or a price above ₹500 with
   a New badge (refused before anything is signed).
4. **The Trust Badge** on mstscan: `trustOf(address)` on the verified ReputationSBT contract.

To check the deployment itself: `npm run check:live -w @rewardrelay/web`.

## Before you start

- **Three browser profiles** (for example Chrome, a Chrome Incognito window and Edge). Each account
  keeps its wallet in its own browser, so use one profile per role: **Admin**, **Sharer**, **Seeker**.
- **Test phone numbers.** The demo uses Firebase test numbers with fixed codes. They are shared with
  the judges alongside the submission and are never stored in this repository.
- **Sign in** on each profile: enter the number, the fixed code, then choose a 6-12 digit PIN. Every
  new account receives a Trust Badge and a small amount of test MSTC for gas; to pay for deals,
  send the Sharer and the Seeker about 0.05 tMSTC each from any MST Testnet wallet (shown on
  **Wallet**).
- **Crypto wallet instead of a PIN (optional).** Install the BridgeKey (Chrome Web Store) or
  MetaMask extension. After the code, choose **BridgeKey** or **MetaMask** under "Already use a
  crypto wallet?" (each installed wallet has its own button): sign the link message, and approve each
  deal in the wallet (it adds and switches to MST Testnet when asked). Use a new number: an account
  keeps the wallet it was first linked to.
- Several accounts can share one browser (sign out, sign in with another number): each account has
  its own wallet there.
- New accounts can deal up to **₹500** (the New tier limit at the demo rate of ₹1,00,000 per MSTC).

## 1. Buy-for-you

| Step | Who    | Do                                                                                                                                                       | You should see                                  |
| ---- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| 1    | Sharer | **Share** → category **Shopping card offers (Buy-for-you)**, a title, face value `444`, price `400`, tick the declaration → **List and lock my deposit** | the deal page with **Listed** in the timeline   |
| 2    | Seeker | **Explore** → open the listing → fill in **Deliver to** (name, mobile, address, 6-digit PIN code) → **Pay**                                              | **Paid, MSTC locked in escrow**                 |
| 3    | Sharer | **Deals** → open the deal → **Show delivery details** → enter an order id → **Submit order proof and mark delivered**                                    | **Order proof submitted**; release time shown   |
| 4    | Seeker | open the deal → **Show order proof** → **Confirm I received it**                                                                                         | **Confirmed by the seeker**; the deal completes |

If the Seeker does nothing, the payment is released automatically after the release time (by the
keeper, or when anyone opens the deal).

## 2. Pass-on code

| Step | Who    | Do                                                                                                                                                                                | You should see                 |
| ---- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| 1    | Sharer | **Share** → category **Shareable codes and vouchers (Pass-on)**, a title, face value `100`, price `40`, a **Shareable code**, tick the declaration → **List and lock my deposit** | **Listed**                     |
| 2    | Seeker | **Explore** → open the listing → **Pay**                                                                                                                                          | **Code sealed for the seeker** |
| 3    | Seeker | **Reveal code**, then **Confirm I received it**                                                                                                                                   | the code; the deal completes   |

Only the paying Seeker can reveal the code, and every reveal is logged.

## 3. Dispute and arbitration

| Step | Who    | Do                                                                                                                            | You should see                                          |
| ---- | ------ | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| 1-3  |        | Run steps 1-3 of the Buy-for-you flow                                                                                         | **Order proof submitted**                               |
| 4    | Seeker | within 3 minutes: **Report a problem** → **Not as described**, describe it → **Submit**                                       | **Dispute raised**                                      |
| 5    | Sharer | optional: **Add evidence** → **Delivered as agreed**                                                                          | **Evidence added**                                      |
| 6    | Admin  | open `/admin` → read both sides' evidence and the rulebook suggestion → set the Seeker share and fault → **Resolve on-chain** | **Resolved by the arbiter**, with the payout on mstscan |

With a full refund and the Sharer at fault, the Seeker receives the price, their deposit and the
Sharer's deposit, and the Sharer's Trust Badge records a lost dispute. An admin can never rule on a
deal they are part of; if nobody rules within the arbiter timeout, anyone can apply a 50/50 default.

## 4. Protections to try

| Try                                                      | What happens                                                                                   |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| List the **same code** a second time                     | refused before anything is signed: the code is already listed                                  |
| List or pay a deal **above ₹500** with a new account     | refused by the contract: the deal is above the Trust Badge limit                               |
| Sharer **misses the 5-minute delivery deadline**         | the Seeker sees **Claim my refund** and gets the price, their deposit and the Sharer's deposit |
| **Pay without a delivery address** on a Buy-for-you deal | refused before payment with a message naming the missing field                                 |

## Checking it on-chain

Every timeline entry in the deal room links to its transaction on
[testnet.mstscan.com](https://testnet.mstscan.com), and the deal page links the escrow contract and
both parties' addresses. Each user's Trust Badge (tier, completed deals, lost disputes) is at
`/badge/<address>`.
