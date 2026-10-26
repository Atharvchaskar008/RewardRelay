import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import {
  CATEGORY,
  DAY,
  DealType,
  EMPTY_AUTH,
  EVIDENCE_HASH,
  type EscrowFixture,
  HOUR,
  MINUTE,
  NextAction,
  POLICIES,
  PRICE,
  PROOF_HASH,
  Party,
  RELAY_POINT_UNIT,
  Status,
  TERMS_HASH,
  TIER_LIMITS,
  accept,
  deployEscrowFixture,
  expectSolvent,
  latestTime,
  listBuyForYou,
  listPassOn,
  signListingAuth,
} from "./helpers/escrow";

const BPS = 10_000n;
const FEE_BPS = 200n;
const SHARER_DEPOSIT = (PRICE * 5_000n) / BPS; // tier 0: 50%
const SEEKER_DEPOSIT = (PRICE * 500n) / BPS; // 5%
const FEE = (PRICE * FEE_BPS) / BPS; // 2%
const HELD = PRICE + SHARER_DEPOSIT + SEEKER_DEPOSIT;

/** SPEC.md §3 money table for Resolved deals, written independently of the contract. */
function disputeSplit(shareBps: bigint, fault: Party, chargeFee: boolean) {
  const seekerPrice = (PRICE * shareBps) / BPS;
  const sharerPrice = PRICE - seekerPrice;
  const fee = chargeFee ? (sharerPrice * FEE_BPS) / BPS : 0n;
  let sharer = sharerPrice - fee;
  let seeker = seekerPrice;
  if (fault === Party.Sharer) seeker += SHARER_DEPOSIT + SEEKER_DEPOSIT;
  else if (fault === Party.Seeker) sharer += SHARER_DEPOSIT + SEEKER_DEPOSIT;
  else {
    sharer += SHARER_DEPOSIT;
    seeker += SEEKER_DEPOSIT;
  }
  return { sharer, seeker, fee };
}

/** Makes `user` Trusted by recording 5 completed deals with 3 distinct partners on the badge. */
async function makeTrusted(f: EscrowFixture, user: string) {
  await f.sbt.grantRole(await f.sbt.ESCROW_ROLE(), f.admin.address);
  const partners = f.others.slice(0, 3).map((s) => s.address);
  for (let i = 0; i < 5; i++) await f.sbt.recordSuccess(user, partners[i % 3], 1n);
  expect(await f.sbt.tierOf(user)).to.equal(1);
}

async function deliveredDeal(f: EscrowFixture): Promise<bigint> {
  const id = await listBuyForYou(f);
  await accept(f, id);
  await f.escrow.connect(f.sharer).markDelivered(id, PROOF_HASH);
  return id;
}

async function disputedDeal(f: EscrowFixture): Promise<bigint> {
  const id = await deliveredDeal(f);
  await f.escrow.connect(f.seeker).raiseDispute(id, EVIDENCE_HASH);
  return id;
}

describe("RelayEscrow lifecycle", function () {
  describe("deployment and views", function () {
    it("grants roles, stores defaults and emits the configuration", async function () {
      const { escrow, sbt, admin, verifier, treasury } = await loadFixture(deployEscrowFixture);

      expect(await escrow.hasRole(await escrow.DEFAULT_ADMIN_ROLE(), admin.address)).to.equal(true);
      expect(await escrow.hasRole(await escrow.POLICY_ADMIN_ROLE(), admin.address)).to.equal(true);
      expect(await escrow.hasRole(await escrow.PAUSER_ROLE(), admin.address)).to.equal(true);
      expect(await escrow.hasRole(await escrow.VERIFIER_ROLE(), verifier.address)).to.equal(true);
      expect(await escrow.sbt()).to.equal(await sbt.getAddress());
      expect(await escrow.treasury()).to.equal(treasury.address);
      expect(await escrow.feeBps()).to.equal(200);
      expect(await escrow.seekerDepositBps()).to.equal(500);
      for (const [tier, bps] of [5_000, 3_000, 2_000].entries()) {
        expect(await escrow.sharerDepositBps(tier)).to.equal(bps);
      }
      expect(await escrow.arbiterTimeout()).to.equal(72n * HOUR);

      const deployTx = escrow.deploymentTransaction();
      await expect(deployTx).to.emit(escrow, "TreasurySet").withArgs(treasury.address);
      await expect(deployTx).to.emit(escrow, "FeeBpsSet").withArgs(200);
      await expect(deployTx).to.emit(escrow, "DepositBpsSet").withArgs([5_000, 3_000, 2_000], 500);
      await expect(deployTx)
        .to.emit(escrow, "ArbiterTimeoutSet")
        .withArgs(72n * HOUR);
    });

    it("rejects zero addresses in the constructor", async function () {
      const { sbt, admin, verifier, treasury } = await loadFixture(deployEscrowFixture);
      const factory = await ethers.getContractFactory("RelayEscrow");
      const sbtAddress = await sbt.getAddress();
      const zero = ethers.ZeroAddress;

      for (const args of [
        [zero, treasury.address, verifier.address, admin.address],
        [sbtAddress, zero, verifier.address, admin.address],
        [sbtAddress, treasury.address, zero, admin.address],
        [sbtAddress, treasury.address, verifier.address, zero],
      ]) {
        await expect(
          factory.deploy(args[0], args[1], args[2], args[3]),
        ).to.be.revertedWithCustomError(factory, "ZeroAddress");
      }
    });

    it("exposes the EIP-712 domain, type hash and digest the server signs", async function () {
      const { escrow, sharer } = await loadFixture(deployEscrowFixture);
      const domain = {
        name: "RewardRelay",
        version: "1",
        chainId: (await ethers.provider.getNetwork()).chainId,
        verifyingContract: await escrow.getAddress(),
      };
      const types = {
        ListingAuth: [
          { name: "sharer", type: "address" },
          { name: "fingerprint", type: "bytes32" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      };
      const value = {
        sharer: sharer.address,
        fingerprint: ethers.id("CODE"),
        nonce: 0n,
        deadline: 99n,
      };

      expect(await escrow.LISTING_AUTH_TYPEHASH()).to.equal(
        ethers.id("ListingAuth(address sharer,bytes32 fingerprint,uint256 nonce,uint256 deadline)"),
      );
      expect(await escrow.domainSeparator()).to.equal(ethers.TypedDataEncoder.hashDomain(domain));
      expect(
        await escrow.hashListingAuth(value.sharer, value.fingerprint, value.nonce, value.deadline),
      ).to.equal(ethers.TypedDataEncoder.hash(domain, types, value));
    });

    it("quotes deposits, advertises its interfaces and rejects unknown deals", async function () {
      const { escrow, sharer } = await loadFixture(deployEscrowFixture);

      expect(await escrow.requiredSharerDeposit(sharer.address, PRICE)).to.equal(SHARER_DEPOSIT);
      expect(await escrow.requiredSeekerDeposit(PRICE)).to.equal(SEEKER_DEPOSIT);
      expect(await escrow.supportsInterface("0x7965db0b")).to.equal(true); // AccessControl
      expect(await escrow.supportsInterface("0x01ffc9a7")).to.equal(true); // ERC-165
      expect(await escrow.supportsInterface("0xffffffff")).to.equal(false);
      await expect(escrow.getDeal(1))
        .to.be.revertedWithCustomError(escrow, "DealNotFound")
        .withArgs(1);
      await expect(escrow.nextActionFor(1, sharer.address))
        .to.be.revertedWithCustomError(escrow, "DealNotFound")
        .withArgs(1);
      expect(await escrow.getPolicy(CATEGORY.coupon)).to.deep.equal([1n, 0n, 120n, 0n, 600n, true]);
    });

    it("advertises the IRelayEscrow interface id", async function () {
      const { escrow } = await loadFixture(deployEscrowFixture);
      const iface = (await ethers.getContractAt("IRelayEscrow", await escrow.getAddress()))
        .interface;
      let id = 0n;
      iface.forEachFunction((fn) => (id ^= BigInt(fn.selector)));

      expect(await escrow.supportsInterface(ethers.toBeHex(id, 4))).to.equal(true);
    });
  });

  describe("1) Buy-for-you happy path", function () {
    it("moves money, fee and deposits exactly and updates both badges", async function () {
      const f = await loadFixture(deployEscrowFixture);
      const { escrow, sbt, sharer, seeker, treasury } = f;
      const escrowAddress = await escrow.getAddress();

      // List: the sharer locks the tier-0 deposit (50%).
      const listTx = escrow
        .connect(sharer)
        .createListing(CATEGORY.ecommerce, PRICE, 0, TERMS_HASH, ethers.ZeroHash, EMPTY_AUTH, {
          value: SHARER_DEPOSIT,
        });
      await expect(listTx)
        .to.emit(escrow, "ListingCreated")
        .withArgs(
          1,
          sharer.address,
          CATEGORY.ecommerce,
          DealType.BuyForYou,
          PRICE,
          SHARER_DEPOSIT,
          SEEKER_DEPOSIT,
          0,
          TERMS_HASH,
          ethers.ZeroHash,
        );
      await expect(listTx).to.changeEtherBalances(
        [sharer, escrowAddress],
        [-SHARER_DEPOSIT, SHARER_DEPOSIT],
      );
      const listed = await escrow.getDeal(1);
      expect(listed.status).to.equal(Status.Listed);
      expect(listed.feeBps).to.equal(200);
      expect(listed.arbiterTimeout).to.equal(72n * HOUR);
      expect(listed.policy.deliveryWindow).to.equal(POLICIES.ecommerce.deliveryWindow);
      expect(await escrow.dealCount()).to.equal(1n);

      // Accept: price + 5% seeker deposit.
      const acceptTx = escrow.connect(seeker).acceptListing(1, { value: PRICE + SEEKER_DEPOSIT });
      await expect(acceptTx).to.changeEtherBalances(
        [seeker, escrowAddress],
        [-(PRICE + SEEKER_DEPOSIT), PRICE + SEEKER_DEPOSIT],
      );
      const lockedAt = await latestTime();
      await expect(acceptTx)
        .to.emit(escrow, "DealLocked")
        .withArgs(1, seeker.address, PRICE + SEEKER_DEPOSIT, lockedAt + 3n * MINUTE);
      expect(await escrow.totalEscrowed()).to.equal(HELD);

      // Deliver: proof hash and releaseAt = now + releaseDelay.
      const deliverTx = await escrow.connect(sharer).markDelivered(1, PROOF_HASH);
      const deliveredAt = await latestTime();
      await expect(deliverTx)
        .to.emit(escrow, "Delivered")
        .withArgs(1, PROOF_HASH, deliveredAt + 2n * MINUTE);
      const delivered = await escrow.getDeal(1);
      expect(delivered.status).to.equal(Status.Delivered);
      expect(delivered.proofHash).to.equal(PROOF_HASH);

      // Confirm early: sharer P - fee + Ds, seeker Dk, treasury fee.
      const confirmTx = escrow.connect(seeker).confirmReceipt(1);
      await expect(confirmTx)
        .to.emit(escrow, "Completed")
        .withArgs(
          1,
          sharer.address,
          seeker.address,
          PRICE - FEE + SHARER_DEPOSIT,
          SEEKER_DEPOSIT,
          FEE,
          true,
        );
      await expect(confirmTx)
        .to.emit(sbt, "SuccessRecorded")
        .withArgs(sharer.address, seeker.address, PRICE, true);
      await expect(confirmTx).to.changeEtherBalances(
        [sharer, seeker, treasury, escrowAddress],
        [PRICE - FEE + SHARER_DEPOSIT, SEEKER_DEPOSIT, FEE, -HELD],
      );

      expect((await escrow.getDeal(1)).status).to.equal(Status.Completed);
      for (const user of [sharer, seeker]) {
        const stats = await sbt.statsOf(user.address);
        expect(stats.completed).to.equal(1n);
        expect(stats.uniqueCounterparties).to.equal(1n);
        expect(stats.volume).to.equal(PRICE);
        expect(stats.relayPoints).to.equal(PRICE / RELAY_POINT_UNIT);
      }
      expect(await escrow.totalEscrowed()).to.equal(0n);
      await expectSolvent(escrow);
    });
  });

  describe("Pass-on happy path", function () {
    it("is delivered on accept and completes on confirmation", async function () {
      const f = await loadFixture(deployEscrowFixture);
      const { escrow, sharer, seeker } = f;
      const { id, fingerprint } = await listPassOn(f, { code: "UPI-SCRATCH-7781" });

      const listed = await escrow.getDeal(id);
      expect(listed.codeFingerprint).to.equal(fingerprint);
      expect(listed.policy.dealType).to.equal(DealType.PassOn);
      expect(await escrow.usedFingerprint(fingerprint)).to.equal(true);
      expect(await escrow.nonces(sharer.address)).to.equal(1n);

      const acceptTx = await accept(f, id);
      const at = await latestTime();
      await expect(acceptTx)
        .to.emit(escrow, "DealLocked")
        .withArgs(id, seeker.address, PRICE + SEEKER_DEPOSIT, 0);
      await expect(acceptTx)
        .to.emit(escrow, "Delivered")
        .withArgs(id, ethers.ZeroHash, at + 2n * MINUTE);
      expect((await escrow.getDeal(id)).status).to.equal(Status.Delivered);

      await expect(escrow.connect(seeker).confirmReceipt(id))
        .to.emit(escrow, "Completed")
        .withArgs(
          id,
          sharer.address,
          seeker.address,
          PRICE - FEE + SHARER_DEPOSIT,
          SEEKER_DEPOSIT,
          FEE,
          true,
        );
      await expectSolvent(escrow);
    });
  });

  describe("3) tier limits", function () {
    it("caps the sharer's listing price at its tier limit", async function () {
      const f = await loadFixture(deployEscrowFixture);
      const price = TIER_LIMITS[0] + 1n;

      await expect(
        f.escrow
          .connect(f.sharer)
          .createListing(CATEGORY.ecommerce, price, 0, TERMS_HASH, ethers.ZeroHash, EMPTY_AUTH, {
            value: (price * 5_000n) / BPS,
          }),
      )
        .to.be.revertedWithCustomError(f.escrow, "DealValueAboveLimit")
        .withArgs(f.sharer.address, price, TIER_LIMITS[0]);
    });

    it("lets a Trusted sharer list more, at the lower tier-1 deposit, but caps the seeker", async function () {
      const f = await loadFixture(deployEscrowFixture);
      await makeTrusted(f, f.sharer.address);
      const price = ethers.parseEther("0.01"); // Rs 1,000: above New, within Trusted

      expect(await f.escrow.requiredSharerDeposit(f.sharer.address, price)).to.equal(
        (price * 3_000n) / BPS,
      );
      const id = await listBuyForYou(f, { price });
      expect((await f.escrow.getDeal(id)).sharerDeposit).to.equal((price * 3_000n) / BPS);

      const value = price + (price * 500n) / BPS;
      await expect(f.escrow.connect(f.seeker).acceptListing(id, { value }))
        .to.be.revertedWithCustomError(f.escrow, "DealValueAboveLimit")
        .withArgs(f.seeker.address, price, TIER_LIMITS[0]);

      await makeTrusted(f, f.carol.address);
      await expect(f.escrow.connect(f.carol).acceptListing(id, { value })).to.emit(
        f.escrow,
        "DealLocked",
      );
    });

    it("blocks unbadged accounts from listing and accepting", async function () {
      const f = await loadFixture(deployEscrowFixture);

      await expect(
        f.escrow
          .connect(f.outsider)
          .createListing(CATEGORY.ecommerce, PRICE, 0, TERMS_HASH, ethers.ZeroHash, EMPTY_AUTH, {
            value: SHARER_DEPOSIT,
          }),
      )
        .to.be.revertedWithCustomError(f.escrow, "NoTrustBadge")
        .withArgs(f.outsider.address);

      const id = await listBuyForYou(f);
      await expect(
        f.escrow.connect(f.outsider).acceptListing(id, { value: PRICE + SEEKER_DEPOSIT }),
      )
        .to.be.revertedWithCustomError(f.escrow, "NoTrustBadge")
        .withArgs(f.outsider.address);
    });
  });

  describe("4) timeout refund and slashing", function () {
    it("refunds price and both deposits to the seeker and records the sharer's fault", async function () {
      const f = await loadFixture(deployEscrowFixture);
      const { escrow, sbt, sharer, seeker, keeper } = f;
      const id = await listBuyForYou(f);
      await accept(f, id);
      const { deliverBy } = await escrow.getDeal(id);

      await expect(escrow.connect(keeper).claimTimeout(id))
        .to.be.revertedWithCustomError(escrow, "DeliveryWindowOpen")
        .withArgs(id, deliverBy);

      await time.increaseTo(deliverBy + 1n);
      const tx = escrow.connect(keeper).claimTimeout(id);
      await expect(tx).to.emit(escrow, "Refunded").withArgs(id, seeker.address, HELD);
      await expect(tx).to.emit(sbt, "FaultRecorded").withArgs(sharer.address, 1);
      await expect(tx).to.changeEtherBalances([seeker, sharer], [HELD, 0n]);

      expect((await escrow.getDeal(id)).status).to.equal(Status.Refunded);
      expect((await sbt.statsOf(sharer.address)).disputesLost).to.equal(1n);
      await expect(escrow.connect(sharer).markDelivered(id, PROOF_HASH))
        .to.be.revertedWithCustomError(escrow, "InvalidStatus")
        .withArgs(id, Status.Refunded);
      await expectSolvent(escrow);
    });

    it("accepts delivery up to and including deliverBy, never after", async function () {
      const f = await loadFixture(deployEscrowFixture);
      const onTime = await listBuyForYou(f);
      await accept(f, onTime);
      const late = await listBuyForYou(f);
      await accept(f, late, f.carol);

      const onTimeDeadline = (await f.escrow.getDeal(onTime)).deliverBy;
      await time.setNextBlockTimestamp(onTimeDeadline);
      await expect(f.escrow.connect(f.sharer).markDelivered(onTime, PROOF_HASH)).to.emit(
        f.escrow,
        "Delivered",
      );

      const lateDeadline = (await f.escrow.getDeal(late)).deliverBy;
      await time.increaseTo(lateDeadline + 1n);
      await expect(f.escrow.connect(f.sharer).markDelivered(late, PROOF_HASH))
        .to.be.revertedWithCustomError(f.escrow, "DeliveryWindowClosed")
        .withArgs(late, lateDeadline);
    });
  });

  describe("5) auto-release and event times", function () {
    it("lets a third party release exactly from releaseAt", async function () {
      const f = await loadFixture(deployEscrowFixture);
      const id = await deliveredDeal(f);
      const { releaseAt } = await f.escrow.getDeal(id);

      await expect(f.escrow.connect(f.keeper).release(id))
        .to.be.revertedWithCustomError(f.escrow, "ReleaseNotDue")
        .withArgs(id, releaseAt);

      await time.setNextBlockTimestamp(releaseAt);
      const tx = f.escrow.connect(f.keeper).release(id);
      await expect(tx)
        .to.emit(f.escrow, "Completed")
        .withArgs(
          id,
          f.sharer.address,
          f.seeker.address,
          PRICE - FEE + SHARER_DEPOSIT,
          SEEKER_DEPOSIT,
          FEE,
          false,
        );
      await expect(tx).to.changeEtherBalances(
        [f.sharer, f.seeker, f.treasury, f.keeper],
        [PRICE - FEE + SHARER_DEPOSIT, SEEKER_DEPOSIT, FEE, 0n],
      );
      await expectSolvent(f.escrow);
    });

    it("waits for eventTime + eventBuffer when that is later than the release delay", async function () {
      const f = await loadFixture(deployEscrowFixture);
      const eventTime = (await latestTime()) + HOUR; // journey in one hour
      const id = await listBuyForYou(f, { category: CATEGORY.travel, eventTime });
      await accept(f, id);
      await f.escrow.connect(f.sharer).markDelivered(id, PROOF_HASH);

      const expectedReleaseAt = eventTime + 30n * MINUTE;
      expect((await f.escrow.getDeal(id)).releaseAt).to.equal(expectedReleaseAt);

      await time.increase(POLICIES.travel.releaseDelay + MINUTE);
      await expect(f.escrow.connect(f.keeper).release(id)).to.be.revertedWithCustomError(
        f.escrow,
        "ReleaseNotDue",
      );
      // The seeker can still dispute before the journey (e.g. a cancelled booking).
      await expect(f.escrow.connect(f.seeker).raiseDispute(id, EVIDENCE_HASH)).to.emit(
        f.escrow,
        "DisputeRaised",
      );
    });

    it("releases an event deal once the buffer after the event has passed", async function () {
      const f = await loadFixture(deployEscrowFixture);
      const eventTime = (await latestTime()) + HOUR;
      const id = await listBuyForYou(f, { category: CATEGORY.travel, eventTime });
      await accept(f, id);
      await f.escrow.connect(f.sharer).markDelivered(id, PROOF_HASH);

      await time.increaseTo(eventTime + 30n * MINUTE);
      await expect(f.escrow.connect(f.keeper).release(id)).to.emit(f.escrow, "Completed");
    });

    it("rejects past or far-future event times and accepts after the event", async function () {
      const f = await loadFixture(deployEscrowFixture);
      const now = await latestTime();
      const list = (eventTime: bigint) =>
        f.escrow
          .connect(f.sharer)
          .createListing(
            CATEGORY.travel,
            PRICE,
            eventTime,
            TERMS_HASH,
            ethers.ZeroHash,
            EMPTY_AUTH,
            {
              value: SHARER_DEPOSIT,
            },
          );

      await expect(list(now))
        .to.be.revertedWithCustomError(f.escrow, "InvalidEventTime")
        .withArgs(now);
      const tooFar = now + 366n * DAY;
      await expect(list(tooFar))
        .to.be.revertedWithCustomError(f.escrow, "InvalidEventTime")
        .withArgs(tooFar);

      const eventTime = now + HOUR;
      const id = await listBuyForYou(f, { category: CATEGORY.travel, eventTime });
      await time.increaseTo(eventTime);
      await expect(accept(f, id))
        .to.be.revertedWithCustomError(f.escrow, "EventPassed")
        .withArgs(id, eventTime);
    });
  });

  describe("6) disputes", function () {
    it("freezes a delivered deal and blocks release", async function () {
      const f = await loadFixture(deployEscrowFixture);
      const id = await deliveredDeal(f);

      const tx = await f.escrow.connect(f.seeker).raiseDispute(id, EVIDENCE_HASH);
      await expect(tx)
        .to.emit(f.escrow, "DisputeRaised")
        .withArgs(id, f.seeker.address, EVIDENCE_HASH);
      const deal = await f.escrow.getDeal(id);
      expect(deal.status).to.equal(Status.Disputed);
      expect(deal.disputeOpenedAt).to.equal(await latestTime());

      await time.increase(POLICIES.ecommerce.releaseDelay);
      await expect(f.escrow.connect(f.keeper).release(id))
        .to.be.revertedWithCustomError(f.escrow, "InvalidStatus")
        .withArgs(id, Status.Disputed);
    });

    const rulings: { name: string; shareBps: bigint; fault: Party }[] = [
      { name: "100/0 to the seeker, sharer at fault", shareBps: 10_000n, fault: Party.Sharer },
      { name: "0/100 to the sharer, seeker at fault", shareBps: 0n, fault: Party.Seeker },
      { name: "50/50, no fault", shareBps: 5_000n, fault: Party.None },
      { name: "50/50, sharer at fault", shareBps: 5_000n, fault: Party.Sharer },
      { name: "50/50, seeker at fault", shareBps: 5_000n, fault: Party.Seeker },
    ];

    for (const ruling of rulings) {
      it(`settles ${ruling.name}`, async function () {
        const f = await loadFixture(deployEscrowFixture);
        const id = await disputedDeal(f);
        const expected = disputeSplit(ruling.shareBps, ruling.fault, true);
        expect(expected.sharer + expected.seeker + expected.fee).to.equal(HELD);

        const tx = f.escrow.connect(f.arbiter).resolveDispute(id, ruling.shareBps, ruling.fault);
        await expect(tx)
          .to.emit(f.escrow, "DisputeResolved")
          .withArgs(
            id,
            f.arbiter.address,
            ruling.shareBps,
            ruling.fault,
            expected.sharer,
            expected.seeker,
            expected.fee,
          );
        await expect(tx).to.changeEtherBalances(
          [f.sharer, f.seeker, f.treasury],
          [expected.sharer, expected.seeker, expected.fee],
        );

        const faulty =
          ruling.fault === Party.Sharer
            ? f.sharer
            : ruling.fault === Party.Seeker
              ? f.seeker
              : null;
        if (faulty) await expect(tx).to.emit(f.sbt, "FaultRecorded").withArgs(faulty.address, 1);
        else await expect(tx).not.to.emit(f.sbt, "FaultRecorded");
        expect((await f.escrow.getDeal(id)).status).to.equal(Status.Resolved);
        await expectSolvent(f.escrow);
      });
    }

    it("applies the fee-free 50/50 default ruling after the arbiter timeout", async function () {
      const f = await loadFixture(deployEscrowFixture);
      const id = await disputedDeal(f);
      const deal = await f.escrow.getDeal(id);
      const availableAt = deal.disputeOpenedAt + deal.arbiterTimeout;

      await expect(f.escrow.connect(f.keeper).defaultResolve(id))
        .to.be.revertedWithCustomError(f.escrow, "ArbiterTimeoutNotReached")
        .withArgs(id, availableAt);

      await time.increaseTo(availableAt);
      const expected = disputeSplit(5_000n, Party.None, false);
      const tx = f.escrow.connect(f.keeper).defaultResolve(id);
      await expect(tx)
        .to.emit(f.escrow, "DisputeResolved")
        .withArgs(id, ethers.ZeroAddress, 5_000, Party.None, expected.sharer, expected.seeker, 0);
      await expect(tx).to.changeEtherBalances(
        [f.sharer, f.seeker, f.treasury],
        [expected.sharer, expected.seeker, 0n],
      );
      await expect(tx).not.to.emit(f.sbt, "FaultRecorded");
      await expectSolvent(f.escrow);
    });

    it("only lets the arbiter rule, never on its own deal, within 0-10000 bps", async function () {
      const f = await loadFixture(deployEscrowFixture);
      const id = await disputedDeal(f);
      const role = await f.escrow.ARBITER_ROLE();

      for (const caller of [f.sharer, f.seeker, f.admin, f.keeper]) {
        await expect(f.escrow.connect(caller).resolveDispute(id, 5_000, Party.None))
          .to.be.revertedWithCustomError(f.escrow, "AccessControlUnauthorizedAccount")
          .withArgs(caller.address, role);
      }
      await expect(f.escrow.connect(f.arbiter).resolveDispute(id, 10_001, Party.None))
        .to.be.revertedWithCustomError(f.escrow, "InvalidShareBps")
        .withArgs(10_001);

      await f.escrow.grantRole(role, f.sharer.address);
      await expect(f.escrow.connect(f.sharer).resolveDispute(id, 0, Party.Seeker))
        .to.be.revertedWithCustomError(f.escrow, "ArbiterIsParty")
        .withArgs(id);
      await f.escrow.grantRole(role, f.seeker.address);
      await expect(f.escrow.connect(f.seeker).resolveDispute(id, 10_000, Party.Sharer))
        .to.be.revertedWithCustomError(f.escrow, "ArbiterIsParty")
        .withArgs(id);
    });

    it("lets only the seeker dispute, only before releaseAt and only with evidence", async function () {
      const f = await loadFixture(deployEscrowFixture);
      const id = await deliveredDeal(f);
      const { releaseAt } = await f.escrow.getDeal(id);

      await expect(f.escrow.connect(f.sharer).raiseDispute(id, EVIDENCE_HASH))
        .to.be.revertedWithCustomError(f.escrow, "NotSeeker")
        .withArgs(id, f.sharer.address);
      await expect(
        f.escrow.connect(f.seeker).raiseDispute(id, ethers.ZeroHash),
      ).to.be.revertedWithCustomError(f.escrow, "EvidenceRequired");

      await time.increaseTo(releaseAt);
      await expect(f.escrow.connect(f.seeker).raiseDispute(id, EVIDENCE_HASH))
        .to.be.revertedWithCustomError(f.escrow, "DisputeWindowClosed")
        .withArgs(id, releaseAt);
    });

    it("accepts evidence from both parties during the evidence window only", async function () {
      const f = await loadFixture(deployEscrowFixture);
      const id = await disputedDeal(f);
      const deal = await f.escrow.getDeal(id);
      const closesAt = deal.disputeOpenedAt + deal.policy.disputeWindow;
      const more = ethers.id("tracking page screenshot");

      for (const party of [f.sharer, f.seeker]) {
        await expect(f.escrow.connect(party).addEvidence(id, more))
          .to.emit(f.escrow, "EvidenceAdded")
          .withArgs(id, party.address, more);
      }
      await expect(f.escrow.connect(f.keeper).addEvidence(id, more))
        .to.be.revertedWithCustomError(f.escrow, "NotParty")
        .withArgs(id, f.keeper.address);
      await expect(
        f.escrow.connect(f.sharer).addEvidence(id, ethers.ZeroHash),
      ).to.be.revertedWithCustomError(f.escrow, "EvidenceRequired");

      await time.increaseTo(closesAt + 1n);
      await expect(f.escrow.connect(f.sharer).addEvidence(id, more))
        .to.be.revertedWithCustomError(f.escrow, "EvidenceWindowClosed")
        .withArgs(id, closesAt);
    });

    it("lets the seeker concede a dispute by confirming receipt", async function () {
      const f = await loadFixture(deployEscrowFixture);
      const id = await disputedDeal(f);

      await expect(f.escrow.connect(f.seeker).confirmReceipt(id))
        .to.emit(f.escrow, "Completed")
        .withArgs(
          id,
          f.sharer.address,
          f.seeker.address,
          PRICE - FEE + SHARER_DEPOSIT,
          SEEKER_DEPOSIT,
          FEE,
          true,
        );
      await expect(f.escrow.connect(f.arbiter).resolveDispute(id, 0, Party.None))
        .to.be.revertedWithCustomError(f.escrow, "InvalidStatus")
        .withArgs(id, Status.Completed);
    });
  });

  describe("9) policy snapshot", function () {
    it("keeps in-flight deals on the policy, fee, deposits and timeout they were created with", async function () {
      const f = await loadFixture(deployEscrowFixture);
      const id = await listBuyForYou(f);

      await f.escrow.setPolicy(CATEGORY.ecommerce, {
        ...POLICIES.ecommerce,
        deliveryWindow: 30n * MINUTE,
        releaseDelay: DAY,
      });
      await f.escrow.setFeeBps(500);
      await f.escrow.setDepositBps([10_000, 10_000, 10_000], 1_000);
      await f.escrow.setArbiterTimeout(HOUR);

      // The old deal still asks for the old seeker deposit and uses the old windows.
      await accept(f, id);
      const locked = await f.escrow.getDeal(id);
      expect(locked.seekerDeposit).to.equal(SEEKER_DEPOSIT);
      expect(locked.deliverBy).to.equal((await latestTime()) + 3n * MINUTE);
      await f.escrow.connect(f.sharer).markDelivered(id, PROOF_HASH);
      expect((await f.escrow.getDeal(id)).releaseAt).to.equal((await latestTime()) + 2n * MINUTE);
      expect((await f.escrow.getDeal(id)).arbiterTimeout).to.equal(72n * HOUR);

      await expect(f.escrow.connect(f.seeker).confirmReceipt(id))
        .to.emit(f.escrow, "Completed")
        .withArgs(
          id,
          f.sharer.address,
          f.seeker.address,
          PRICE - FEE + SHARER_DEPOSIT,
          SEEKER_DEPOSIT,
          FEE,
          true,
        );

      // A new listing picks up the new configuration.
      const fresh = await listBuyForYou(f);
      const deal = await f.escrow.getDeal(fresh);
      expect(deal.sharerDeposit).to.equal(PRICE);
      expect(deal.seekerDeposit).to.equal(PRICE / 10n);
      expect(deal.feeBps).to.equal(500);
      expect(deal.arbiterTimeout).to.equal(HOUR);
      expect(deal.policy.releaseDelay).to.equal(DAY);
    });

    it("keeps listed deals alive when their category is deactivated", async function () {
      const f = await loadFixture(deployEscrowFixture);
      const id = await listBuyForYou(f);
      await f.escrow.setPolicy(CATEGORY.ecommerce, { ...POLICIES.ecommerce, active: false });

      await expect(listBuyForYou(f))
        .to.be.revertedWithCustomError(f.escrow, "PolicyInactive")
        .withArgs(CATEGORY.ecommerce);
      await expect(accept(f, id)).to.emit(f.escrow, "DealLocked");
    });
  });

  describe("cancellation", function () {
    it("returns the deposit to the sharer and closes the listing", async function () {
      const f = await loadFixture(deployEscrowFixture);
      const id = await listBuyForYou(f);

      await expect(f.escrow.connect(f.seeker).cancelListing(id))
        .to.be.revertedWithCustomError(f.escrow, "NotSharer")
        .withArgs(id, f.seeker.address);
      const tx = f.escrow.connect(f.sharer).cancelListing(id);
      await expect(tx).to.emit(f.escrow, "ListingCancelled").withArgs(id, f.sharer.address);
      await expect(tx).to.changeEtherBalances([f.sharer], [SHARER_DEPOSIT]);
      expect((await f.escrow.getDeal(id)).status).to.equal(Status.Cancelled);
      await expect(accept(f, id))
        .to.be.revertedWithCustomError(f.escrow, "InvalidStatus")
        .withArgs(id, Status.Cancelled);
      await expectSolvent(f.escrow);
    });

    it("cannot cancel once a seeker has paid", async function () {
      const f = await loadFixture(deployEscrowFixture);
      const id = await listBuyForYou(f);
      await accept(f, id);

      await expect(f.escrow.connect(f.sharer).cancelListing(id))
        .to.be.revertedWithCustomError(f.escrow, "InvalidStatus")
        .withArgs(id, Status.Locked);
    });

    it("frees a cancelled Pass-on fingerprint for a new authorisation", async function () {
      const f = await loadFixture(deployEscrowFixture);
      const { id, fingerprint } = await listPassOn(f, { code: "RELIST-ME" });
      await f.escrow.connect(f.sharer).cancelListing(id);
      expect(await f.escrow.usedFingerprint(fingerprint)).to.equal(false);

      const auth = await signListingAuth(
        f.escrow,
        f.verifier,
        f.sharer.address,
        fingerprint,
        await f.escrow.nonces(f.sharer.address),
        (await latestTime()) + HOUR,
      );
      await expect(
        f.escrow
          .connect(f.sharer)
          .createListing(CATEGORY.coupon, PRICE, 0, TERMS_HASH, fingerprint, auth, {
            value: SHARER_DEPOSIT,
          }),
      ).to.emit(f.escrow, "ListingCreated");
    });
  });

  describe("nextActionFor", function () {
    it("follows SPEC.md §8 for listed, locked and delivered deals", async function () {
      const f = await loadFixture(deployEscrowFixture);
      const { escrow, sharer, seeker, carol, outsider, keeper } = f;
      const action = (id: bigint, who: { address: string }) =>
        escrow.nextActionFor(id, who.address);

      const id = await listBuyForYou(f);
      expect(await action(id, sharer)).to.equal(NextAction.Cancel);
      expect(await action(id, carol)).to.equal(NextAction.Accept);
      expect(await action(id, outsider)).to.equal(NextAction.None); // no badge
      await escrow.pause();
      expect(await action(id, carol)).to.equal(NextAction.None);
      await escrow.unpause();

      await accept(f, id);
      expect(await action(id, sharer)).to.equal(NextAction.MarkDelivered);
      expect(await action(id, seeker)).to.equal(NextAction.Wait);
      expect(await action(id, keeper)).to.equal(NextAction.None);

      await escrow.connect(sharer).markDelivered(id, PROOF_HASH);
      expect(await action(id, seeker)).to.equal(NextAction.ConfirmOrDispute);
      expect(await action(id, sharer)).to.equal(NextAction.Wait);
      expect(await action(id, keeper)).to.equal(NextAction.None);

      await time.increase(POLICIES.ecommerce.releaseDelay + MINUTE);
      for (const who of [sharer, seeker, keeper]) {
        expect(await action(id, who)).to.equal(NextAction.Release);
      }
      await escrow.connect(keeper).release(id);
      for (const who of [sharer, seeker, keeper]) {
        expect(await action(id, who)).to.equal(NextAction.None);
      }
    });

    it("offers the refund to everyone but the sharer after a missed deadline", async function () {
      const f = await loadFixture(deployEscrowFixture);
      const id = await listBuyForYou(f);
      await accept(f, id);
      await time.increase(POLICIES.ecommerce.deliveryWindow + MINUTE);

      expect(await f.escrow.nextActionFor(id, f.sharer.address)).to.equal(NextAction.None);
      for (const who of [f.seeker, f.arbiter, f.keeper]) {
        expect(await f.escrow.nextActionFor(id, who.address)).to.equal(NextAction.ClaimRefund);
      }
    });

    it("hides Accept when the listing exceeds the account's limit or the event has started", async function () {
      const f = await loadFixture(deployEscrowFixture);
      await makeTrusted(f, f.sharer.address);
      const big = await listBuyForYou(f, { price: ethers.parseEther("0.01") });
      expect(await f.escrow.nextActionFor(big, f.carol.address)).to.equal(NextAction.None);

      const eventTime = (await latestTime()) + HOUR;
      const soon = await listBuyForYou(f, { category: CATEGORY.travel, eventTime });
      expect(await f.escrow.nextActionFor(soon, f.carol.address)).to.equal(NextAction.Accept);
      await time.increaseTo(eventTime + 1n);
      expect(await f.escrow.nextActionFor(soon, f.carol.address)).to.equal(NextAction.None);
    });

    it("guides parties, the arbiter and keepers through a dispute", async function () {
      const f = await loadFixture(deployEscrowFixture);
      const id = await disputedDeal(f);
      const action = (who: { address: string }) => f.escrow.nextActionFor(id, who.address);

      expect(await action(f.sharer)).to.equal(NextAction.AddEvidence);
      expect(await action(f.seeker)).to.equal(NextAction.AddEvidence);
      expect(await action(f.arbiter)).to.equal(NextAction.Resolve);
      expect(await action(f.keeper)).to.equal(NextAction.None);

      await time.increase(POLICIES.ecommerce.disputeWindow + MINUTE);
      expect(await action(f.sharer)).to.equal(NextAction.Wait);
      expect(await action(f.seeker)).to.equal(NextAction.Wait);
      expect(await action(f.arbiter)).to.equal(NextAction.Resolve);

      await time.increase(72n * HOUR);
      expect(await action(f.sharer)).to.equal(NextAction.DefaultResolve);
      expect(await action(f.keeper)).to.equal(NextAction.DefaultResolve);
      expect(await action(f.arbiter)).to.equal(NextAction.Resolve);
    });
  });
});
