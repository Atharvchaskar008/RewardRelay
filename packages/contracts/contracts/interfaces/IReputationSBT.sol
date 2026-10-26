// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC5192} from "./IERC5192.sol";

/// @title IReputationSBT: the RewardRelay Trust Badge
/// @notice A soulbound (ERC-5192) ERC-721 badge, one per phone-verified address, that records the holder's
/// deal history and derives a trust tier from it. The tier sets the largest deal the holder may join.
/// Any MST application can read a user's standing through {trustOf}.
/// @dev Roles: VERIFIER_ROLE mints, ESCROW_ROLE records outcomes, POLICY_ADMIN_ROLE tunes tiers,
/// DEFAULT_ADMIN_ROLE manages roles. Badge ids are `uint256(uint160(owner))`.
interface IReputationSBT is IERC5192 {
    // ------------------------------------------------------------------------------------------------
    // Types
    // ------------------------------------------------------------------------------------------------

    /// @notice Deal history of one address.
    /// @param completed Deals that ended in `Completed` (as sharer or seeker).
    /// @param disputesLost Faults recorded against the address (timeouts and lost disputes).
    /// @param uniqueCounterparties Distinct addresses the user completed at least one deal with.
    /// @param firstDealAt Timestamp of the first completed deal (0 if none).
    /// @param volume Sum of completed deal prices in wei.
    /// @param relayPoints Loyalty points: `price / relayPointUnit` per completed deal.
    struct Stats {
        uint32 completed;
        uint32 disputesLost;
        uint32 uniqueCounterparties;
        uint64 firstDealAt;
        uint128 volume;
        uint128 relayPoints;
    }

    /// @notice Requirements to hold a tier (1 Trusted, 2 Verified). Tier 0 (New) has no requirements.
    struct TierRule {
        uint32 minCompleted;
        uint32 minUniqueCounterparties;
        uint32 maxDisputesLost;
    }

    // ------------------------------------------------------------------------------------------------
    // Events
    // ------------------------------------------------------------------------------------------------

    /// @notice A badge was minted. ERC-5192 `Locked(tokenId)` is emitted alongside.
    event BadgeMinted(address indexed owner, uint256 indexed tokenId);

    /// @notice A completed deal was recorded for both parties.
    /// @param newPair True when the two addresses had never completed a deal together before.
    event SuccessRecorded(
        address indexed sharer,
        address indexed seeker,
        uint256 value,
        bool newPair
    );

    /// @notice A fault was recorded against `user`.
    event FaultRecorded(address indexed user, uint32 disputesLost);

    /// @notice Tier limits (wei) changed.
    event TierLimitsSet(uint256[3] limits);

    /// @notice The rule for `tier` changed.
    event TierRuleSet(uint8 indexed tier, TierRule rule);

    /// @notice The wei amount that earns one Relay Point changed.
    event RelayPointUnitSet(uint256 unit);

    // ------------------------------------------------------------------------------------------------
    // Errors
    // ------------------------------------------------------------------------------------------------

    /// @notice `user` already holds a badge.
    error AlreadyHasBadge(address user);
    /// @notice Badges cannot be transferred or approved.
    error Soulbound();
    /// @notice A required address argument was zero.
    error ZeroAddress();
    /// @notice A deal cannot be recorded between an address and itself.
    error SameParty(address user);
    /// @notice `tier` is not a configurable tier.
    error InvalidTier(uint8 tier);
    /// @notice Tier limits must not decrease from tier 0 to tier 2.
    error TierLimitsNotAscending();
    /// @notice Tier 2 must require at least as many completed deals and counterparties as tier 1.
    error TierRulesNotAscending();
    /// @notice The Relay Point unit must be non-zero.
    error InvalidRelayPointUnit();

    // ------------------------------------------------------------------------------------------------
    // Writes
    // ------------------------------------------------------------------------------------------------

    /// @notice Mints the Trust Badge of `user` after off-chain phone verification.
    /// @dev VERIFIER_ROLE only. Reverts with {AlreadyHasBadge} if `user` holds one. Emits {BadgeMinted}
    /// and ERC-5192 {Locked}.
    /// @param user Address that receives the badge.
    /// @return tokenId The badge id, `uint256(uint160(user))`.
    function mint(address user) external returns (uint256 tokenId);

    /// @notice Records a completed deal for both parties: +1 completed, volume, Relay Points, first-deal
    /// time, and a unique-counterparty increment the first time the pair completes a deal.
    /// @dev ESCROW_ROLE only. Reverts with {SameParty} if `sharer == seeker`.
    /// @param sharer The deal's sharer.
    /// @param seeker The deal's seeker.
    /// @param value The deal price in wei.
    function recordSuccess(address sharer, address seeker, uint256 value) external;

    /// @notice Records a fault (timeout or lost dispute) against `user`.
    /// @dev ESCROW_ROLE only.
    /// @param user The party at fault.
    function recordFault(address user) external;

    /// @notice Sets the maximum deal value in wei for tiers 0, 1 and 2.
    /// @dev POLICY_ADMIN_ROLE only. Limits must be non-decreasing. Emits {TierLimitsSet}.
    /// @param limits Wei limits indexed by tier.
    function setTierLimits(uint256[3] calldata limits) external;

    /// @notice Sets the requirements of tier 1 or 2.
    /// @dev POLICY_ADMIN_ROLE only. Tier 2 must not ask for less than tier 1. Emits {TierRuleSet}.
    /// @param tier 1 (Trusted) or 2 (Verified).
    /// @param rule The new requirements.
    function setTierRules(uint8 tier, TierRule calldata rule) external;

    /// @notice Sets how many wei of completed volume earn one Relay Point.
    /// @dev POLICY_ADMIN_ROLE only. Affects future deals only. Emits {RelayPointUnitSet}.
    /// @param unit Wei per point, non-zero.
    function setRelayPointUnit(uint256 unit) external;

    // ------------------------------------------------------------------------------------------------
    // Reads
    // ------------------------------------------------------------------------------------------------

    /// @notice Whether `user` holds a Trust Badge.
    function hasBadge(address user) external view returns (bool);

    /// @notice The badge id `user` holds or would hold: `uint256(uint160(user))`.
    function tokenIdOf(address user) external pure returns (uint256);

    /// @notice Current tier of `user`: 0 New, 1 Trusted, 2 Verified (0 for unbadged addresses).
    function tierOf(address user) external view returns (uint8);

    /// @notice Largest deal price in wei `user` may list or accept (0 for unbadged addresses).
    function maxDealValue(address user) external view returns (uint256);

    /// @notice One-call trust summary for escrows, backends and other MST applications.
    /// @return badge Whether `user` holds a badge.
    /// @return tier Current tier.
    /// @return completed Completed deals.
    /// @return disputesLost Recorded faults.
    /// @return relayPoints Relay Points earned.
    /// @return maxValue Largest allowed deal price in wei.
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
        );

    /// @notice Full deal history of `user`.
    function statsOf(address user) external view returns (Stats memory);

    /// @notice Maximum deal value in wei of `tier`.
    function tierLimit(uint8 tier) external view returns (uint256);

    /// @notice Requirements of `tier` (tier 0 returns an empty rule).
    function tierRule(uint8 tier) external view returns (TierRule memory);

    /// @notice Wei of completed volume per Relay Point.
    function relayPointUnit() external view returns (uint256);

    /// @notice Whether `a` and `b` have completed a deal together (order-independent).
    function pairSeen(address a, address b) external view returns (bool);
}
