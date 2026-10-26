// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title Certificate
/// @notice On-chain, tamper-proof credential registry. Each certificate is a
/// soulbound (non-transferable) NFT anchoring a cryptographic fingerprint of
/// the off-chain credential data, so anyone can verify authenticity in one
/// on-chain read instead of a manual, multi-day process.
contract Certificate is ERC721, Ownable, Pausable, ReentrancyGuard {
    struct CertificateData {
        bytes32 certHash;
        uint64 issuedAt;
        bool revoked;
    }

    uint256 private _nextTokenId = 1;

    mapping(uint256 => CertificateData) private _certificates;
    mapping(uint256 => string) private _tokenURIs;

    /// @notice Wallets allowed to issue certificates. Distinct from `owner`
    /// (administration — revoking, pausing, managing issuers) so a Vibe Kit
    /// frontend can work with whatever wallet the connected user brings,
    /// rather than requiring the exact deployer key.
    mapping(address => bool) public isIssuer;

    event CertificateIssued(uint256 indexed tokenId, address indexed holder, bytes32 certHash);
    event CertificateRevoked(uint256 indexed tokenId);
    event IssuerUpdated(address indexed account, bool allowed);

    modifier onlyIssuer() {
        require(isIssuer[msg.sender], "Certificate: caller is not an issuer");
        _;
    }

    constructor() ERC721("MST Certificate", "MSTCERT") Ownable(msg.sender) {
        isIssuer[msg.sender] = true;
        emit IssuerUpdated(msg.sender, true);
    }

    /// @notice Owner-only. Grants or revokes issuing rights for an address —
    /// the way to add more issuer wallets (or a backend signer) without
    /// transferring contract ownership.
    function setIssuer(address account, bool allowed) external onlyOwner {
        require(account != address(0), "Certificate: zero address");
        isIssuer[account] = allowed;
        emit IssuerUpdated(account, allowed);
    }

    /// @notice Issues one certificate. `certHash` should be a keccak256 hash
    /// of the certificate's off-chain data (holder name, course, date, ...),
    /// computed the same way at verification time.
    function issue(
        address to,
        bytes32 certHash,
        string calldata tokenURI_
    ) external onlyIssuer whenNotPaused nonReentrant returns (uint256) {
        return _issue(to, certHash, tokenURI_);
    }

    /// @notice Issues many certificates in one transaction, for batch
    /// graduation/training-cohort style workflows.
    function batchIssue(
        address[] calldata to,
        bytes32[] calldata certHashes,
        string[] calldata tokenURIs
    ) external onlyIssuer whenNotPaused nonReentrant returns (uint256[] memory tokenIds) {
        require(
            to.length == certHashes.length && to.length == tokenURIs.length,
            "Certificate: array length mismatch"
        );

        tokenIds = new uint256[](to.length);
        for (uint256 i = 0; i < to.length; i++) {
            tokenIds[i] = _issue(to[i], certHashes[i], tokenURIs[i]);
        }
    }

    /// @notice Marks a certificate as revoked (e.g. fraud found after the
    /// fact). The token stays on-chain as a record, but `verify` reports it
    /// as invalid from this point on.
    function revoke(uint256 tokenId) external onlyOwner {
        _requireOwned(tokenId);
        require(!_certificates[tokenId].revoked, "Certificate: already revoked");

        _certificates[tokenId].revoked = true;
        emit CertificateRevoked(tokenId);
    }

    /// @notice Single read anyone can call to check a certificate's
    /// authenticity and status — the operation a QR-code scan resolves to.
    function verify(
        uint256 tokenId
    )
        external
        view
        returns (bool isValid, address holder, bytes32 certHash, uint256 issuedAt, bool revoked)
    {
        if (!_exists(tokenId)) {
            return (false, address(0), bytes32(0), 0, false);
        }

        CertificateData memory data = _certificates[tokenId];
        holder = _ownerOf(tokenId);
        certHash = data.certHash;
        issuedAt = data.issuedAt;
        revoked = data.revoked;
        isValid = !revoked;
    }

    function totalSupply() external view returns (uint256) {
        return _nextTokenId - 1;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        return _tokenURIs[tokenId];
    }

    function _issue(
        address to,
        bytes32 certHash,
        string calldata tokenURI_
    ) private returns (uint256) {
        uint256 tokenId = _nextTokenId++;

        _safeMint(to, tokenId);
        _certificates[tokenId] = CertificateData({
            certHash: certHash,
            issuedAt: uint64(block.timestamp),
            revoked: false
        });
        _tokenURIs[tokenId] = tokenURI_;

        emit CertificateIssued(tokenId, to, certHash);
        return tokenId;
    }

    function _exists(uint256 tokenId) private view returns (bool) {
        return _ownerOf(tokenId) != address(0);
    }

    /// @dev Certificates are soulbound: only minting (from == address(0)) is
    /// allowed. Any transfer between two non-zero addresses reverts.
    function _update(
        address to,
        uint256 tokenId,
        address auth
    ) internal override whenNotPaused returns (address) {
        address from = _ownerOf(tokenId);
        if (from != address(0) && to != address(0)) {
            revert("Certificate: soulbound, non-transferable");
        }
        return super._update(to, tokenId, auth);
    }
}
