// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {IERC5192} from "./interfaces/IERC5192.sol";
import {IReputationSBT} from "./interfaces/IReputationSBT.sol";

/// @title ReputationSBT: the RewardRelay Trust Badge
/// @notice Soulbound (ERC-5192) ERC-721 badge minted once per phone-verified address. It records the
/// holder's completed deals, lost disputes and distinct counterparties, derives a trust tier from them and
/// exposes the largest deal the holder may join. Any MST application can read it through {trustOf}.
/// @dev Adapted from the create-mst-app `certificate` template: the soulbound `_update` rule is kept,
/// `Ownable` issuers become `VERIFIER_ROLE`, and approvals revert as well as transfers.
/// Badge ids are `uint256(uint160(owner))`: anyone can derive a user's badge from the address alone, and
/// one badge per address follows from token-id uniqueness.
///
/// Invariants: at most one badge per address and badges never move (I9); `completed` only grows through
/// {recordSuccess} and `disputesLost` only through {recordFault}, both restricted to ESCROW_ROLE (I10).
contract ReputationSBT is ERC721, AccessControl, IReputationSBT {
    /// @notice Role allowed to mint badges (the server after phone verification).
    bytes32 public constant VERIFIER_ROLE = keccak256("VERIFIER_ROLE");
    /// @notice Role allowed to record deal outcomes (the RelayEscrow contract).
    bytes32 public constant ESCROW_ROLE = keccak256("ESCROW_ROLE");
    /// @notice Role allowed to tune tier limits, tier rules and the Relay Point unit.
    bytes32 public constant POLICY_ADMIN_ROLE = keccak256("POLICY_ADMIN_ROLE");

    uint8 private constant TRUSTED = 1;
    uint8 private constant VERIFIED = 2;

    mapping(address user => Stats) private _stats;
    mapping(bytes32 pairKey => bool) private _pairSeen;
    uint256[3] private _tierLimits;
    TierRule[3] private _tierRules; // index 0 (New) has no requirements
    uint256 private _relayPointUnit;

    /// @param admin Receives DEFAULT_ADMIN_ROLE and POLICY_ADMIN_ROLE.
    /// @param relayPointUnit_ Wei of completed volume per Relay Point.
    constructor(address admin, uint256 relayPointUnit_) ERC721("RewardRelay Trust Badge", "RRTB") {
        if (admin == address(0)) revert ZeroAddress();
        if (relayPointUnit_ == 0) revert InvalidRelayPointUnit();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(POLICY_ADMIN_ROLE, admin);

        _relayPointUnit = relayPointUnit_;
        emit RelayPointUnitSet(relayPointUnit_);

        // Defaults from the spec (counts, not wei). Tier limits start at 0 until configured.
        _storeTierRule(VERIFIED, TierRule(20, 10, 0));
        _storeTierRule(TRUSTED, TierRule(5, 3, 0));
    }

    // ------------------------------------------------------------------------------------------------
    // Writes
    // ------------------------------------------------------------------------------------------------

    /// @inheritdoc IReputationSBT
    function mint(address user) external onlyRole(VERIFIER_ROLE) returns (uint256 tokenId) {
        if (user == address(0)) revert ZeroAddress();
        tokenId = tokenIdOf(user);
        if (_ownerOf(tokenId) != address(0)) revert AlreadyHasBadge(user);
        // _mint, not _safeMint: no receiver callback, so minting can never re-enter.
        _mint(user, tokenId);
        emit BadgeMinted(user, tokenId);
        emit Locked(tokenId);
    }

    /// @inheritdoc IReputationSBT
    function recordSuccess(
        address sharer,
        address seeker,
        uint256 value
    ) external onlyRole(ESCROW_ROLE) {
        if (sharer == address(0) || seeker == address(0)) revert ZeroAddress();
        if (sharer == seeker) revert SameParty(sharer);

        bytes32 key = _pairKey(sharer, seeker);
        bool newPair = !_pairSeen[key];
        if (newPair) _pairSeen[key] = true;

        uint128 volume = SafeCast.toUint128(value);
        uint128 points = SafeCast.toUint128(value / _relayPointUnit);
        _addSuccess(_stats[sharer], volume, points, newPair);
        _addSuccess(_stats[seeker], volume, points, newPair);

        emit SuccessRecorded(sharer, seeker, value, newPair);
    }

    /// @inheritdoc IReputationSBT
    function recordFault(address user) external onlyRole(ESCROW_ROLE) {
        if (user == address(0)) revert ZeroAddress();
        uint32 disputesLost = ++_stats[user].disputesLost;
        emit FaultRecorded(user, disputesLost);
    }

    /// @inheritdoc IReputationSBT
    function setTierLimits(uint256[3] calldata limits) external onlyRole(POLICY_ADMIN_ROLE) {
        if (limits[0] > limits[1] || limits[1] > limits[2]) revert TierLimitsNotAscending();
        _tierLimits = limits;
        emit TierLimitsSet(limits);
    }

    /// @inheritdoc IReputationSBT
    function setTierRules(uint8 tier, TierRule calldata rule) external onlyRole(POLICY_ADMIN_ROLE) {
        if (tier != TRUSTED && tier != VERIFIED) revert InvalidTier(tier);
        TierRule memory trusted = _tierRules[TRUSTED];
        TierRule memory verified = _tierRules[VERIFIED];
        if (tier == TRUSTED) trusted = rule;
        else verified = rule;
        if (
            verified.minCompleted < trusted.minCompleted ||
            verified.minUniqueCounterparties < trusted.minUniqueCounterparties
        ) revert TierRulesNotAscending();
        _storeTierRule(tier, rule);
    }

    /// @inheritdoc IReputationSBT
    function setRelayPointUnit(uint256 unit) external onlyRole(POLICY_ADMIN_ROLE) {
        if (unit == 0) revert InvalidRelayPointUnit();
        _relayPointUnit = unit;
        emit RelayPointUnitSet(unit);
    }

    // ------------------------------------------------------------------------------------------------
    // Soulbound rules
    // ------------------------------------------------------------------------------------------------

    /// @notice Badges cannot be approved for transfer.
    function approve(address, uint256) public pure override {
        revert Soulbound();
    }

    /// @notice Badges cannot be approved for transfer.
    function setApprovalForAll(address, bool) public pure override {
        revert Soulbound();
    }

    /// @inheritdoc IERC5192
    function locked(uint256 tokenId) external view returns (bool) {
        _requireOwned(tokenId);
        return true;
    }

    // ------------------------------------------------------------------------------------------------
    // Reads
    // ------------------------------------------------------------------------------------------------

    /// @inheritdoc IReputationSBT
    function hasBadge(address user) public view returns (bool) {
        return _ownerOf(tokenIdOf(user)) != address(0);
    }

    /// @inheritdoc IReputationSBT
    function tokenIdOf(address user) public pure returns (uint256) {
        return uint256(uint160(user));
    }

    /// @inheritdoc IReputationSBT
    function tierOf(address user) public view returns (uint8) {
        return hasBadge(user) ? _tierFor(_stats[user]) : 0;
    }

    /// @inheritdoc IReputationSBT
    function maxDealValue(address user) public view returns (uint256) {
        return hasBadge(user) ? _tierLimits[_tierFor(_stats[user])] : 0;
    }

    /// @inheritdoc IReputationSBT
    function trustOf(
        address user
    )
        external
        view
        returns (
            bool badge,
            uint8 tier,
            uint32 completed,
            uint32 disputesLost,
            uint128 relayPoints,
            uint256 maxValue
        )
    {
        Stats storage stats = _stats[user];
        badge = hasBadge(user);
        if (badge) {
            tier = _tierFor(stats);
            maxValue = _tierLimits[tier];
        }
        return (badge, tier, stats.completed, stats.disputesLost, stats.relayPoints, maxValue);
    }

    /// @inheritdoc IReputationSBT
    function statsOf(address user) external view returns (Stats memory) {
        return _stats[user];
    }

    /// @inheritdoc IReputationSBT
    function tierLimit(uint8 tier) external view returns (uint256) {
        if (tier > VERIFIED) revert InvalidTier(tier);
        return _tierLimits[tier];
    }

    /// @inheritdoc IReputationSBT
    function tierRule(uint8 tier) external view returns (TierRule memory) {
        if (tier > VERIFIED) revert InvalidTier(tier);
        return _tierRules[tier];
    }

    /// @inheritdoc IReputationSBT
    function relayPointUnit() external view returns (uint256) {
        return _relayPointUnit;
    }

    /// @inheritdoc IReputationSBT
    function pairSeen(address a, address b) external view returns (bool) {
        return _pairSeen[_pairKey(a, b)];
    }

    /// @notice ERC-165: ERC-721, ERC-721 Metadata, AccessControl, ERC-5192 (`0xb45a3c0e`) and
    /// IReputationSBT.
    function supportsInterface(
        bytes4 interfaceId
    ) public view override(ERC721, AccessControl) returns (bool) {
        return
            interfaceId == type(IERC5192).interfaceId ||
            interfaceId == type(IReputationSBT).interfaceId ||
            super.supportsInterface(interfaceId);
    }

    // ------------------------------------------------------------------------------------------------
    // Internals
    // ------------------------------------------------------------------------------------------------

    /// @dev Soulbound: only mints (from == 0) pass; every transfer between two addresses reverts.
    function _update(
        address to,
        uint256 tokenId,
        address auth
    ) internal override returns (address) {
        address from = _ownerOf(tokenId);
        if (from != address(0) && to != address(0)) revert Soulbound();
        return super._update(to, tokenId, auth);
    }

    function _addSuccess(
        Stats storage stats,
        uint128 volume,
        uint128 points,
        bool newPair
    ) private {
        stats.completed += 1;
        if (newPair) stats.uniqueCounterparties += 1;
        if (stats.firstDealAt == 0) stats.firstDealAt = uint64(block.timestamp);
        stats.volume += volume;
        stats.relayPoints += points;
    }

    function _storeTierRule(uint8 tier, TierRule memory rule) private {
        _tierRules[tier] = rule;
        emit TierRuleSet(tier, rule);
    }

    /// @dev Highest tier whose rule the stats satisfy; tier 0 has no rule.
    function _tierFor(Stats storage stats) private view returns (uint8) {
        if (_meets(stats, _tierRules[VERIFIED])) return VERIFIED;
        if (_meets(stats, _tierRules[TRUSTED])) return TRUSTED;
        return 0;
    }

    function _meets(Stats storage stats, TierRule storage rule) private view returns (bool) {
        return
            stats.completed >= rule.minCompleted &&
            stats.uniqueCounterparties >= rule.minUniqueCounterparties &&
            stats.disputesLost <= rule.maxDisputesLost;
    }

    /// @dev Order-independent key of an address pair.
    function _pairKey(address a, address b) private pure returns (bytes32) {
        return a < b ? keccak256(abi.encode(a, b)) : keccak256(abi.encode(b, a));
    }
}
