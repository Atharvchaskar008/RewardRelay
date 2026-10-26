// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ERC-5192: Minimal Soulbound NFTs
/// @notice A token is soulbound while `locked` returns true. The ERC-165 interface id is `0xb45a3c0e`.
/// @dev See https://eips.ethereum.org/EIPS/eip-5192
interface IERC5192 {
    /// @notice Emitted when the locking status of a token changes to locked.
    /// @param tokenId The identifier of the token.
    event Locked(uint256 tokenId);

    /// @notice Emitted when the locking status of a token changes to unlocked.
    /// @param tokenId The identifier of the token.
    event Unlocked(uint256 tokenId);

    /// @notice Returns the locking status of a soulbound token.
    /// @dev Tokens assigned to the zero address are invalid; queries about them revert.
    /// @param tokenId The identifier of the token.
    /// @return True when the token cannot be transferred.
    function locked(uint256 tokenId) external view returns (bool);
}
