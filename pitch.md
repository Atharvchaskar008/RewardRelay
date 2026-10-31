# SAKAR — Hackathon Winning Pitch & Demo Video Script

> **Target Duration:** 3 to 4 Minutes  
> **Goal:** High-energy, professional, authoritative presentation designed to win judges on Problem Clarity, Technical Ingenuity, Live Execution, and UI/UX Polish.

---

## 🎬 Part 1: How to Set Up Your Screen for the Video

### The "Split Screen" Strategy (The Gold Standard for Hackathon Escrow Demos)
To prove the protocol is genuinely peer-to-peer and decentralized without cuts:
1. **Left Window (Normal Chrome):** Sharer / Cardholder (e.g., Logged in or Guest mode)
2. **Right Window (Chrome Incognito or Brave):** Seeker / Buyer
3. **Why this wins:** When the Seeker pays on the right, the Sharer's screen on the left updates in real time to "Paid / Ready to Deliver". When the Sharer marks delivered, the Seeker's screen immediately unlocks "Confirm receipt" or "Report a problem". Judges immediately see the state machine in action!

---

## 🎙️ Part 2: Step-by-Step Spoken Script

```
[TIMELINE OVERVIEW]
0:00 - 0:40 | The Hook & The Problem
0:40 - 1:15 | SAKAR: The Solution & Value Proposition
1:15 - 1:55 | Technical Architecture (MST Blockchain, Non-Custodial Validator)
1:55 - 3:00 | Live Demo Walkthrough (Side-by-Side: Sharer & Seeker)
3:00 - 3:30 | Grand Finale: Landing Page & Closing Vision
```

---

### Segment 1: The Hook & The Problem (0:00 - 0:40)
*(Camera on you or starting on a compelling title slide / problem visual)*

> **"Hello judges. Every single year, billions of dollars in credit card discounts, airport lounge access, dining vouchers, and e-commerce perks expire completely unused.**
> 
> **Why? Because cardholders can't use all of them, while shoppers hunting for discounts would love to use them.**
> 
> **Yet today, strangers cannot trade these benefits safely. If you try, you face a nightmare: buyers get scammed by fake promo codes, sellers get ghosted after paying, and sharing credit card numbers or OTPs is a massive security hazard.**
> 
> **Centralized marketplaces cannot solve this because escrow fees are high, payouts take weeks, and middlemen hold your funds. We built SAKAR to solve this once and for all."**

---

### Segment 2: SAKAR — The Solution (0:40 - 1:15)
*(Transition to the Live App at `saker-app.vercel.app`)*

> **"Welcome to SAKAR — a trust-minimized, peer-to-peer perk relay powered by the MST Blockchain.**
> 
> **SAKAR introduces three groundbreaking innovations:**
> 
> 1. **Zero-Credential Trading:** Cardholders buy and ship directly to the buyer's doorstep or share vault-encrypted vouchers. Zero card numbers or OTPs are ever shared.
> 2. **Two-Sided Escrow Protection:** Both the buyer and seller lock security deposits into our decentralized smart contract. Neither party can cheat, and if an e-commerce platform cancels or delays an order, our smart delay protection ensures fair refunds without penalizing the seller.
> 3. **Soulbound Trust Badges (ReputationSBT):** Successful trades build permanent on-chain reputation, keeping collateral as low as 5% and reducing deposit requirements even further for verified power sellers over time."**

---

### Segment 3: Technical Architecture & Non-Custodial Design (1:15 - 1:55)
*(Show Architecture Diagram or MSTScan Explorer showing deployed contracts)*

> **"Technically, SAKAR is built with zero compromise:**
> 
> - **Deployed on MST Mainnet (Chain ID 4646):** Our core contracts `RelayEscrow` and `ReputationSBT` enforce an unbreakable mathematical solvency invariant: the contract balance strictly matches total liabilities before and after every transaction.
> - **Always-Active Cryptographic Validator (Zero Custody):** The validator actively validates every transaction, voucher payload, and merchant invoice in real time—there is no unvalidated or offline mode. Yet crucially, **the validator holds ZERO money**. 100% of user funds and collateral remain locked strictly inside the `RelayEscrow` smart contract on MST. The validator purely issues EIP-712 cryptographic proofs and arbitrates disputes.
> - **Decentralized Circuit Breaker:** The smart contract programmatically enforces dispute timers and objective settlement rules so funds can never be frozen or manipulated by any single party.
> - **Native Gas Relayer:** Users enjoy instant, zero-friction transactions with sponsored gas relaying and seamless BridgeKey / MetaMask wallet connectivity."**

---

### Segment 4: Live Interactive Demo (Side-by-Side) (1:55 - 3:00)
*(Screen setup: Left side = Sharer, Right side = Seeker)*

> **"Let's see it live on the MST network.**
> 
> **[On the Left Window - Sharer]:**  
> Here on the left is our Sharer who has an unused Amazon 20% discount offer. They create a listing. The smart contract queries their Soulbound Trust Badge and locks their collateral deposit into the `RelayEscrow` contract.
> 
> **[On the Right Window - Seeker]:**  
> Now on the right, our buyer opens the Deal Room. They see the exact discount, the verified seller badge, and the locked escrow terms. The buyer clicks **Pay**, providing their encrypted delivery address. Notice how in less than a second, the state machine shifts to **Paid & Locked**.
> 
> **[Back to Left Window - Sharer]:**  
> The Sharer receives the delivery address, places the order on Amazon directly to the buyer, and inputs the order tracking ID. They click **Mark Delivered**.
> 
> **[Back to Right Window - Seeker]:**  
> Instantly on the right, the buyer's screen updates! They can inspect the courier details. They have an inspection window. 
> Notice this secondary button: **'Report a problem'**. If the courier cancels or delivers the wrong item, the buyer can submit proof and initiate a dispute right here.
> 
> But everything arrived perfectly. The buyer clicks **Confirm Receipt**.
> 
> Boom! The smart contract settles instantly on MST Mainnet. The payment goes to the Sharer, security deposits are automatically returned to both parties, and both wallets have their **ReputationSBT** trust scores updated on-chain!"**

---

### Segment 5: The Grand Finale — Landing Page & Vision (3:00 - 3:30)
*(Full Screen: Switch back to the stunning Landing Page at `saker-app.vercel.app`)*

> **"And finally, wrapping it all together is the SAKAR interface — a world-class, ultra-minimalist landing experience designed for maximum conversion and accessibility.**
> 
> **From live interactive deal previews and on-chain metrics, to instant guest exploration and one-click BridgeKey integration, SAKAR turns billions of dollars in expiring card perks into an active, liquid, trustless economy.**
> 
> **Real problems, real users, audited smart contracts, and live on MST Mainnet today. Thank you!"**

---

## 🛠️ Part 3: Video Recording & Google Drive Sharing Checklist

### 1. Recording the Video
* **Tool:** Use **OBS Studio** (Free, open-source) or **Loom** / **Clipchamp** (Built into Windows).
* **Display Resolution:** Record at 1080p (1920x1080) for razor-sharp text on the smart contract addresses and UI.
* **Microphone:** Use a headset or dedicated mic; speak with calm confidence, enthusiasm, and energy.

### 2. Setting Up Google Drive Shareable Link (Step-by-Step)
1. Upload your exported `.mp4` video to Google Drive.
2. Right-click the uploaded video file and select **Share** → **Share**.
3. Under **General access**, change from **"Restricted"** to **"Anyone with the link"**.
4. Set the role to **"Viewer"**.
5. Click **Copy link**.
6. **Test in Incognito:** Open a fresh Incognito window, paste the copied link, and verify that the video plays immediately without prompting you to log in!

