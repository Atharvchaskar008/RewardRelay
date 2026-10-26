// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IRelayEscrow: RewardRelay deal escrow
/// @notice Holds a Seeker's MSTC and both parties' deposits for one deal, and settles it by a fixed state
/// machine: delivery deadline, release time, disputes with an arbiter deadline, and timeout refunds.
/// Each deal snapshots its category policy, fee and arbiter timeout, so admin changes never affect it.
/// @dev Deal types: Buy-for-you (the sharer orders for the seeker and submits a proof hash) and Pass-on
/// (a shareable code sealed off-chain, authorised by an EIP-712 `ListingAuth` from VERIFIER_ROLE).
/// Payouts are pushed with a gas stipend and fall back to {withdraw}. See SPEC.md for the full tables.
interface IRelayEscrow {
    // ------------------------------------------------------------------------------------------------
    // Types
    // ------------------------------------------------------------------------------------------------

    /// @notice How the benefit reaches the seeker.
    enum DealType {
        BuyForYou,
        PassOn
    }

    /// @notice Deal lifecycle. Completed, Refunded, Resolved and Cancelled are terminal.
    enum Status {
        Listed,
        Locked,
        Delivered,
        Completed,
        Refunded,
        Disputed,
        Resolved,
        Cancelled
    }

    /// @notice Party at fault in an arbiter ruling.
    enum Party {
        None,
        Sharer,
        Seeker
    }

    /// @notice The primary action available to an account on a deal (drives the UI's single button).
    enum NextAction {
        None,
        Wait,
        Accept,
        Cancel,
        MarkDelivered,
        ConfirmOrDispute,
        Release,
        ClaimRefund,
        AddEvidence,
        Resolve,
        DefaultResolve
    }

    /// @notice Rules of a category, set by POLICY_ADMIN_ROLE and copied into every new deal.
    /// @param dealType Buy-for-you or Pass-on.
    /// @param deliveryWindow Seconds the sharer has to deliver after lock (Buy-for-you; 0 for Pass-on).
    /// @param releaseDelay Seconds after delivery before anyone may release (test/return window).
    /// @param eventBuffer Seconds after the deal's event time before release (0 if no event).
    /// @param disputeWindow Seconds after a dispute opens during which evidence is accepted.
    /// @param active Whether new listings may use the category.
    struct Policy {
        DealType dealType;
        uint32 deliveryWindow;
        uint32 releaseDelay;
        uint32 eventBuffer;
        uint32 disputeWindow;
        bool active;
    }

    /// @notice One listing and, once accepted, one deal. Packed into 8 storage slots.
    struct Deal {
        // slot 0
        address sharer;
        Status status;
        uint8 category;
        uint16 feeBps; // snapshot at creation
        uint64 disputeOpenedAt;
        // slot 1
        address seeker;
        uint64 deliverBy;
        uint32 arbiterTimeout; // snapshot at creation
        // slot 2
        uint128 price;
        uint128 sharerDeposit;
        // slot 3
        uint128 seekerDeposit; // fixed at creation
        uint64 releaseAt;
        uint64 eventTime;
        // slot 4
        Policy policy; // snapshot at creation
        // slots 5-7
        bytes32 termsHash;
        bytes32 codeFingerprint;
        bytes32 proofHash;
    }

    /// @notice Server authorisation of a Pass-on code: EIP-712
    /// `ListingAuth(address sharer,bytes32 fingerprint,uint256 nonce,uint256 deadline)` signed by an
    /// address holding VERIFIER_ROLE, in the domain `("RewardRelay", "1", chainId, escrow)`.
    struct ListingAuthorization {
        uint256 nonce;
        uint256 deadline;
        bytes signature;
    }

    // ------------------------------------------------------------------------------------------------
    // Events
    // ------------------------------------------------------------------------------------------------

    /// @notice A sharer listed a deal and locked their deposit.
    event ListingCreated(
        uint256 indexed id,
        address indexed sharer,
        uint8 indexed category,
        DealType dealType,
        uint256 price,
        uint256 sharerDeposit,
        uint256 seekerDeposit,
        uint64 eventTime,
        bytes32 termsHash,
        bytes32 codeFingerprint
    );

    /// @notice The sharer cancelled an unaccepted listing; the deposit was returned.
    event ListingCancelled(uint256 indexed id, address indexed sharer);

    /// @notice A seeker paid price + deposit. `deliverBy` is 0 for Pass-on (delivered at once).
    event DealLocked(uint256 indexed id, address indexed seeker, uint256 amount, uint64 deliverBy);

    /// @notice The deal counts as delivered; anyone may release it from `releaseAt`.
    /// @param proofHash keccak256 commitment to the order proof (0 for Pass-on).
    event Delivered(uint256 indexed id, bytes32 proofHash, uint64 releaseAt);

    /// @notice The deal completed and was paid out.
    /// @param confirmedBySeeker True for an early seeker confirmation, false for a timed release.
    event Completed(
        uint256 indexed id,
        address indexed sharer,
        address indexed seeker,
        uint256 sharerPayout,
        uint256 seekerPayout,
        uint256 fee,
        bool confirmedBySeeker
    );

    /// @notice The sharer missed the delivery deadline; the seeker received everything held.
    event Refunded(uint256 indexed id, address indexed seeker, uint256 amount);

    /// @notice The seeker disputed a delivered deal; funds are frozen until a ruling.
    event DisputeRaised(uint256 indexed id, address indexed seeker, bytes32 evidenceHash);

    /// @notice A party committed to more off-chain evidence.
    event EvidenceAdded(uint256 indexed id, address indexed party, bytes32 evidenceHash);

    /// @notice A dispute was settled. `arbiter` is the zero address for the default ruling.
    event DisputeResolved(
        uint256 indexed id,
        address indexed arbiter,
        uint16 seekerShareBps,
        Party faultParty,
        uint256 sharerPayout,
        uint256 seekerPayout,
        uint256 fee
    );

    /// @notice A pushed payout failed and was credited to `withdrawable[to]`.
    event PayoutDeferred(uint256 indexed id, address indexed to, uint256 amount);

    /// @notice `to` withdrew its deferred payouts.
    event Withdrawn(address indexed to, uint256 amount);

    /// @notice The policy of `category` changed (affects new listings only).
    event PolicySet(uint8 indexed category, Policy policy);

    /// @notice The protocol fee changed (affects new listings only).
    event FeeBpsSet(uint16 feeBps);

    /// @notice Deposit rates changed (affect new listings only).
    event DepositBpsSet(uint16[3] sharerBpsByTier, uint16 seekerBps);

    /// @notice The arbiter deadline changed (affects new listings only).
    event ArbiterTimeoutSet(uint32 timeout);

    /// @notice The fee receiver changed.
    event TreasurySet(address indexed treasury);

    // ------------------------------------------------------------------------------------------------
    // Errors
    // ------------------------------------------------------------------------------------------------

    error DealNotFound(uint256 id);
    error InvalidStatus(uint256 id, Status status);
    error NotSharer(uint256 id, address caller);
    error NotSeeker(uint256 id, address caller);
    error NotParty(uint256 id, address caller);
    error SharerCannotAccept(uint256 id);
    error ArbiterIsParty(uint256 id);
    error PolicyInactive(uint8 category);
    error InvalidPolicy(uint8 category);
    error NoTrustBadge(address account);
    error DealValueAboveLimit(address account, uint256 price, uint256 limit);
    error IncorrectPayment(uint256 expected, uint256 received);
    error InvalidPrice();
    error TermsRequired();
    error InvalidEventTime(uint64 eventTime);
    error EventPassed(uint256 id, uint64 eventTime);
    error FingerprintRequired();
    error FingerprintNotAllowed();
    error FingerprintAlreadyUsed(bytes32 fingerprint);
    error AuthorizationExpired(uint256 deadline);
    error InvalidAuthorization();
    error DeliveryWindowClosed(uint256 id, uint64 deliverBy);
    error DeliveryWindowOpen(uint256 id, uint64 deliverBy);
    error ProofRequired();
    error ReleaseNotDue(uint256 id, uint64 releaseAt);
    error DisputeWindowClosed(uint256 id, uint64 releaseAt);
    error EvidenceRequired();
    error EvidenceWindowClosed(uint256 id, uint64 closedAt);
    error ArbiterTimeoutNotReached(uint256 id, uint64 availableAt);
    error InvalidShareBps(uint16 bps);
    error NothingToWithdraw();
    error TransferFailed(address to, uint256 amount);
    error FeeTooHigh(uint16 bps);
    error DepositBpsTooHigh(uint16 bps);
    error ArbiterTimeoutOutOfBounds(uint32 timeout);
    error ZeroAddress();
    error DirectPaymentRejected();

    // ------------------------------------------------------------------------------------------------
    // Deal lifecycle
    // ------------------------------------------------------------------------------------------------

    /// @notice Lists a deal in `category` and locks the sharer's deposit (`msg.value`).
    /// @dev Requires: not paused; active policy; a Trust Badge; `0 < price <= maxDealValue(sharer)`;
    /// `termsHash != 0`; `eventTime` is 0 or within the next 365 days; `msg.value ==
    /// requiredSharerDeposit(sharer, price)`. Buy-for-you requires `codeFingerprint == 0` (auth ignored).
    /// Pass-on requires an unused fingerprint and a valid, unexpired {ListingAuthorization} for the
    /// sharer's current nonce; the nonce is consumed and the fingerprint marked used.
    /// @param category Category id; its policy decides the deal type and windows.
    /// @param price Wei the seeker will pay.
    /// @param eventTime Journey/show time (0 if none); release waits until `eventTime + eventBuffer`.
    /// @param termsHash keccak256 of the canonical listing terms (anti bait-and-switch).
    /// @param codeFingerprint HMAC fingerprint of the Pass-on code (0 for Buy-for-you).
    /// @param auth EIP-712 server authorisation (Pass-on only).
    /// @return id The new deal id (ids start at 1).
    function createListing(
        uint8 category,
        uint256 price,
        uint64 eventTime,
        bytes32 termsHash,
        bytes32 codeFingerprint,
        ListingAuthorization calldata auth
    ) external payable returns (uint256 id);

    /// @notice Cancels an unaccepted listing and returns the sharer's deposit.
    /// @dev Sharer only, `Listed` only. Works while paused. Frees a Pass-on fingerprint.
    function cancelListing(uint256 id) external;

    /// @notice Pays `price + seekerDeposit` into escrow and joins the deal as its seeker.
    /// @dev Requires: not paused; `Listed`; caller is not the sharer, holds a badge and
    /// `price <= maxDealValue(caller)`; the event (if any) has not started. Buy-for-you → `Locked` with
    /// `deliverBy = now + deliveryWindow`. Pass-on → `Delivered` with `releaseAt` set (code is vaulted).
    function acceptListing(uint256 id) external payable;

    /// @notice Sharer commits to the order proof; the deal becomes `Delivered`.
    /// @dev Sharer only, `Locked`, `now <= deliverBy`, `proofHash != 0`.
    /// `releaseAt = max(now + releaseDelay, eventTime + eventBuffer)`.
    /// @param proofHash keccak256(abi.encode(dealId, orderId, salt)) computed by the backend.
    function markDelivered(uint256 id, bytes32 proofHash) external;

    /// @notice Seeker confirms receipt early (giving up the rest of the return window) and the deal
    /// completes. Also allowed while `Disputed` to concede the dispute.
    /// @dev Seeker only; `Delivered` or `Disputed`.
    function confirmReceipt(uint256 id) external;

    /// @notice Completes a delivered deal once its release time has passed.
    /// @dev Anyone (keepers, cron, either party); `Delivered` and `now >= releaseAt`.
    function release(uint256 id) external;

    /// @notice Refunds the seeker when the sharer missed the delivery deadline.
    /// @dev Anyone; `Locked` and `now > deliverBy`. The seeker receives price + both deposits and a fault
    /// is recorded against the sharer.
    function claimTimeout(uint256 id) external;

    /// @notice Seeker disputes a delivered deal before its release time; funds freeze.
    /// @dev Seeker only; `Delivered`, `now < releaseAt`, `evidenceHash != 0`.
    /// @param evidenceHash keccak256 of the off-chain evidence bundle.
    function raiseDispute(uint256 id, bytes32 evidenceHash) external;

    /// @notice Either party commits to more evidence while the evidence window is open.
    /// @dev Sharer or seeker; `Disputed`, `now <= disputeOpenedAt + policy.disputeWindow`. Event only.
    function addEvidence(uint256 id, bytes32 evidenceHash) external;

    /// @notice Arbiter ruling: the seeker gets `seekerShareBps` of the price, the sharer the rest minus
    /// the fee; the at-fault party's deposit goes to the other party (no fault: both returned).
    /// @dev ARBITER_ROLE only, `Disputed`, the arbiter is not a party, `seekerShareBps <= 10000`.
    /// Records a fault against the at-fault party.
    function resolveDispute(uint256 id, uint16 seekerShareBps, Party faultParty) external;

    /// @notice Default ruling when the arbiter missed its deadline: 50/50 price split, deposits
    /// returned, no fault, no fee.
    /// @dev Anyone; `Disputed` and `now >= disputeOpenedAt + arbiterTimeout`. Works while paused.
    function defaultResolve(uint256 id) external;

    /// @notice Withdraws payouts that could not be pushed to the caller.
    /// @dev Works while paused. Reverts with {NothingToWithdraw} on a zero balance.
    function withdraw() external;

    // ------------------------------------------------------------------------------------------------
    // Administration
    // ------------------------------------------------------------------------------------------------

    /// @notice Sets the policy of `category` (new listings only).
    /// @dev POLICY_ADMIN_ROLE. Bounds: Buy-for-you delivery window 1 min to 30 days (Pass-on: 0); release
    /// delay 1 min to 90 days; event buffer up to 30 days; dispute window 1 min to 30 days.
    function setPolicy(uint8 category, Policy calldata policy) external;

    /// @notice Sets the protocol fee in basis points (new listings only). POLICY_ADMIN_ROLE, `<= 500`.
    function setFeeBps(uint16 newFeeBps) external;

    /// @notice Sets the sharer deposit by tier and the seeker deposit, in basis points of the price
    /// (new listings only). POLICY_ADMIN_ROLE, each `<= 10000`.
    function setDepositBps(uint16[3] calldata sharerBpsByTier, uint16 seekerBps) external;

    /// @notice Sets the arbiter deadline in seconds (new listings only). POLICY_ADMIN_ROLE,
    /// 1 minute to 30 days.
    function setArbiterTimeout(uint32 timeout) external;

    /// @notice Sets the fee receiver. DEFAULT_ADMIN_ROLE, non-zero.
    function setTreasury(address newTreasury) external;

    /// @notice Blocks new commitments (createListing, acceptListing). PAUSER_ROLE.
    function pause() external;

    /// @notice Lifts the pause. PAUSER_ROLE.
    function unpause() external;

    // ------------------------------------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------------------------------------

    /// @notice The deal stored under `id`. Reverts with {DealNotFound} for unknown ids.
    function getDeal(uint256 id) external view returns (Deal memory);

    /// @notice The current policy of `category`.
    function getPolicy(uint8 category) external view returns (Policy memory);

    /// @notice The primary action `account` can take on deal `id` right now.
    function nextActionFor(uint256 id, address account) external view returns (NextAction);

    /// @notice `balance - (totalEscrowed + totalWithdrawable)`; 0 in every protocol-controlled state,
    /// positive only if ether was forced into the contract.
    function solvencyDelta() external view returns (int256);

    /// @notice Sharer deposit for a listing of `price` by `sharer` at the sharer's current tier.
    function requiredSharerDeposit(address sharer, uint256 price) external view returns (uint256);

    /// @notice Seeker deposit for a new listing of `price` at the current rate.
    function requiredSeekerDeposit(uint256 price) external view returns (uint256);

    /// @notice Number of deals created so far (also the latest id).
    function dealCount() external view returns (uint256);

    /// @notice Whether a Pass-on fingerprint is attached to a live or settled deal.
    function usedFingerprint(bytes32 fingerprint) external view returns (bool);

    /// @notice Deferred payouts claimable by `account`.
    function withdrawable(address account) external view returns (uint256);

    /// @notice Wei held for open deals.
    function totalEscrowed() external view returns (uint256);

    /// @notice Wei owed through {withdraw}.
    function totalWithdrawable() external view returns (uint256);

    /// @notice Current protocol fee in basis points.
    function feeBps() external view returns (uint16);

    /// @notice Current sharer deposit rate of `tier` in basis points.
    function sharerDepositBps(uint8 tier) external view returns (uint16);

    /// @notice Current seeker deposit rate in basis points.
    function seekerDepositBps() external view returns (uint16);

    /// @notice Current arbiter deadline in seconds.
    function arbiterTimeout() external view returns (uint32);

    /// @notice Current fee receiver.
    function treasury() external view returns (address);

    /// @notice The Trust Badge contract used for limits, deposits and outcomes.
    function sbt() external view returns (address);

    /// @notice Next ListingAuth nonce of `sharer`.
    function nonces(address sharer) external view returns (uint256);

    /// @notice keccak256("ListingAuth(address sharer,bytes32 fingerprint,uint256 nonce,uint256 deadline)").
    // solhint-disable-next-line func-name-mixedcase
    function LISTING_AUTH_TYPEHASH() external view returns (bytes32);

    /// @notice The EIP-712 domain separator of this escrow.
    function domainSeparator() external view returns (bytes32);

    /// @notice The EIP-712 digest a verifier signs to authorise a Pass-on listing.
    function hashListingAuth(
        address sharer,
        bytes32 fingerprint,
        uint256 nonce,
        uint256 deadline
    ) external view returns (bytes32);
}
