import { expect } from "chai";
import { ethers } from "hardhat";
import { keccak256, toUtf8Bytes } from "ethers";

describe("Certificate", function () {
  async function deployCertificate() {
    const [owner, holder, other] = await ethers.getSigners();

    const Certificate = await ethers.getContractFactory("Certificate");
    const certificate = await Certificate.deploy();
    await certificate.waitForDeployment();

    const certHash = keccak256(toUtf8Bytes("Jane Doe|B.Sc. Computer Science|2026-05-01"));

    return { certificate, owner, holder, other, certHash };
  }

  describe("Deployment", function () {
    it("should set the correct name and symbol", async function () {
      const { certificate } = await deployCertificate();

      expect(await certificate.name()).to.equal("MST Certificate");
      expect(await certificate.symbol()).to.equal("MSTCERT");
    });

    it("should assign the owner correctly", async function () {
      const { certificate, owner } = await deployCertificate();

      expect(await certificate.owner()).to.equal(owner.address);
    });

    it("should make the deployer an issuer by default", async function () {
      const { certificate, owner } = await deployCertificate();

      expect(await certificate.isIssuer(owner.address)).to.equal(true);
    });
  });

  describe("Issuer management", function () {
    it("should let the owner grant issuer rights to another address", async function () {
      const { certificate, other } = await deployCertificate();

      expect(await certificate.isIssuer(other.address)).to.equal(false);

      await certificate.setIssuer(other.address, true);

      expect(await certificate.isIssuer(other.address)).to.equal(true);
    });

    it("should let a newly-granted issuer issue certificates", async function () {
      const { certificate, holder, other, certHash } = await deployCertificate();

      await certificate.setIssuer(other.address, true);
      await certificate.connect(other).issue(holder.address, certHash, "ipfs://QmExampleCertificate");

      expect(await certificate.ownerOf(1)).to.equal(holder.address);
    });

    it("should let the owner revoke issuer rights", async function () {
      const { certificate, owner, holder, certHash } = await deployCertificate();

      await certificate.setIssuer(owner.address, false);

      await expect(
        certificate.issue(holder.address, certHash, "ipfs://QmExampleCertificate")
      ).to.be.revertedWith("Certificate: caller is not an issuer");
    });

    it("should reject setIssuer from a non-owner account", async function () {
      const { certificate, other } = await deployCertificate();

      await expect(certificate.connect(other).setIssuer(other.address, true)).to.be.reverted;
    });
  });

  describe("Issuing", function () {
    it("should issue a certificate to a holder", async function () {
      const { certificate, holder, certHash } = await deployCertificate();

      await certificate.issue(holder.address, certHash, "ipfs://QmExampleCertificate");

      expect(await certificate.ownerOf(1)).to.equal(holder.address);
      expect(await certificate.totalSupply()).to.equal(1);
    });

    it("should reject issuing from a non-issuer account", async function () {
      const { certificate, holder, other, certHash } = await deployCertificate();

      await expect(
        certificate.connect(other).issue(holder.address, certHash, "ipfs://QmExampleCertificate")
      ).to.be.revertedWith("Certificate: caller is not an issuer");
    });

    it("should batch-issue certificates to multiple holders", async function () {
      const { certificate, holder, other, certHash } = await deployCertificate();

      const certHash2 = keccak256(toUtf8Bytes("John Roe|B.Sc. Computer Science|2026-05-01"));

      await certificate.batchIssue(
        [holder.address, other.address],
        [certHash, certHash2],
        ["ipfs://QmExampleCertificate1", "ipfs://QmExampleCertificate2"]
      );

      expect(await certificate.ownerOf(1)).to.equal(holder.address);
      expect(await certificate.ownerOf(2)).to.equal(other.address);
      expect(await certificate.totalSupply()).to.equal(2);
    });

    it("should reject batch-issue with mismatched array lengths", async function () {
      const { certificate, holder, certHash } = await deployCertificate();

      await expect(
        certificate.batchIssue([holder.address], [certHash, certHash], ["ipfs://a"])
      ).to.be.revertedWith("Certificate: array length mismatch");
    });
  });

  describe("Verification", function () {
    it("should report a valid, freshly-issued certificate", async function () {
      const { certificate, holder, certHash } = await deployCertificate();

      await certificate.issue(holder.address, certHash, "ipfs://QmExampleCertificate");

      const [isValid, tokenHolder, storedHash, , revoked] = await certificate.verify(1);

      expect(isValid).to.equal(true);
      expect(tokenHolder).to.equal(holder.address);
      expect(storedHash).to.equal(certHash);
      expect(revoked).to.equal(false);
    });

    it("should report an unissued token as invalid", async function () {
      const { certificate } = await deployCertificate();

      const [isValid, tokenHolder] = await certificate.verify(999);

      expect(isValid).to.equal(false);
      expect(tokenHolder).to.equal(ethers.ZeroAddress);
    });

    it("should report a revoked certificate as invalid", async function () {
      const { certificate, holder, certHash } = await deployCertificate();

      await certificate.issue(holder.address, certHash, "ipfs://QmExampleCertificate");
      await certificate.revoke(1);

      const [isValid, , , , revoked] = await certificate.verify(1);

      expect(isValid).to.equal(false);
      expect(revoked).to.equal(true);
    });

    it("should reject revoking a non-existent certificate", async function () {
      const { certificate } = await deployCertificate();

      await expect(certificate.revoke(999)).to.be.reverted;
    });

    it("should reject revoking an already-revoked certificate", async function () {
      const { certificate, holder, certHash } = await deployCertificate();

      await certificate.issue(holder.address, certHash, "ipfs://QmExampleCertificate");
      await certificate.revoke(1);

      await expect(certificate.revoke(1)).to.be.revertedWith("Certificate: already revoked");
    });
  });

  describe("Soulbound transfers", function () {
    it("should reject transferring a certificate between holders", async function () {
      const { certificate, holder, other, certHash } = await deployCertificate();

      await certificate.issue(holder.address, certHash, "ipfs://QmExampleCertificate");

      await expect(
        certificate.connect(holder).transferFrom(holder.address, other.address, 1)
      ).to.be.revertedWith("Certificate: soulbound, non-transferable");
    });
  });

  describe("Pause", function () {
    it("should pause issuing", async function () {
      const { certificate, holder, certHash } = await deployCertificate();

      await certificate.pause();

      await expect(certificate.issue(holder.address, certHash, "ipfs://QmExampleCertificate")).to
        .be.reverted;
    });

    it("should allow issuing after unpausing", async function () {
      const { certificate, holder, certHash } = await deployCertificate();

      await certificate.pause();
      await certificate.unpause();

      await certificate.issue(holder.address, certHash, "ipfs://QmExampleCertificate");

      expect(await certificate.ownerOf(1)).to.equal(holder.address);
    });
  });
});
