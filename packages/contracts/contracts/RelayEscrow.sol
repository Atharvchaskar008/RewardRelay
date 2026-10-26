// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
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
abstract contract RelayEscrow is IRelayEscrow, AccessControl, ReentrancyGuard, Pausable {
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
    constructor(IReputationSBT sbt_, address treasury_, address verifier, address admin) {
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
    // Views
    // ------------------------------------------------------------------------------------------------

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
