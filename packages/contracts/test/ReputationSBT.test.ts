import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import type { ReputationSBT } from "../typechain-types";
import { IReputationSBT__factory } from "../typechain-types";

const RELAY_POINT_UNIT = 10n ** 14n; // 0.0001 MSTC
const LIMITS: [bigint, bigint, bigint] = [
  ethers.parseEther("0.005"),
  ethers.parseEther("0.02"),
  ethers.parseEther("0.1"),
];
const DEAL_VALUE = ethers.parseEther("0.0153"); // Rs 1,530 at the demo rate

const ERC5192_ID = "0xb45a3c0e";
const ERC721_ID = "0x80ac58cd";
const ERC721_METADATA_ID = "0x5b5e139f";
const ERC165_ID = "0x01ffc9a7";
const ACCESS_CONTROL_ID = "0x7965db0b";

/** type(IReputationSBT).interfaceId: XOR of the selectors it declares itself (not the inherited `locked`). */
function reputationInterfaceId(): string {
  const iface = IReputationSBT__factory.createInterface();
  let id = 0n;
  iface.forEachFunction((fn) => {
    if (fn.name !== "locked") id ^= BigInt(fn.selector);
  });
  return ethers.toBeHex(id, 4);
}

function decodeTokenUri(uri: string): {
  name: string;
  description: string;
  attributes: { trait_type: string; value: string | number }[];
} {
  const prefix = "data:application/json;base64,";
  expect(uri.startsWith(prefix)).to.equal(true);
  return JSON.parse(Buffer.from(uri.slice(prefix.length), "base64").toString("utf8"));
}

describe("ReputationSBT", function () {
  async function deployFixture() {
    const signers = await ethers.getSigners();
    const [admin, verifier, escrow, alice, bob, outsider] = signers;
    const counterparties = signers.slice(6, 17);

    const sbt = await ethers.deployContract("ReputationSBT", [admin.address, RELAY_POINT_UNIT]);
    await sbt.waitForDeployment();

    await sbt.grantRole(await sbt.VERIFIER_ROLE(), verifier.address);
    await sbt.grantRole(await sbt.ESCROW_ROLE(), escrow.address);
    await sbt.setTierLimits(LIMITS);

    return { sbt, admin, verifier, escrow, alice, bob, outsider, counterparties };
  }

  async function badgedFixture() {
    const fixture = await deployFixture();
    await fixture.sbt.connect(fixture.verifier).mint(fixture.alice.address);
    await fixture.sbt.connect(fixture.verifier).mint(fixture.bob.address);
    return fixture;
  }

  /** Records `count` completed deals between `user` and `partner` (user as sharer). */
  async function completeDeals(
    sbt: ReputationSBT,
    escrow: HardhatEthersSigner,
    user: HardhatEthersSigner,
    partner: HardhatEthersSigner,
    count: number,
  ) {
    for (let i = 0; i < count; i++) {
      await sbt.connect(escrow).recordSuccess(user.address, partner.address, DEAL_VALUE);
    }
  }

  describe("deployment", function () {
    it("sets name, symbol, admin roles, point unit and default tier rules", async function () {
      const { sbt, admin } = await loadFixture(deployFixture);

      expect(await sbt.name()).to.equal("RewardRelay Trust Badge");
      expect(await sbt.symbol()).to.equal("RRTB");
      expect(await sbt.hasRole(await sbt.DEFAULT_ADMIN_ROLE(), admin.address)).to.equal(true);
      expect(await sbt.hasRole(await sbt.POLICY_ADMIN_ROLE(), admin.address)).to.equal(true);
      expect(await sbt.relayPointUnit()).to.equal(RELAY_POINT_UNIT);

      expect(await sbt.tierRule(0)).to.deep.equal([0n, 0n, 0n]);
      expect(await sbt.tierRule(1)).to.deep.equal([5n, 3n, 0n]);
      expect(await sbt.tierRule(2)).to.deep.equal([20n, 10n, 0n]);
    });

    it("emits the configuration events at construction", async function () {
      const [admin] = await ethers.getSigners();
      const sbt = await ethers.deployContract("ReputationSBT", [admin.address, RELAY_POINT_UNIT]);
      const deployTx = sbt.deploymentTransaction();

      await expect(deployTx).to.emit(sbt, "RelayPointUnitSet").withArgs(RELAY_POINT_UNIT);
      await expect(deployTx).to.emit(sbt, "TierRuleSet").withArgs(1, [5, 3, 0]);
      await expect(deployTx).to.emit(sbt, "TierRuleSet").withArgs(2, [20, 10, 0]);
    });

    it("starts with zero tier limits until configured", async function () {
      const [admin] = await ethers.getSigners();
      const sbt = await ethers.deployContract("ReputationSBT", [admin.address, RELAY_POINT_UNIT]);

      for (const tier of [0, 1, 2]) expect(await sbt.tierLimit(tier)).to.equal(0n);
    });

    it("rejects a zero admin and a zero point unit", async function () {
      const [admin] = await ethers.getSigners();
      const factory = await ethers.getContractFactory("ReputationSBT");

      await expect(
        factory.deploy(ethers.ZeroAddress, RELAY_POINT_UNIT),
      ).to.be.revertedWithCustomError(factory, "ZeroAddress");
      await expect(factory.deploy(admin.address, 0)).to.be.revertedWithCustomError(
        factory,
        "InvalidRelayPointUnit",
      );
    });
  });

  describe("minting", function () {
    it("mints one badge whose id is the owner address and emits BadgeMinted and Locked", async function () {
      const { sbt, verifier, alice } = await loadFixture(deployFixture);
      const tokenId = BigInt(alice.address);

      await expect(sbt.connect(verifier).mint(alice.address))
        .to.emit(sbt, "BadgeMinted")
        .withArgs(alice.address, tokenId)
        .and.to.emit(sbt, "Locked")
        .withArgs(tokenId)
        .and.to.emit(sbt, "Transfer")
        .withArgs(ethers.ZeroAddress, alice.address, tokenId);

      expect(await sbt.ownerOf(tokenId)).to.equal(alice.address);
      expect(await sbt.balanceOf(alice.address)).to.equal(1n);
      expect(await sbt.hasBadge(alice.address)).to.equal(true);
      expect(await sbt.tokenIdOf(alice.address)).to.equal(tokenId);
    });

    it("rejects a second badge for the same address", async function () {
      const { sbt, verifier, alice } = await loadFixture(badgedFixture);

      await expect(sbt.connect(verifier).mint(alice.address))
        .to.be.revertedWithCustomError(sbt, "AlreadyHasBadge")
        .withArgs(alice.address);
    });

    it("only lets VERIFIER_ROLE mint", async function () {
      const { sbt, admin, outsider, alice } = await loadFixture(deployFixture);
      const role = await sbt.VERIFIER_ROLE();

      for (const caller of [outsider, admin]) {
        await expect(sbt.connect(caller).mint(alice.address))
          .to.be.revertedWithCustomError(sbt, "AccessControlUnauthorizedAccount")
          .withArgs(caller.address, role);
      }
    });

    it("rejects the zero address", async function () {
      const { sbt, verifier } = await loadFixture(deployFixture);

      await expect(sbt.connect(verifier).mint(ethers.ZeroAddress)).to.be.revertedWithCustomError(
        sbt,
        "ZeroAddress",
      );
    });

    it("mints to contracts without calling onERC721Received", async function () {
      const { sbt, verifier } = await loadFixture(deployFixture);
      const contractHolder = await sbt.getAddress(); // has no ERC721 receiver hook

      await sbt.connect(verifier).mint(contractHolder);
      expect(await sbt.hasBadge(contractHolder)).to.equal(true);
    });
  });

  describe("soulbound rules", function () {
    it("blocks transferFrom and both safeTransferFrom overloads, even by the owner", async function () {
      const { sbt, alice, bob } = await loadFixture(badgedFixture);
      const tokenId = BigInt(alice.address);
      const asAlice = sbt.connect(alice);

      await expect(
        asAlice.transferFrom(alice.address, bob.address, tokenId),
      ).to.be.revertedWithCustomError(sbt, "Soulbound");
      await expect(
        asAlice["safeTransferFrom(address,address,uint256)"](alice.address, bob.address, tokenId),
      ).to.be.revertedWithCustomError(sbt, "Soulbound");
      await expect(
        asAlice["safeTransferFrom(address,address,uint256,bytes)"](
          alice.address,
          bob.address,
          tokenId,
          "0x",
        ),
      ).to.be.revertedWithCustomError(sbt, "Soulbound");
      expect(await sbt.ownerOf(tokenId)).to.equal(alice.address);
    });

    it("blocks transfers by third parties and to the zero address", async function () {
      const { sbt, alice, bob, outsider } = await loadFixture(badgedFixture);
      const tokenId = BigInt(alice.address);

      await expect(
        sbt.connect(outsider).transferFrom(alice.address, bob.address, tokenId),
      ).to.be.revertedWithCustomError(sbt, "Soulbound");
      await expect(sbt.connect(alice).transferFrom(alice.address, ethers.ZeroAddress, tokenId))
        .to.be.revertedWithCustomError(sbt, "ERC721InvalidReceiver")
        .withArgs(ethers.ZeroAddress);
    });

    it("blocks approve and setApprovalForAll", async function () {
      const { sbt, alice, bob } = await loadFixture(badgedFixture);
      const tokenId = BigInt(alice.address);

      await expect(sbt.connect(alice).approve(bob.address, tokenId)).to.be.revertedWithCustomError(
        sbt,
        "Soulbound",
      );
      await expect(
        sbt.connect(alice).setApprovalForAll(bob.address, true),
      ).to.be.revertedWithCustomError(sbt, "Soulbound");
      expect(await sbt.getApproved(tokenId)).to.equal(ethers.ZeroAddress);
      expect(await sbt.isApprovedForAll(alice.address, bob.address)).to.equal(false);
    });

    it("reports every badge as locked and reverts for unknown tokens", async function () {
      const { sbt, alice, outsider } = await loadFixture(badgedFixture);

      expect(await sbt.locked(BigInt(alice.address))).to.equal(true);
      await expect(sbt.locked(BigInt(outsider.address)))
        .to.be.revertedWithCustomError(sbt, "ERC721NonexistentToken")
        .withArgs(BigInt(outsider.address));
    });
  });

  describe("ERC-165", function () {
    it("advertises ERC-5192, ERC-721, metadata, AccessControl and IReputationSBT", async function () {
      const { sbt } = await loadFixture(deployFixture);

      for (const id of [
        ERC5192_ID,
        ERC721_ID,
        ERC721_METADATA_ID,
        ERC165_ID,
        ACCESS_CONTROL_ID,
        reputationInterfaceId(),
      ]) {
        expect(await sbt.supportsInterface(id), id).to.equal(true);
      }
      expect(await sbt.supportsInterface("0xffffffff")).to.equal(false);
    });
  });

  describe("tiers and limits", function () {
    it("gives unbadged addresses tier 0 and a zero limit regardless of history", async function () {
      const { sbt, escrow, outsider, alice } = await loadFixture(badgedFixture);
      await completeDeals(sbt, escrow, outsider, alice, 6);

      expect(await sbt.tierOf(outsider.address)).to.equal(0);
      expect(await sbt.maxDealValue(outsider.address)).to.equal(0n);
      expect(await sbt.trustOf(outsider.address)).to.deep.equal([false, 0n, 6n, 0n, 918n, 0n]);
    });

    it("starts badge holders at tier 0 with the tier-0 limit", async function () {
      const { sbt, alice } = await loadFixture(badgedFixture);

      expect(await sbt.tierOf(alice.address)).to.equal(0);
      expect(await sbt.maxDealValue(alice.address)).to.equal(LIMITS[0]);
      expect(await sbt.trustOf(alice.address)).to.deep.equal([true, 0n, 0n, 0n, 0n, LIMITS[0]]);
    });

    it("requires unique counterparties, not only completed deals, for Trusted", async function () {
      const { sbt, escrow, alice, counterparties } = await loadFixture(badgedFixture);
      const [c1, c2, c3] = counterparties;

      await completeDeals(sbt, escrow, alice, c1, 3);
      await completeDeals(sbt, escrow, alice, c2, 3);
      expect((await sbt.statsOf(alice.address)).completed).to.equal(6n);
      expect(await sbt.tierOf(alice.address)).to.equal(0);

      await completeDeals(sbt, escrow, alice, c3, 1);
      expect(await sbt.tierOf(alice.address)).to.equal(1);
      expect(await sbt.maxDealValue(alice.address)).to.equal(LIMITS[1]);
    });

    it("reaches Verified with 20 completed deals across 10 counterparties", async function () {
      const { sbt, escrow, alice, counterparties } = await loadFixture(badgedFixture);

      for (const partner of counterparties.slice(0, 9)) {
        await completeDeals(sbt, escrow, alice, partner, 2);
      }
      expect(await sbt.tierOf(alice.address)).to.equal(1); // 18 deals, 9 counterparties

      await completeDeals(sbt, escrow, alice, counterparties[9], 2);
      const stats = await sbt.statsOf(alice.address);
      expect(stats.completed).to.equal(20n);
      expect(stats.uniqueCounterparties).to.equal(10n);
      expect(await sbt.tierOf(alice.address)).to.equal(2);
      expect(await sbt.maxDealValue(alice.address)).to.equal(LIMITS[2]);
    });

    it("drops a user to tier 0 after a fault and records it", async function () {
      const { sbt, escrow, alice, counterparties } = await loadFixture(badgedFixture);
      for (const partner of counterparties.slice(0, 5)) {
        await completeDeals(sbt, escrow, alice, partner, 1);
      }
      expect(await sbt.tierOf(alice.address)).to.equal(1);

      await expect(sbt.connect(escrow).recordFault(alice.address))
        .to.emit(sbt, "FaultRecorded")
        .withArgs(alice.address, 1);
      expect((await sbt.statsOf(alice.address)).disputesLost).to.equal(1n);
      expect(await sbt.tierOf(alice.address)).to.equal(0);
      expect(await sbt.maxDealValue(alice.address)).to.equal(LIMITS[0]);

      await sbt.connect(escrow).recordFault(alice.address);
      expect((await sbt.trustOf(alice.address)).disputesLost).to.equal(2n);
    });

    it("lets a configurable maxDisputesLost forgive faults", async function () {
      const { sbt, escrow, alice, counterparties } = await loadFixture(badgedFixture);
      for (const partner of counterparties.slice(0, 5)) {
        await completeDeals(sbt, escrow, alice, partner, 1);
      }
      await sbt.connect(escrow).recordFault(alice.address);
      expect(await sbt.tierOf(alice.address)).to.equal(0);

      await sbt.setTierRules(1, {
        minCompleted: 5,
        minUniqueCounterparties: 3,
        maxDisputesLost: 1,
      });
      expect(await sbt.tierOf(alice.address)).to.equal(1);
    });
  });

  describe("outcome recording", function () {
    it("updates both parties: completed, volume, points, first deal time, counterparties", async function () {
      const { sbt, escrow, alice, bob } = await loadFixture(badgedFixture);

      const tx = await sbt.connect(escrow).recordSuccess(alice.address, bob.address, DEAL_VALUE);
      await expect(tx)
        .to.emit(sbt, "SuccessRecorded")
        .withArgs(alice.address, bob.address, DEAL_VALUE, true);
      const firstBlock = await ethers.provider.getBlock((await tx.wait())!.blockNumber);

      for (const user of [alice, bob]) {
        const stats = await sbt.statsOf(user.address);
        expect(stats.completed).to.equal(1n);
        expect(stats.uniqueCounterparties).to.equal(1n);
        expect(stats.volume).to.equal(DEAL_VALUE);
        expect(stats.relayPoints).to.equal(DEAL_VALUE / RELAY_POINT_UNIT); // 153
        expect(stats.firstDealAt).to.equal(BigInt(firstBlock!.timestamp));
        expect(stats.disputesLost).to.equal(0n);
      }
    });

    it("counts a repeated pair once in either order and keeps the first deal time", async function () {
      const { sbt, escrow, alice, bob } = await loadFixture(badgedFixture);

      await sbt.connect(escrow).recordSuccess(alice.address, bob.address, DEAL_VALUE);
      const firstDealAt = (await sbt.statsOf(alice.address)).firstDealAt;

      await expect(sbt.connect(escrow).recordSuccess(bob.address, alice.address, DEAL_VALUE))
        .to.emit(sbt, "SuccessRecorded")
        .withArgs(bob.address, alice.address, DEAL_VALUE, false);

      const stats = await sbt.statsOf(alice.address);
      expect(stats.completed).to.equal(2n);
      expect(stats.uniqueCounterparties).to.equal(1n);
      expect(stats.volume).to.equal(DEAL_VALUE * 2n);
      expect(stats.firstDealAt).to.equal(firstDealAt);
      expect(await sbt.pairSeen(alice.address, bob.address)).to.equal(true);
      expect(await sbt.pairSeen(bob.address, alice.address)).to.equal(true);
    });

    it("reports unseen pairs as unseen", async function () {
      const { sbt, alice, bob } = await loadFixture(badgedFixture);

      expect(await sbt.pairSeen(alice.address, bob.address)).to.equal(false);
    });

    it("rejects self-deals, zero addresses and values above uint128", async function () {
      const { sbt, escrow, alice, bob } = await loadFixture(badgedFixture);
      const asEscrow = sbt.connect(escrow);

      await expect(asEscrow.recordSuccess(alice.address, alice.address, DEAL_VALUE))
        .to.be.revertedWithCustomError(sbt, "SameParty")
        .withArgs(alice.address);
      await expect(
        asEscrow.recordSuccess(ethers.ZeroAddress, bob.address, DEAL_VALUE),
      ).to.be.revertedWithCustomError(sbt, "ZeroAddress");
      await expect(
        asEscrow.recordSuccess(alice.address, ethers.ZeroAddress, DEAL_VALUE),
      ).to.be.revertedWithCustomError(sbt, "ZeroAddress");
      await expect(asEscrow.recordFault(ethers.ZeroAddress)).to.be.revertedWithCustomError(
        sbt,
        "ZeroAddress",
      );
      await expect(
        asEscrow.recordSuccess(alice.address, bob.address, 2n ** 128n),
      ).to.be.revertedWithCustomError(sbt, "SafeCastOverflowedUintDowncast");
    });

    it("only lets ESCROW_ROLE record outcomes", async function () {
      const { sbt, admin, verifier, alice, bob } = await loadFixture(badgedFixture);
      const role = await sbt.ESCROW_ROLE();

      for (const caller of [admin, verifier, alice]) {
        await expect(sbt.connect(caller).recordSuccess(alice.address, bob.address, DEAL_VALUE))
          .to.be.revertedWithCustomError(sbt, "AccessControlUnauthorizedAccount")
          .withArgs(caller.address, role);
        await expect(sbt.connect(caller).recordFault(alice.address))
          .to.be.revertedWithCustomError(sbt, "AccessControlUnauthorizedAccount")
          .withArgs(caller.address, role);
      }
    });
  });

  describe("policy administration", function () {
    it("sets ascending tier limits and emits TierLimitsSet", async function () {
      const { sbt } = await loadFixture(deployFixture);
      const limits: [bigint, bigint, bigint] = [1n, 2n, 2n];

      await expect(sbt.setTierLimits(limits)).to.emit(sbt, "TierLimitsSet").withArgs(limits);
      expect(await sbt.tierLimit(0)).to.equal(1n);
      expect(await sbt.tierLimit(2)).to.equal(2n);
    });

    it("rejects descending tier limits at either step", async function () {
      const { sbt } = await loadFixture(deployFixture);

      await expect(sbt.setTierLimits([3n, 2n, 4n])).to.be.revertedWithCustomError(
        sbt,
        "TierLimitsNotAscending",
      );
      await expect(sbt.setTierLimits([1n, 3n, 2n])).to.be.revertedWithCustomError(
        sbt,
        "TierLimitsNotAscending",
      );
    });

    it("rejects reads and writes of unknown tiers", async function () {
      const { sbt } = await loadFixture(deployFixture);
      const rule = { minCompleted: 1, minUniqueCounterparties: 1, maxDisputesLost: 0 };

      await expect(sbt.tierLimit(3)).to.be.revertedWithCustomError(sbt, "InvalidTier").withArgs(3);
      await expect(sbt.tierRule(3)).to.be.revertedWithCustomError(sbt, "InvalidTier").withArgs(3);
      for (const tier of [0, 3]) {
        await expect(sbt.setTierRules(tier, rule))
          .to.be.revertedWithCustomError(sbt, "InvalidTier")
          .withArgs(tier);
      }
    });

    it("keeps Verified at least as demanding as Trusted", async function () {
      const { sbt } = await loadFixture(deployFixture);

      await expect(
        sbt.setTierRules(1, { minCompleted: 21, minUniqueCounterparties: 3, maxDisputesLost: 0 }),
      ).to.be.revertedWithCustomError(sbt, "TierRulesNotAscending");
      await expect(
        sbt.setTierRules(1, { minCompleted: 5, minUniqueCounterparties: 11, maxDisputesLost: 0 }),
      ).to.be.revertedWithCustomError(sbt, "TierRulesNotAscending");
      await expect(
        sbt.setTierRules(2, { minCompleted: 4, minUniqueCounterparties: 10, maxDisputesLost: 0 }),
      ).to.be.revertedWithCustomError(sbt, "TierRulesNotAscending");
      await expect(
        sbt.setTierRules(2, { minCompleted: 20, minUniqueCounterparties: 2, maxDisputesLost: 0 }),
      ).to.be.revertedWithCustomError(sbt, "TierRulesNotAscending");
    });

    it("updates tier rules, emits TierRuleSet and applies them immediately", async function () {
      const { sbt, escrow, alice, bob } = await loadFixture(badgedFixture);
      await completeDeals(sbt, escrow, alice, bob, 2);
      expect(await sbt.tierOf(alice.address)).to.equal(0);

      await expect(
        sbt.setTierRules(1, { minCompleted: 2, minUniqueCounterparties: 1, maxDisputesLost: 0 }),
      )
        .to.emit(sbt, "TierRuleSet")
        .withArgs(1, [2, 1, 0]);
      expect(await sbt.tierRule(1)).to.deep.equal([2n, 1n, 0n]);
      expect(await sbt.tierOf(alice.address)).to.equal(1);
    });

    it("updates the Relay Point unit for future deals only", async function () {
      const { sbt, escrow, alice, bob } = await loadFixture(badgedFixture);
      await sbt.connect(escrow).recordSuccess(alice.address, bob.address, DEAL_VALUE);

      await expect(sbt.setRelayPointUnit(RELAY_POINT_UNIT * 10n))
        .to.emit(sbt, "RelayPointUnitSet")
        .withArgs(RELAY_POINT_UNIT * 10n);
      await sbt.connect(escrow).recordSuccess(alice.address, bob.address, DEAL_VALUE);

      expect((await sbt.statsOf(alice.address)).relayPoints).to.equal(153n + 15n);
      await expect(sbt.setRelayPointUnit(0)).to.be.revertedWithCustomError(
        sbt,
        "InvalidRelayPointUnit",
      );
    });

    it("restricts every setter to POLICY_ADMIN_ROLE and lets the admin delegate it", async function () {
      const { sbt, outsider } = await loadFixture(deployFixture);
      const role = await sbt.POLICY_ADMIN_ROLE();
      const rule = { minCompleted: 5, minUniqueCounterparties: 3, maxDisputesLost: 0 };
      const asOutsider = sbt.connect(outsider);

      for (const call of [
        () => asOutsider.setTierLimits(LIMITS),
        () => asOutsider.setTierRules(1, rule),
        () => asOutsider.setRelayPointUnit(1),
      ]) {
        await expect(call())
          .to.be.revertedWithCustomError(sbt, "AccessControlUnauthorizedAccount")
          .withArgs(outsider.address, role);
      }

      await sbt.grantRole(role, outsider.address);
      await expect(asOutsider.setRelayPointUnit(1)).to.emit(sbt, "RelayPointUnitSet").withArgs(1);
    });
  });

  describe("metadata", function () {
    it("returns on-chain JSON with the name, tier and completed deals", async function () {
      const { sbt, escrow, alice, counterparties } = await loadFixture(badgedFixture);
      const tokenId = BigInt(alice.address);

      let meta = decodeTokenUri(await sbt.tokenURI(tokenId));
      expect(meta.name).to.equal("RewardRelay Trust Badge");
      expect(meta.description).to.contain("Soulbound");
      expect(meta.attributes).to.deep.equal([
        { trait_type: "Tier", value: "New" },
        { trait_type: "Completed deals", display_type: "number", value: 0 },
      ]);

      for (const partner of counterparties.slice(0, 5)) {
        await completeDeals(sbt, escrow, alice, partner, 1);
      }
      meta = decodeTokenUri(await sbt.tokenURI(tokenId));
      expect(meta.attributes[0]).to.deep.equal({ trait_type: "Tier", value: "Trusted" });
      expect(meta.attributes[1].value).to.equal(5);

      for (const partner of counterparties.slice(0, 10)) {
        await completeDeals(sbt, escrow, alice, partner, 2);
      }
      meta = decodeTokenUri(await sbt.tokenURI(tokenId));
      expect(meta.attributes[0].value).to.equal("Verified");
      expect(meta.attributes[1].value).to.equal(25);
    });

    it("reverts for tokens that do not exist", async function () {
      const { sbt, outsider } = await loadFixture(deployFixture);

      await expect(sbt.tokenURI(BigInt(outsider.address)))
        .to.be.revertedWithCustomError(sbt, "ERC721NonexistentToken")
        .withArgs(BigInt(outsider.address));
    });
  });
});
