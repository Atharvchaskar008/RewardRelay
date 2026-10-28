// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Nonces} from "@openzeppelin/contracts/utils/Nonces.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {IRelayEscrow} from "./interfaces/IRelayEscrow.sol";
import {IReputationSBT} from "./interfaces/IReputationSBT.sol";

/// @title RelayEscrow: RewardRelay deal escrow on MST
/// @notice Holds the seeker's MSTC and both deposits of each deal and settles it by the state machine in
/// SPEC.md: delivery deadline, release time, disputes with an arbiter deadline and timeout refunds.
/// @dev Every deal snapshots its category policy, the fee and the arbiter timeout at creation (I6), so
/// admin changes never reach in-flight deals. Uses the classic storage-based ReentrancyGuard because MST
/// mainnet has no transient storage (no Cancun opcodes).
///
/// Solvency (I1): `address(this).balance == totalEscrowed + totalWithdrawable` before and after every
/// external call; `totalEscrowed` is reduced right before each payout is sent.
contract RelayEscrow is IRelayEscrow, AccessControl, ReentrancyGuard, Pausable, EIP712, Nonces {
    // ------------------------------------------------------------------------------------------------
    // Roles and bounds
    // ------------------------------------------------------------------------------------------------

    /// @notice Sets category policies, fee, deposit rates and the arbiter timeout.
    bytes32 public constant POLICY_ADMIN_ROLE = keccak256("POLICY_ADMIN_ROLE");
    /// @notice Rules on disputes.
    bytes32 public constant ARBITER_ROLE = keccak256("ARBITER_ROLE");
    /// @notice Signs EIP-712 ListingAuth authorisations for Pass-on codes (off-chain).
    bytes32 public constant VERIFIER_ROLE = keccak256("VERIFIER_ROLE");
    /// @notice Pauses and unpauses new commitments.
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    /// @inheritdoc IRelayEscrow
    bytes32 public constant LISTING_AUTH_TYPEHASH = keccak256(
        "ListingAuth(address sharer,bytes32 fingerprint,uint256 nonce,uint256 deadline)"
    );

    /// @notice Highest protocol fee: 5%.
    uint16 public constant MAX_FEE_BPS = 500;
    /// @notice Shortest window of any kind (delivery, release, dispute, arbiter).
    uint32 public constant MIN_WINDOW = 1 minutes;
    uint32 public constant MAX_DELIVERY_WINDOW = 30 days;
    uint32 public constant MAX_RELEASE_DELAY = 90 days;
    uint32 public constant MAX_EVENT_BUFFER = 30 days;
    uint32 public constant MAX_DISPUTE_WINDOW = 30 days;
    uint32 public constant MAX_ARBITER_TIMEOUT = 30 days;
    /// @notice Furthest event time a listing may name.
    uint64 public constant MAX_EVENT_HORIZON = 365 days;

    /// @notice Gas forwarded with each pushed payout. Enough for a wallet's receive hook, too little to
    /// re-enter anything useful; a receiver that needs more is paid through {withdraw}.
    uint256 public constant PAYOUT_GAS_STIPEND = 30_000;

    uint16 internal constant BPS = 10_000;
    uint16 private constant DEFAULT_FEE_BPS = 200;
    uint16 private constant DEFAULT_SEEKER_DEPOSIT_BPS = 500;
    uint32 private constant DEFAULT_ARBITER_TIMEOUT = 72 hours;

    // ------------------------------------------------------------------------------------------------
    // Storage
    // ------------------------------------------------------------------------------------------------

    IReputationSBT internal immutable SBT;

    mapping(uint256 id => Deal) internal _deals;
    mapping(uint8 category => Policy) internal _policies;
    mapping(bytes32 fingerprint => bool) internal _usedFingerprints;
    mapping(address account => uint256) internal _withdrawable;

    uint256 internal _dealCount;
    uint256 internal _totalEscrowed;
    uint256 internal _totalWithdrawable;

    // One slot: treasury (20) + fee (2) + seeker deposit (2) + arbiter timeout (4).
    address internal _treasury;
    uint16 internal _feeBps;
    uint16 internal _seekerDepositBps;
    uint32 internal _arbiterTimeout;
    // One slot: sharer deposit by tier.
    uint16[3] internal _sharerDepositBps;

    /// @param sbt_ The Trust Badge contract (immutable).
    /// @param treasury_ Fee receiver.
    /// @param verifier Server signer for Pass-on authorisations (VERIFIER_ROLE).
    /// @param admin Receives DEFAULT_ADMIN_ROLE, POLICY_ADMIN_ROLE and PAUSER_ROLE.
    constructor(
        IReputationSBT sbt_,
        address treasury_,
        address verifier,
        address admin
    ) EIP712("RewardRelay", "1") {
        if (
            address(sbt_) == address(0) ||
            treasury_ == address(0) ||
            verifier == address(0) ||
            admin == address(0)
        ) revert ZeroAddress();

        SBT = sbt_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(POLICY_ADMIN_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
        _grantRole(VERIFIER_ROLE, verifier);

        _treasury = treasury_;
        _feeBps = DEFAULT_FEE_BPS;
        _seekerDepositBps = DEFAULT_SEEKER_DEPOSIT_BPS;
        _arbiterTimeout = DEFAULT_ARBITER_TIMEOUT;
        _sharerDepositBps = [5_000, 3_000, 2_000];

        emit TreasurySet(treasury_);
        emit FeeBpsSet(DEFAULT_FEE_BPS);
        emit DepositBpsSet(_sharerDepositBps, DEFAULT_SEEKER_DEPOSIT_BPS);
        emit ArbiterTimeoutSet(DEFAULT_ARBITER_TIMEOUT);
    }

    // ------------------------------------------------------------------------------------------------
    // Listings
    // ------------------------------------------------------------------------------------------------

    /// @inheritdoc IRelayEscrow
    function createListing(
        uint8 category,
        uint256 price,
        uint64 eventTime,
        bytes32 termsHash,
        bytes32 codeFingerprint,
        ListingAuthorization calldata auth
    ) external payable nonReentrant whenNotPaused returns (uint256 id) {
        Policy memory policy = _policies[category];
        if (!policy.active) revert PolicyInactive(category);
        if (price == 0 || price > type(uint128).max) revert InvalidPrice();
        if (termsHash == bytes32(0)) revert TermsRequired();
        if (
            eventTime != 0 &&
            (eventTime <= block.timestamp || eventTime > block.timestamp + MAX_EVENT_HORIZON)
        ) revert InvalidEventTime(eventTime);

        uint8 tier = _requireTrust(msg.sender, price);
        uint256 sharerDeposit = _bps(price, _sharerDepositBps[tier]);
        if (msg.value != sharerDeposit) revert IncorrectPayment(sharerDeposit, msg.value);

        if (policy.dealType == DealType.PassOn) {
            _consumeListingAuth(msg.sender, codeFingerprint, auth);
        } else if (codeFingerprint != bytes32(0)) {
            revert FingerprintNotAllowed();
        }

        unchecked {
            id = ++_dealCount; // cannot overflow: one id per transaction
        }
        Deal storage deal = _deals[id];
        deal.sharer = msg.sender;
        deal.status = Status.Listed;
        deal.category = category;
        deal.feeBps = _feeBps;
        deal.arbiterTimeout = _arbiterTimeout;
        deal.price = uint128(price);
        deal.sharerDeposit = uint128(sharerDeposit);
        deal.seekerDeposit = uint128(_bps(price, _seekerDepositBps));
        deal.eventTime = eventTime;
        deal.policy = policy;
        deal.termsHash = termsHash;
        deal.codeFingerprint = codeFingerprint;

        _totalEscrowed += msg.value;
        _emitListingCreated(id, deal);
    }

    /// @inheritdoc IRelayEscrow
    function cancelListing(uint256 id) external nonReentrant {
        Deal storage deal = _dealIn(id, Status.Listed);
        if (msg.sender != deal.sharer) revert NotSharer(id, msg.sender);

        deal.status = Status.Cancelled;
        // Nothing was sold and the authorisation nonce is spent, so the code may be listed again.
        if (deal.codeFingerprint != bytes32(0)) _usedFingerprints[deal.codeFingerprint] = false;

        emit ListingCancelled(id, msg.sender);
        _payout(id, msg.sender, deal.sharerDeposit);
    }

    // ------------------------------------------------------------------------------------------------
    // Deal lifecycle
    // ------------------------------------------------------------------------------------------------

    /// @inheritdoc IRelayEscrow
    function acceptListing(uint256 id) external payable nonReentrant whenNotPaused {
        Deal storage deal = _dealIn(id, Status.Listed);
        if (msg.sender == deal.sharer) revert SharerCannotAccept(id);
        _requireTrust(msg.sender, deal.price);
        uint64 eventTime = deal.eventTime;
        if (eventTime != 0 && block.timestamp >= eventTime) revert EventPassed(id, eventTime);
        uint256 expected = uint256(deal.price) + deal.seekerDeposit;
        if (msg.value != expected) revert IncorrectPayment(expected, msg.value);

        deal.seeker = msg.sender;
        _totalEscrowed += msg.value;

        if (deal.policy.dealType == DealType.BuyForYou) {
            uint64 deliverBy = uint64(block.timestamp) + deal.policy.deliveryWindow;
            deal.status = Status.Locked;
            deal.deliverBy = deliverBy;
            emit DealLocked(id, msg.sender, msg.value, deliverBy);
        } else {
            // Pass-on: the code is already sealed in the vault, so the deal counts as delivered.
            uint64 releaseAt = _releaseTime(deal);
            deal.status = Status.Delivered;
            deal.releaseAt = releaseAt;
            emit DealLocked(id, msg.sender, msg.value, 0);
            emit Delivered(id, bytes32(0), releaseAt);
        }
    }

    /// @inheritdoc IRelayEscrow
    function markDelivered(uint256 id, bytes32 proofHash) external {
        Deal storage deal = _dealIn(id, Status.Locked);
        if (msg.sender != deal.sharer) revert NotSharer(id, msg.sender);
        if (block.timestamp > deal.deliverBy) revert DeliveryWindowClosed(id, deal.deliverBy);
        if (proofHash == bytes32(0)) revert ProofRequired();

        uint64 releaseAt = _releaseTime(deal);
        deal.status = Status.Delivered;
        deal.proofHash = proofHash;
        deal.releaseAt = releaseAt;
        emit Delivered(id, proofHash, releaseAt);
    }

    /// @inheritdoc IRelayEscrow
    function confirmReceipt(uint256 id) external nonReentrant {
        Deal storage deal = _existingDeal(id);
        Status status = deal.status;
        // Delivered: early confirmation (T7). Disputed: the seeker concedes the dispute (T11).
        if (status != Status.Delivered && status != Status.Disputed)
            revert InvalidStatus(id, status);
        if (msg.sender != deal.seeker) revert NotSeeker(id, msg.sender);
        _complete(id, deal, true);
    }

    /// @inheritdoc IRelayEscrow
    function release(uint256 id) external nonReentrant {
        Deal storage deal = _dealIn(id, Status.Delivered);
        if (block.timestamp < deal.releaseAt) revert ReleaseNotDue(id, deal.releaseAt);
        _complete(id, deal, false);
    }

    /// @inheritdoc IRelayEscrow
    function claimTimeout(uint256 id) external nonReentrant {
        Deal storage deal = _dealIn(id, Status.Locked);
        if (block.timestamp <= deal.deliverBy) revert DeliveryWindowOpen(id, deal.deliverBy);

        // Refunded (T6): the seeker gets the price, its own deposit and the sharer's deposit.
        deal.status = Status.Refunded;
        address seeker = deal.seeker;
        uint256 amount = uint256(deal.price) + deal.seekerDeposit + deal.sharerDeposit;

        emit Refunded(id, seeker, amount);
        SBT.recordFault(deal.sharer);
        _payout(id, seeker, amount);
    }

    // ------------------------------------------------------------------------------------------------
    // Disputes
    // ------------------------------------------------------------------------------------------------

    /// @inheritdoc IRelayEscrow
    function raiseDispute(uint256 id, bytes32 evidenceHash) external {
        Deal storage deal = _dealIn(id, Status.Delivered);
        if (msg.sender != deal.seeker) revert NotSeeker(id, msg.sender);
        if (block.timestamp >= deal.releaseAt) revert DisputeWindowClosed(id, deal.releaseAt);
        if (evidenceHash == bytes32(0)) revert EvidenceRequired();

        deal.status = Status.Disputed;
        deal.disputeOpenedAt = uint64(block.timestamp);
        emit DisputeRaised(id, msg.sender, evidenceHash);
    }

    /// @inheritdoc IRelayEscrow
    function addEvidence(uint256 id, bytes32 evidenceHash) external {
        Deal storage deal = _dealIn(id, Status.Disputed);
        if (msg.sender != deal.sharer && msg.sender != deal.seeker) revert NotParty(id, msg.sender);
        uint64 closesAt = deal.disputeOpenedAt + deal.policy.disputeWindow;
        if (block.timestamp > closesAt) revert EvidenceWindowClosed(id, closesAt);
        if (evidenceHash == bytes32(0)) revert EvidenceRequired();

        emit EvidenceAdded(id, msg.sender, evidenceHash);
    }

    /// @inheritdoc IRelayEscrow
    function resolveDispute(
        uint256 id,
        uint16 seekerShareBps,
        Party faultParty
    ) external nonReentrant onlyRole(ARBITER_ROLE) {
        Deal storage deal = _dealIn(id, Status.Disputed);
        if (msg.sender == deal.sharer || msg.sender == deal.seeker) revert ArbiterIsParty(id);
        if (seekerShareBps > BPS) revert InvalidShareBps(seekerShareBps);
        _settleDispute(id, deal, seekerShareBps, faultParty, msg.sender);
    }

    /// @inheritdoc IRelayEscrow
    function defaultResolve(uint256 id) external nonReentrant {
        Deal storage deal = _dealIn(id, Status.Disputed);
        uint64 availableAt = deal.disputeOpenedAt + deal.arbiterTimeout;
        if (block.timestamp < availableAt) revert ArbiterTimeoutNotReached(id, availableAt);
        _settleDispute(id, deal, BPS / 2, Party.None, address(0));
    }

    // ------------------------------------------------------------------------------------------------
    // Payouts
    // ------------------------------------------------------------------------------------------------

    /// @inheritdoc IRelayEscrow
    function withdraw() external nonReentrant {
        uint256 amount = _withdrawable[msg.sender];
        if (amount == 0) revert NothingToWithdraw();

        _withdrawable[msg.sender] = 0;
        _totalWithdrawable -= amount;
        emit Withdrawn(msg.sender, amount);

        // All gas is forwarded: the balance is already zeroed and the call is the last step.
        (bool sent, ) = msg.sender.call{value: amount}("");
        if (!sent) revert TransferFailed(msg.sender, amount);
    }

    // ------------------------------------------------------------------------------------------------
    // Policy registry
    // ------------------------------------------------------------------------------------------------

    /// @inheritdoc IRelayEscrow
    function setPolicy(
        uint8 category,
        Policy calldata policy
    ) external onlyRole(POLICY_ADMIN_ROLE) {
        if (!_isValidPolicy(policy)) revert InvalidPolicy(category);
        _policies[category] = policy;
        emit PolicySet(category, policy);
    }

    // ------------------------------------------------------------------------------------------------
    // Administration
    // ------------------------------------------------------------------------------------------------

    /// @inheritdoc IRelayEscrow
    function setFeeBps(uint16 newFeeBps) external onlyRole(POLICY_ADMIN_ROLE) {
        if (newFeeBps > MAX_FEE_BPS) revert FeeTooHigh(newFeeBps);
        _feeBps = newFeeBps;
        emit FeeBpsSet(newFeeBps);
    }

    /// @inheritdoc IRelayEscrow
    function setDepositBps(
        uint16[3] calldata sharerBpsByTier,
        uint16 seekerBps
    ) external onlyRole(POLICY_ADMIN_ROLE) {
        for (uint256 tier; tier < 3; ++tier) {
            if (sharerBpsByTier[tier] > BPS) revert DepositBpsTooHigh(sharerBpsByTier[tier]);
        }
        if (seekerBps > BPS) revert DepositBpsTooHigh(seekerBps);
        _sharerDepositBps = sharerBpsByTier;
        _seekerDepositBps = seekerBps;
        emit DepositBpsSet(sharerBpsByTier, seekerBps);
    }

    /// @inheritdoc IRelayEscrow
    function setArbiterTimeout(uint32 timeout) external onlyRole(POLICY_ADMIN_ROLE) {
        if (timeout < MIN_WINDOW || timeout > MAX_ARBITER_TIMEOUT) {
            revert ArbiterTimeoutOutOfBounds(timeout);
        }
        _arbiterTimeout = timeout;
        emit ArbiterTimeoutSet(timeout);
    }

    /// @inheritdoc IRelayEscrow
    function setTreasury(address newTreasury) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newTreasury == address(0)) revert ZeroAddress();
        _treasury = newTreasury;
        emit TreasurySet(newTreasury);
    }

    /// @inheritdoc IRelayEscrow
    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    /// @inheritdoc IRelayEscrow
    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    /// @notice Plain MSTC transfers are rejected: value enters only through listings and accepts.
    receive() external payable {
        revert DirectPaymentRejected();
    }

    /// @notice Unknown calls are rejected.
    fallback() external payable {
        revert DirectPaymentRejected();
    }

    // ------------------------------------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------------------------------------

    /// @inheritdoc IRelayEscrow
    function nextActionFor(uint256 id, address account) external view returns (NextAction) {
        Deal storage deal = _existingDeal(id);
        Status status = deal.status;
        bool isSharer = account == deal.sharer;
        bool isSeeker = account != address(0) && account == deal.seeker;

        if (status == Status.Listed) {
            if (isSharer) return NextAction.Cancel;
            return _canAccept(account, deal) ? NextAction.Accept : NextAction.None;
        }
        if (status == Status.Locked) {
            if (block.timestamp > deal.deliverBy) {
                return isSharer ? NextAction.None : NextAction.ClaimRefund;
            }
            if (isSharer) return NextAction.MarkDelivered;
            return isSeeker ? NextAction.Wait : NextAction.None;
        }
        if (status == Status.Delivered) {
            if (block.timestamp >= deal.releaseAt) return NextAction.Release;
            if (isSeeker) return NextAction.ConfirmOrDispute;
            return isSharer ? NextAction.Wait : NextAction.None;
        }
        if (status == Status.Disputed) {
            bool isParty = isSharer || isSeeker;
            if (!isParty && hasRole(ARBITER_ROLE, account)) return NextAction.Resolve;
            if (block.timestamp >= uint256(deal.disputeOpenedAt) + deal.arbiterTimeout) {
                return NextAction.DefaultResolve;
            }
            if (!isParty) return NextAction.None;
            return
                block.timestamp <= uint256(deal.disputeOpenedAt) + deal.policy.disputeWindow
                    ? NextAction.AddEvidence
                    : NextAction.Wait;
        }
        return NextAction.None; // terminal
    }

    /// @inheritdoc IRelayEscrow
    function solvencyDelta() external view returns (int256) {
        return
            SafeCast.toInt256(address(this).balance) -
            SafeCast.toInt256(_totalEscrowed + _totalWithdrawable);
    }

    /// @inheritdoc IRelayEscrow
    function requiredSharerDeposit(address sharer, uint256 price) external view returns (uint256) {
        return _bps(price, _sharerDepositBps[SBT.tierOf(sharer)]);
    }

    /// @inheritdoc IRelayEscrow
    function requiredSeekerDeposit(uint256 price) external view returns (uint256) {
        return _bps(price, _seekerDepositBps);
    }

    /// @inheritdoc IRelayEscrow
    function nonces(address sharer) public view override(IRelayEscrow, Nonces) returns (uint256) {
        return super.nonces(sharer);
    }

    /// @inheritdoc IRelayEscrow
    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    /// @inheritdoc IRelayEscrow
    function hashListingAuth(
        address sharer,
        bytes32 fingerprint,
        uint256 nonce,
        uint256 deadline
    ) external view returns (bytes32) {
        return _hashListingAuth(sharer, fingerprint, nonce, deadline);
    }

    /// @inheritdoc IRelayEscrow
    function getDeal(uint256 id) external view returns (Deal memory) {
        return _existingDeal(id);
    }

    /// @inheritdoc IRelayEscrow
    function getPolicy(uint8 category) external view returns (Policy memory) {
        return _policies[category];
    }

    /// @inheritdoc IRelayEscrow
    function dealCount() external view returns (uint256) {
        return _dealCount;
    }

    /// @inheritdoc IRelayEscrow
    function usedFingerprint(bytes32 fingerprint) external view returns (bool) {
        return _usedFingerprints[fingerprint];
    }

    /// @inheritdoc IRelayEscrow
    function withdrawable(address account) external view returns (uint256) {
        return _withdrawable[account];
    }

    /// @inheritdoc IRelayEscrow
    function totalEscrowed() external view returns (uint256) {
        return _totalEscrowed;
    }

    /// @inheritdoc IRelayEscrow
    function totalWithdrawable() external view returns (uint256) {
        return _totalWithdrawable;
    }

    /// @inheritdoc IRelayEscrow
    function feeBps() external view returns (uint16) {
        return _feeBps;
    }

    /// @inheritdoc IRelayEscrow
    function sharerDepositBps(uint8 tier) external view returns (uint16) {
        return _sharerDepositBps[tier];
    }

    /// @inheritdoc IRelayEscrow
    function seekerDepositBps() external view returns (uint16) {
        return _seekerDepositBps;
    }

    /// @inheritdoc IRelayEscrow
    function arbiterTimeout() external view returns (uint32) {
        return _arbiterTimeout;
    }

    /// @inheritdoc IRelayEscrow
    function treasury() external view returns (address) {
        return _treasury;
    }

    /// @inheritdoc IRelayEscrow
    function sbt() external view returns (address) {
        return address(SBT);
    }

    /// @notice ERC-165: AccessControl and IRelayEscrow.
    function supportsInterface(bytes4 interfaceId) public view override returns (bool) {
        return
            interfaceId == type(IRelayEscrow).interfaceId || super.supportsInterface(interfaceId);
    }

    // ------------------------------------------------------------------------------------------------
    // Internals
    // ------------------------------------------------------------------------------------------------

    /// @dev Loads a deal or reverts with DealNotFound (a stored deal always has a sharer).
    function _existingDeal(uint256 id) internal view returns (Deal storage deal) {
        deal = _deals[id];
        if (deal.sharer == address(0)) revert DealNotFound(id);
    }

    /// @dev Loads a deal that must be in `expected` status.
    function _dealIn(uint256 id, Status expected) internal view returns (Deal storage deal) {
        deal = _existingDeal(id);
        if (deal.status != expected) revert InvalidStatus(id, deal.status);
    }

    /// @dev Whether `account` could accept the listed `deal` right now.
    function _canAccept(address account, Deal storage deal) internal view returns (bool) {
        if (paused() || (deal.eventTime != 0 && block.timestamp >= deal.eventTime)) return false;
        // Only the badge flag and the limit matter here; the history counters are not needed.
        // slither-disable-next-line unused-return
        (bool badge, , , , , uint256 limit) = SBT.trustOf(account);
        return badge && deal.price <= limit;
    }

    /// @dev Requires a badge and `price <= maxDealValue(account)`; returns the account's tier.
    function _requireTrust(address account, uint256 price) internal view returns (uint8 tier) {
        // slither-disable-next-line unused-return
        (bool badge, uint8 currentTier, , , , uint256 limit) = SBT.trustOf(account);
        if (!badge) revert NoTrustBadge(account);
        if (price > limit) revert DealValueAboveLimit(account, price, limit);
        return currentTier;
    }

    /// @dev Pass-on: unused fingerprint, unexpired deadline, the sharer's current nonce and a signature
    /// by a VERIFIER_ROLE holder over the EIP-712 ListingAuth. Consumes the nonce, marks the fingerprint.
    function _consumeListingAuth(
        address sharer,
        bytes32 fingerprint,
        ListingAuthorization calldata auth
    ) internal {
        if (fingerprint == bytes32(0)) revert FingerprintRequired();
        if (_usedFingerprints[fingerprint]) revert FingerprintAlreadyUsed(fingerprint);
        if (block.timestamp > auth.deadline) revert AuthorizationExpired(auth.deadline);
        _useCheckedNonce(sharer, auth.nonce);

        bytes32 digest = _hashListingAuth(sharer, fingerprint, auth.nonce, auth.deadline);
        // The third value only details a recover error, which is already rejected below.
        // slither-disable-next-line unused-return
        (address signer, ECDSA.RecoverError recoverError, ) = ECDSA.tryRecover(
            digest,
            auth.signature
        );
        if (recoverError != ECDSA.RecoverError.NoError || !hasRole(VERIFIER_ROLE, signer)) {
            revert InvalidAuthorization();
        }
        _usedFingerprints[fingerprint] = true;
    }

    function _hashListingAuth(
        address sharer,
        bytes32 fingerprint,
        uint256 nonce,
        uint256 deadline
    ) internal view returns (bytes32) {
        return
            _hashTypedDataV4(
                keccak256(abi.encode(LISTING_AUTH_TYPEHASH, sharer, fingerprint, nonce, deadline))
            );
    }

    /// @dev Separate function so the 10-field event does not exhaust createListing's stack.
    function _emitListingCreated(uint256 id, Deal storage deal) internal {
        emit ListingCreated(
            id,
            deal.sharer,
            deal.category,
            deal.policy.dealType,
            deal.price,
            deal.sharerDeposit,
            deal.seekerDeposit,
            deal.eventTime,
            deal.termsHash,
            deal.codeFingerprint
        );
    }

    /// @dev `max(now + releaseDelay, eventTime + eventBuffer)`. With no event, `eventTime + eventBuffer`
    /// is at most 30 days after the epoch, so the first term always wins.
    function _releaseTime(Deal storage deal) internal view returns (uint64) {
        uint64 afterDelivery = uint64(block.timestamp) + deal.policy.releaseDelay;
        uint64 afterEvent = deal.eventTime + deal.policy.eventBuffer;
        return afterDelivery > afterEvent ? afterDelivery : afterEvent;
    }

    /// @dev Completed (T7, T8, T11): sharer `P - fee + Ds`, seeker `Dk`, treasury `fee`; both badges
    /// gain a completed deal. Status and amounts are final before any external call.
    function _complete(uint256 id, Deal storage deal, bool confirmedBySeeker) internal {
        deal.status = Status.Completed;
        address sharer = deal.sharer;
        address seeker = deal.seeker;
        uint256 price = deal.price;
        uint256 fee = _bps(price, deal.feeBps);
        uint256 sharerPayout = price - fee + deal.sharerDeposit;
        uint256 seekerPayout = deal.seekerDeposit;

        emit Completed(id, sharer, seeker, sharerPayout, seekerPayout, fee, confirmedBySeeker);
        SBT.recordSuccess(sharer, seeker, price);
        _payout(id, sharer, sharerPayout);
        _payout(id, seeker, seekerPayout);
        _payout(id, _treasury, fee);
    }

    /// @dev Resolved (T12, T13). `arbiter == address(0)` marks the default ruling, which charges no fee.
    function _settleDispute(
        uint256 id,
        Deal storage deal,
        uint16 seekerShareBps,
        Party faultParty,
        address arbiter
    ) internal {
        deal.status = Status.Resolved;
        (uint256 sharerPayout, uint256 seekerPayout, uint256 fee) = _disputePayouts(
            deal,
            seekerShareBps,
            faultParty,
            arbiter != address(0)
        );

        emit DisputeResolved(
            id,
            arbiter,
            seekerShareBps,
            faultParty,
            sharerPayout,
            seekerPayout,
            fee
        );
        if (faultParty == Party.Sharer) SBT.recordFault(deal.sharer);
        else if (faultParty == Party.Seeker) SBT.recordFault(deal.seeker);
        _payout(id, deal.sharer, sharerPayout);
        _payout(id, deal.seeker, seekerPayout);
        _payout(id, _treasury, fee);
    }

    /// @dev Money table of SPEC.md §3: the seeker gets `Pk = P * share / 10000`, the sharer `P - Pk`
    /// minus the fee (charged on the sharer's share only); the at-fault party's deposit goes to the other
    /// party, otherwise both deposits are returned.
    function _disputePayouts(
        Deal storage deal,
        uint16 seekerShareBps,
        Party faultParty,
        bool chargeFee
    ) internal view returns (uint256 sharerPayout, uint256 seekerPayout, uint256 fee) {
        uint256 price = deal.price;
        seekerPayout = _bps(price, seekerShareBps);
        sharerPayout = price - seekerPayout;
        if (chargeFee) {
            fee = _bps(sharerPayout, deal.feeBps);
            sharerPayout -= fee;
        }

        uint256 deposits = uint256(deal.sharerDeposit) + deal.seekerDeposit;
        if (faultParty == Party.Sharer) {
            seekerPayout += deposits;
        } else if (faultParty == Party.Seeker) {
            sharerPayout += deposits;
        } else {
            sharerPayout += deal.sharerDeposit;
            seekerPayout += deal.seekerDeposit;
        }
    }

    /// @dev Push payout with pull fallback. `totalEscrowed` drops before the call, so the solvency
    /// invariant holds while the receiver runs; a failed push (reverting receiver, out of stipend) is
    /// credited to `withdrawable[to]` instead of blocking the settlement. No return data is copied, so a
    /// receiver cannot make the escrow pay for a large revert payload.
    function _payout(uint256 id, address to, uint256 amount) internal {
        if (amount == 0) return;
        _totalEscrowed -= amount;

        bool sent;
        // solhint-disable-next-line no-inline-assembly
        assembly ("memory-safe") {
            sent := call(PAYOUT_GAS_STIPEND, to, amount, 0, 0, 0, 0)
        }
        if (!sent) {
            _withdrawable[to] += amount;
            _totalWithdrawable += amount;
            emit PayoutDeferred(id, to, amount);
        }
    }

    /// @dev Bounds of SPEC.md §6. Pass-on deals are delivered on accept, so they have no delivery window.
    function _isValidPolicy(Policy calldata policy) internal pure returns (bool) {
        bool deliveryOk =
            policy.dealType == DealType.BuyForYou
                ? policy.deliveryWindow >= MIN_WINDOW &&
                    policy.deliveryWindow <= MAX_DELIVERY_WINDOW
                : policy.deliveryWindow == 0;
        return
            deliveryOk &&
            policy.releaseDelay >= MIN_WINDOW &&
            policy.releaseDelay <= MAX_RELEASE_DELAY &&
            policy.eventBuffer <= MAX_EVENT_BUFFER &&
            policy.disputeWindow >= MIN_WINDOW &&
            policy.disputeWindow <= MAX_DISPUTE_WINDOW;
    }

    /// @dev `amount * bps / 10000`, rounded down. `amount` fits in uint128, so the product cannot overflow.
    function _bps(uint256 amount, uint16 bps) internal pure returns (uint256) {
        return (amount * bps) / BPS;
    }
}
