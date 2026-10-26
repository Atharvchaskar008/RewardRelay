// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IERC5192} from "./interfaces/IERC5192.sol";
import {IReputationSBT} from "./interfaces/IReputationSBT.sol";

/// @title ReputationSBT: the RewardRelay Trust Badge
/// @notice Soulbound (ERC-5192) ERC-721 badge minted once per phone-verified address.
/// @dev Adapted from the create-mst-app `certificate` template: the soulbound `_update` rule is kept,
/// `Ownable` issuers become `VERIFIER_ROLE`, and approvals revert as well as transfers.
/// Badge ids are `uint256(uint160(owner))`: anyone can derive a user's badge from the address alone, and
/// one badge per address follows from token-id uniqueness.
contract ReputationSBT is ERC721, AccessControl, IERC5192 {
    /// @notice Role allowed to mint badges (the server after phone verification).
    bytes32 public constant VERIFIER_ROLE = keccak256("VERIFIER_ROLE");

    /// @param admin Receives DEFAULT_ADMIN_ROLE.
    constructor(address admin) ERC721("RewardRelay Trust Badge", "RRTB") {
        if (admin == address(0)) revert IReputationSBT.ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    /// @notice Mints the Trust Badge of `user`. VERIFIER_ROLE only; one badge per address.
    /// @param user Address that receives the badge.
    /// @return tokenId The badge id, `uint256(uint160(user))`.
    function mint(address user) external onlyRole(VERIFIER_ROLE) returns (uint256 tokenId) {
        if (user == address(0)) revert IReputationSBT.ZeroAddress();
        tokenId = tokenIdOf(user);
        if (_ownerOf(tokenId) != address(0)) revert IReputationSBT.AlreadyHasBadge(user);
        // _mint, not _safeMint: no receiver callback, so minting can never re-enter.
        _mint(user, tokenId);
        emit IReputationSBT.BadgeMinted(user, tokenId);
        emit Locked(tokenId);
    }

    /// @notice Whether `user` holds a Trust Badge.
    function hasBadge(address user) public view returns (bool) {
        return _ownerOf(tokenIdOf(user)) != address(0);
    }

    /// @notice The badge id `user` holds or would hold.
    function tokenIdOf(address user) public pure returns (uint256) {
        return uint256(uint160(user));
    }

    /// @inheritdoc IERC5192
    function locked(uint256 tokenId) external view returns (bool) {
        _requireOwned(tokenId);
        return true;
    }

    /// @notice Badges cannot be approved for transfer.
    function approve(address, uint256) public pure override {
        revert IReputationSBT.Soulbound();
    }

    /// @notice Badges cannot be approved for transfer.
    function setApprovalForAll(address, bool) public pure override {
        revert IReputationSBT.Soulbound();
    }

    /// @notice ERC-165: ERC-721, ERC-721 Metadata, AccessControl and ERC-5192 (`0xb45a3c0e`).
    function supportsInterface(
        bytes4 interfaceId
    ) public view override(ERC721, AccessControl) returns (bool) {
        return interfaceId == type(IERC5192).interfaceId || super.supportsInterface(interfaceId);
    }

    /// @dev Soulbound: only mints (from == 0) pass; every transfer between two addresses reverts.
    function _update(
        address to,
        uint256 tokenId,
        address auth
    ) internal override returns (address) {
        address from = _ownerOf(tokenId);
        if (from != address(0) && to != address(0)) revert IReputationSBT.Soulbound();
        return super._update(to, tokenId, auth);
    }
}
