import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import type { EscrowActor } from "../typechain-types";
import {
  CATEGORY,
  DAY,
  DealType,
  EMPTY_AUTH,
  EVIDENCE_HASH,
  type EscrowFixture,
  HOUR,
  MINUTE,
  POLICIES,
  type PolicyConfig,
  PRICE,
  PROOF_HASH,
  Party,
  Status,
  TERMS_HASH,
  accept,
  deployEscrowFixture,
  expectSolvent,
  latestTime,
  listBuyForYou,
  listPassOn,
  signListingAuth,
} from "./helpers/escrow";

const BPS = 10_000n;
const SHARER_DEPOSIT = (PRICE * 5_000n) / BPS;
const SEEKER_DEPOSIT = (PRICE * 500n) / BPS;
const FEE = (PRICE * 200n) / BPS;
const SECP256K1_N = BigInt("0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141");
const REENTRANCY_SELECTOR = ethers.id("ReentrancyGuardReentrantCall()").slice(0, 10);

enum ActorMode {
  Accept = 0,
  Refuse = 1,
  BurnGas = 2,
  Reenter = 3,
}

async function deployActor(f: EscrowFixture, badge = true): Promise<EscrowActor> {
  const actor = await ethers.deployContract("EscrowActor", [await f.escrow.getAddress()]);
  if (badge) await f.sbt.connect(f.verifier).mint(await actor.getAddress());
  return actor;
}

/** Pass-on createListing with an explicit authorisation (for the signature attacks). */
function listPassOnWith(
  f: EscrowFixture,
  fingerprint: string,
  auth: Awaited<ReturnType<typeof signListingAuth>>,
  sender = f.sharer,
) {
  return f.escrow
    .connect(sender)
    .createListing(CATEGORY.coupon, PRICE, 0, TERMS_HASH, fingerprint, auth, {
      value: SHARER_DEPOSIT,
    });
}

async function freshAuth(
  f: EscrowFixture,
  fingerprint: string,
  overrides: {
    signer?: EscrowFixture["verifier"];
    nonce?: bigint;
    deadline?: bigint;
    chainId?: bigint;
    verifyingContract?: string;
    sharer?: string;
  } = {},
) {
  return signListingAuth(
    f.escrow,
    overrides.signer ?? f.verifier,
    overrides.sharer ?? f.sharer.address,
    fingerprint,
    overrides.nonce ?? (await f.escrow.nonces(f.sharer.address)),
    overrides.deadline ?? (await latestTime()) + HOUR,
    { chainId: overrides.chainId, verifyingContract: overrides.verifyingContract },
  );
}

describe("RelayEscrow adversarial", function () {
  describe("2) Pass-on authorisation (EIP-712)", function () {
    const fingerprint = ethers.id("SHAREABLE-CODE-42");

    it("rejects a second listing of the same code fingerprint", async function () {
      const f = await loadFixture(deployEscrowFixture);
      await listPassOn(f, { code: "SHAREABLE-CODE-42" });

      await expect(listPassOnWith(f, fingerprint, await freshAuth(f, fingerprint)))
        .to.be.revertedWithCustomError(f.escrow, "FingerprintAlreadyUsed")
        .withArgs(fingerprint);
    });

    it("rejects an expired authorisation and accepts one used exactly at its deadline", async function () {
      const f = await loadFixture(deployEscrowFixture);
      const now = await latestTime();

      const expired = await freshAuth(f, fingerprint, { deadline: now });
      await expect(listPassOnWith(f, fingerprint, expired))
        .to.be.revertedWithCustomError(f.escrow, "AuthorizationExpired")
        .withArgs(now);

      const deadline = now + MINUTE;
      const onTime = await freshAuth(f, fingerprint, { deadline });
      await time.setNextBlockTimestamp(deadline);
      await expect(listPassOnWith(f, fingerprint, onTime)).to.emit(f.escrow, "ListingCreated");
    });

    it("rejects signatures from accounts without VERIFIER_ROLE, including a revoked verifier", async function () {
      const f = await loadFixture(deployEscrowFixture);

      for (const signer of [f.outsider, f.admin, f.sharer]) {
        await expect(
          listPassOnWith(f, fingerprint, await freshAuth(f, fingerprint, { signer })),
        ).to.be.revertedWithCustomError(f.escrow, "InvalidAuthorization");
      }

      const valid = await freshAuth(f, fingerprint);
      await f.escrow.revokeRole(await f.escrow.VERIFIER_ROLE(), f.verifier.address);
      await expect(listPassOnWith(f, fingerprint, valid)).to.be.revertedWithCustomError(
        f.escrow,
        "InvalidAuthorization",
      );
    });

    it("rejects a replayed or skipped nonce", async function () {
      const f = await loadFixture(deployEscrowFixture);
      await listPassOn(f, { code: "FIRST" }); // consumes nonce 0
      const other = ethers.id("SECOND");

      await expect(listPassOnWith(f, other, await freshAuth(f, other, { nonce: 0n })))
        .to.be.revertedWithCustomError(f.escrow, "InvalidAccountNonce")
        .withArgs(f.sharer.address, 1);
      await expect(listPassOnWith(f, other, await freshAuth(f, other, { nonce: 5n })))
        .to.be.revertedWithCustomError(f.escrow, "InvalidAccountNonce")
        .withArgs(f.sharer.address, 1);
      await expect(listPassOnWith(f, other, await freshAuth(f, other))).to.emit(
        f.escrow,
        "ListingCreated",
      );
      expect(await f.escrow.nonces(f.sharer.address)).to.equal(2n);
    });

    it("rejects signatures made for another chain or another contract", async function () {
      const f = await loadFixture(deployEscrowFixture);

      for (const chainId of [1n, 91_562_037n, 4_646n]) {
        await expect(
          listPassOnWith(f, fingerprint, await freshAuth(f, fingerprint, { chainId })),
        ).to.be.revertedWithCustomError(f.escrow, "InvalidAuthorization");
      }
      const verifyingContract = await f.sbt.getAddress();
      await expect(
        listPassOnWith(f, fingerprint, await freshAuth(f, fingerprint, { verifyingContract })),
      ).to.be.revertedWithCustomError(f.escrow, "InvalidAuthorization");
    });

    it("makes an authorisation useless to anyone but the named sharer", async function () {
      const f = await loadFixture(deployEscrowFixture);
      const auth = await freshAuth(f, fingerprint, { nonce: 0n }); // for the sharer

      // Carol copies it from the mempool; her own nonce is also 0, but the digest names the sharer.
      await expect(listPassOnWith(f, fingerprint, auth, f.carol)).to.be.revertedWithCustomError(
        f.escrow,
        "InvalidAuthorization",
      );
      await expect(listPassOnWith(f, fingerprint, auth)).to.emit(f.escrow, "ListingCreated");
    });

    it("rejects malleable (high-s) and malformed signatures without burning the nonce", async function () {
      const f = await loadFixture(deployEscrowFixture);
      const auth = await freshAuth(f, fingerprint);
      const sig = ethers.Signature.from(auth.signature as string);
      const highS = ethers.concat([
        sig.r,
        ethers.toBeHex(SECP256K1_N - BigInt(sig.s), 32),
        ethers.toBeHex(sig.v === 27 ? 28 : 27, 1),
      ]);

      await expect(
        listPassOnWith(f, fingerprint, { ...auth, signature: highS }),
      ).to.be.revertedWithCustomError(f.escrow, "InvalidAuthorization");
      await expect(
        listPassOnWith(f, fingerprint, { ...auth, signature: "0x1234" }),
      ).to.be.revertedWithCustomError(f.escrow, "InvalidAuthorization");
      await expect(listPassOnWith(f, fingerprint, auth)).to.emit(f.escrow, "ListingCreated");
    });

    it("requires a fingerprint for Pass-on and forbids one for Buy-for-you", async function () {
      const f = await loadFixture(deployEscrowFixture);

      await expect(
        listPassOnWith(f, ethers.ZeroHash, await freshAuth(f, ethers.ZeroHash)),
      ).to.be.revertedWithCustomError(f.escrow, "FingerprintRequired");
      await expect(
        f.escrow
          .connect(f.sharer)
          .createListing(CATEGORY.ecommerce, PRICE, 0, TERMS_HASH, fingerprint, EMPTY_AUTH, {
            value: SHARER_DEPOSIT,
          }),
      ).to.be.revertedWithCustomError(f.escrow, "FingerprintNotAllowed");
    });
  });

  describe("7) payouts, pull fallback and reentrancy", function () {
    async function actorAsSharer(f: EscrowFixture, mode: ActorMode) {
      const actor = await deployActor(f);
      await actor.createListing(CATEGORY.ecommerce, PRICE, TERMS_HASH, { value: SHARER_DEPOSIT });
      const id = await f.escrow.dealCount();
      await accept(f, id);
      await actor.markDelivered(id, PROOF_HASH);
      await actor.setMode(mode, "0x");
      return { actor, id };
    }

    it("defers a refused payout to withdrawable while everyone else is paid", async function () {
      const f = await loadFixture(deployEscrowFixture);
      const { actor, id } = await actorAsSharer(f, ActorMode.Refuse);
      const actorAddress = await actor.getAddress();
      const sharerPayout = PRICE - FEE + SHARER_DEPOSIT;

      const tx = f.escrow.connect(f.seeker).confirmReceipt(id);
      await expect(tx).to.emit(f.escrow, "PayoutDeferred").withArgs(id, actorAddress, sharerPayout);
      await expect(tx).to.changeEtherBalances(
        [f.seeker, f.treasury, actorAddress],
        [SEEKER_DEPOSIT, FEE, 0n],
      );
      expect(await f.escrow.withdrawable(actorAddress)).to.equal(sharerPayout);
      expect(await f.escrow.totalWithdrawable()).to.equal(sharerPayout);
      expect(await f.escrow.totalEscrowed()).to.equal(0n);
      await expectSolvent(f.escrow);

      await actor.setMode(ActorMode.Accept, "0x");
      const withdrawTx = actor.withdraw();
      await expect(withdrawTx).to.emit(f.escrow, "Withdrawn").withArgs(actorAddress, sharerPayout);
      await expect(withdrawTx).to.changeEtherBalances(
        [actorAddress, await f.escrow.getAddress()],
        [sharerPayout, -sharerPayout],
      );
      expect(await f.escrow.totalWithdrawable()).to.equal(0n);
      await expectSolvent(f.escrow);
    });

    it("pays a receiver that needs more than the stipend through withdraw", async function () {
      const f = await loadFixture(deployEscrowFixture);
      const { actor, id } = await actorAsSharer(f, ActorMode.BurnGas);
      const actorAddress = await actor.getAddress();
      const sharerPayout = PRICE - FEE + SHARER_DEPOSIT;
      await time.increase(POLICIES.ecommerce.releaseDelay);

      await expect(f.escrow.connect(f.keeper).release(id))
        .to.emit(f.escrow, "PayoutDeferred")
        .withArgs(id, actorAddress, sharerPayout);
      // withdraw forwards all gas, so the same receiver now succeeds.
      await expect(actor.withdraw()).to.changeEtherBalance(actorAddress, sharerPayout);
      await expectSolvent(f.escrow);
    });

    it("keeps the credit when a withdrawal fails, and rejects empty withdrawals", async function () {
      const f = await loadFixture(deployEscrowFixture);
      const { actor, id } = await actorAsSharer(f, ActorMode.Refuse);
      const actorAddress = await actor.getAddress();
      await f.escrow.connect(f.seeker).confirmReceipt(id);
      const credit = await f.escrow.withdrawable(actorAddress);

      await expect(actor.withdraw())
        .to.be.revertedWithCustomError(f.escrow, "TransferFailed")
        .withArgs(actorAddress, credit);
      expect(await f.escrow.withdrawable(actorAddress)).to.equal(credit);
      await expect(f.escrow.connect(f.keeper).withdraw()).to.be.revertedWithCustomError(
        f.escrow,
        "NothingToWithdraw",
      );
    });

    it("never blocks settlement on a treasury that refuses fees", async function () {
      const f = await loadFixture(deployEscrowFixture);
      const treasuryActor = await deployActor(f, false);
      await treasuryActor.setMode(ActorMode.Refuse, "0x");
      await f.escrow.setTreasury(await treasuryActor.getAddress());
      const id = await listBuyForYou(f);
      await accept(f, id);
      await f.escrow.connect(f.sharer).markDelivered(id, PROOF_HASH);

      await expect(f.escrow.connect(f.seeker).confirmReceipt(id))
        .to.emit(f.escrow, "PayoutDeferred")
        .withArgs(id, await treasuryActor.getAddress(), FEE);
      expect((await f.escrow.getDeal(id)).status).to.equal(Status.Completed);
      await expectSolvent(f.escrow);
    });

    it("blocks re-entry from a pushed payout and still pays the receiver", async function () {
      const f = await loadFixture(deployEscrowFixture);
      const { actor, id } = await actorAsSharer(f, ActorMode.Accept);
      const actorAddress = await actor.getAddress();
      const other = await listBuyForYou(f); // a second deal the attacker tries to touch
      const encode = f.escrow.interface.encodeFunctionData.bind(f.escrow.interface);
      // Short calls fit inside the 30 000 gas stipend, so the guard (not gas) is what stops them.
      for (const reentryCall of [
        encode("withdraw"),
        encode("cancelListing", [other]),
        encode("release", [id]),
      ]) {
        await actor.setMode(ActorMode.Reenter, reentryCall);
        const snapshot = await ethers.provider.send("evm_snapshot", []);

        const tx = f.escrow.connect(f.seeker).confirmReceipt(id);
        await expect(tx).to.emit(actor, "ReentryAttempt").withArgs(false, REENTRANCY_SELECTOR);
        await expect(tx).not.to.emit(f.escrow, "PayoutDeferred");
        await expect(tx).to.changeEtherBalance(actorAddress, PRICE - FEE + SHARER_DEPOSIT);
        expect((await f.escrow.getDeal(other)).status).to.equal(Status.Listed);
        await expectSolvent(f.escrow);

        await ethers.provider.send("evm_revert", [snapshot]);
      }
    });

    it("blocks re-entry into every guarded function during withdraw, paying the credit once", async function () {
      const f = await loadFixture(deployEscrowFixture);
      const { actor, id } = await actorAsSharer(f, ActorMode.Refuse);
      const actorAddress = await actor.getAddress();
      await f.escrow.connect(f.seeker).confirmReceipt(id);
      const credit = await f.escrow.withdrawable(actorAddress);
      const other = await listBuyForYou(f);
      const encode = f.escrow.interface.encodeFunctionData.bind(f.escrow.interface);

      // withdraw forwards all gas, so only the ReentrancyGuard can stop these.
      for (const reentryCall of [
        encode("withdraw"),
        encode("createListing", [
          CATEGORY.ecommerce,
          PRICE,
          0,
          TERMS_HASH,
          ethers.ZeroHash,
          EMPTY_AUTH,
        ]),
        encode("cancelListing", [other]),
        encode("acceptListing", [other]),
        encode("confirmReceipt", [id]),
        encode("release", [id]),
        encode("claimTimeout", [id]),
        encode("resolveDispute", [id, 0, Party.None]),
        encode("defaultResolve", [id]),
      ]) {
        await actor.setMode(ActorMode.Reenter, reentryCall);
        const snapshot = await ethers.provider.send("evm_snapshot", []);

        const tx = actor.withdraw();
        await expect(tx).to.emit(actor, "ReentryAttempt").withArgs(false, REENTRANCY_SELECTOR);
        await expect(tx).to.changeEtherBalance(actorAddress, credit);
        expect(await f.escrow.withdrawable(actorAddress)).to.equal(0n);
        expect((await f.escrow.getDeal(other)).status).to.equal(Status.Listed);
        await expectSolvent(f.escrow);

        await ethers.provider.send("evm_revert", [snapshot]);
      }
    });
  });

  describe("8) pause", function () {
    it("blocks only new commitments", async function () {
      const f = await loadFixture(deployEscrowFixture);
      const listed = await listBuyForYou(f);

      await expect(f.escrow.pause()).to.emit(f.escrow, "Paused").withArgs(f.admin.address);
      await expect(listBuyForYou(f)).to.be.revertedWithCustomError(f.escrow, "EnforcedPause");
      await expect(listPassOn(f)).to.be.revertedWithCustomError(f.escrow, "EnforcedPause");
      await expect(accept(f, listed)).to.be.revertedWithCustomError(f.escrow, "EnforcedPause");

      await expect(f.escrow.unpause()).to.emit(f.escrow, "Unpaused").withArgs(f.admin.address);
      await expect(accept(f, listed)).to.emit(f.escrow, "DealLocked");
    });

    it("never blocks an exit or an in-flight step", async function () {
      const f = await loadFixture(deployEscrowFixture);
      const { escrow, sharer, seeker, arbiter, keeper } = f;

      const toCancel = await listBuyForYou(f);
      const toDeliver = await listBuyForYou(f);
      await accept(f, toDeliver);
      const toTimeOut = await listBuyForYou(f);
      await accept(f, toTimeOut);
      const toConfirm = await listBuyForYou(f);
      await accept(f, toConfirm);
      await escrow.connect(sharer).markDelivered(toConfirm, PROOF_HASH);
      const toDispute = await listBuyForYou(f);
      await accept(f, toDispute);
      await escrow.connect(sharer).markDelivered(toDispute, PROOF_HASH);
      const toResolve = await listBuyForYou(f);
      await accept(f, toResolve);
      await escrow.connect(sharer).markDelivered(toResolve, PROOF_HASH);
      await escrow.connect(seeker).raiseDispute(toResolve, EVIDENCE_HASH);
      const toDefault = await listBuyForYou(f);
      await accept(f, toDefault);
      await escrow.connect(sharer).markDelivered(toDefault, PROOF_HASH);
      await escrow.connect(seeker).raiseDispute(toDefault, EVIDENCE_HASH);
      const actor = await deployActor(f);
      await actor.setMode(ActorMode.Refuse, "0x");
      await actor.createListing(CATEGORY.ecommerce, PRICE, TERMS_HASH, { value: SHARER_DEPOSIT });
      const actorListing = await escrow.dealCount();
      await actor.cancelListing(actorListing); // deposit is deferred to withdrawable

      await escrow.pause();

      await expect(escrow.connect(sharer).cancelListing(toCancel)).to.emit(
        escrow,
        "ListingCancelled",
      );
      await expect(escrow.connect(sharer).markDelivered(toDeliver, PROOF_HASH)).to.emit(
        escrow,
        "Delivered",
      );
      await expect(escrow.connect(seeker).confirmReceipt(toConfirm)).to.emit(escrow, "Completed");
      await expect(escrow.connect(seeker).raiseDispute(toDispute, EVIDENCE_HASH)).to.emit(
        escrow,
        "DisputeRaised",
      );
      await expect(escrow.connect(sharer).addEvidence(toResolve, EVIDENCE_HASH)).to.emit(
        escrow,
        "EvidenceAdded",
      );
      await expect(escrow.connect(arbiter).resolveDispute(toResolve, 5_000, Party.None)).to.emit(
        escrow,
        "DisputeResolved",
      );
      await actor.setMode(ActorMode.Accept, "0x");
      await expect(actor.withdraw()).to.emit(escrow, "Withdrawn");

      await time.increase(POLICIES.ecommerce.deliveryWindow + MINUTE);
      await expect(escrow.connect(keeper).claimTimeout(toTimeOut)).to.emit(escrow, "Refunded");
      await expect(escrow.connect(keeper).release(toDeliver)).to.emit(escrow, "Completed");
      await time.increase(72n * HOUR);
      await expect(escrow.connect(keeper).defaultResolve(toDefault)).to.emit(
        escrow,
        "DisputeResolved",
      );
      await expectSolvent(escrow);
    });

    it("restricts pause and unpause to PAUSER_ROLE", async function () {
      const f = await loadFixture(deployEscrowFixture);
      const role = await f.escrow.PAUSER_ROLE();

      await expect(f.escrow.connect(f.outsider).pause())
        .to.be.revertedWithCustomError(f.escrow, "AccessControlUnauthorizedAccount")
        .withArgs(f.outsider.address, role);
      await f.escrow.pause();
      await expect(f.escrow.connect(f.arbiter).unpause())
        .to.be.revertedWithCustomError(f.escrow, "AccessControlUnauthorizedAccount")
        .withArgs(f.arbiter.address, role);
    });
  });

  describe("10) parameter bounds and roles", function () {
    it("bounds the fee at 5%", async function () {
      const f = await loadFixture(deployEscrowFixture);

      await expect(f.escrow.setFeeBps(500)).to.emit(f.escrow, "FeeBpsSet").withArgs(500);
      await expect(f.escrow.setFeeBps(501))
        .to.be.revertedWithCustomError(f.escrow, "FeeTooHigh")
        .withArgs(501);
    });

    it("bounds every deposit rate at 100%", async function () {
      const f = await loadFixture(deployEscrowFixture);

      await expect(f.escrow.setDepositBps([10_000, 10_000, 10_000], 10_000))
        .to.emit(f.escrow, "DepositBpsSet")
        .withArgs([10_000, 10_000, 10_000], 10_000);
      for (const sharerBps of [
        [10_001, 0, 0],
        [0, 10_001, 0],
        [0, 0, 10_001],
      ] as [number, number, number][]) {
        await expect(f.escrow.setDepositBps(sharerBps, 0))
          .to.be.revertedWithCustomError(f.escrow, "DepositBpsTooHigh")
          .withArgs(10_001);
      }
      await expect(f.escrow.setDepositBps([0, 0, 0], 10_001))
        .to.be.revertedWithCustomError(f.escrow, "DepositBpsTooHigh")
        .withArgs(10_001);
    });

    it("bounds the arbiter timeout between 1 minute and 30 days", async function () {
      const f = await loadFixture(deployEscrowFixture);

      for (const ok of [MINUTE, 30n * DAY]) {
        await expect(f.escrow.setArbiterTimeout(ok))
          .to.emit(f.escrow, "ArbiterTimeoutSet")
          .withArgs(ok);
      }
      for (const bad of [MINUTE - 1n, 30n * DAY + 1n]) {
        await expect(f.escrow.setArbiterTimeout(bad))
          .to.be.revertedWithCustomError(f.escrow, "ArbiterTimeoutOutOfBounds")
          .withArgs(bad);
      }
    });

    it("accepts policies on their bounds and rejects every out-of-bounds window", async function () {
      const f = await loadFixture(deployEscrowFixture);
      const category = 9;
      const base: PolicyConfig = POLICIES.ecommerce;
      const passOn: PolicyConfig = POLICIES.coupon;

      for (const ok of [
        { ...base, deliveryWindow: MINUTE, releaseDelay: MINUTE, disputeWindow: MINUTE },
        {
          ...base,
          deliveryWindow: 30n * DAY,
          releaseDelay: 90n * DAY,
          eventBuffer: 30n * DAY,
          disputeWindow: 30n * DAY,
        },
        { ...passOn, deliveryWindow: 0n },
      ]) {
        await expect(f.escrow.setPolicy(category, ok)).to.emit(f.escrow, "PolicySet");
      }
      expect((await f.escrow.getPolicy(category)).dealType).to.equal(DealType.PassOn);

      for (const bad of [
        { ...base, deliveryWindow: MINUTE - 1n },
        { ...base, deliveryWindow: 30n * DAY + 1n },
        { ...passOn, deliveryWindow: MINUTE },
        { ...base, releaseDelay: MINUTE - 1n },
        { ...base, releaseDelay: 90n * DAY + 1n },
        { ...base, eventBuffer: 30n * DAY + 1n },
        { ...base, disputeWindow: MINUTE - 1n },
        { ...base, disputeWindow: 30n * DAY + 1n },
      ]) {
        await expect(f.escrow.setPolicy(category, bad))
          .to.be.revertedWithCustomError(f.escrow, "InvalidPolicy")
          .withArgs(category);
      }
    });

    it("lets only DEFAULT_ADMIN_ROLE change the treasury, never to zero", async function () {
      const f = await loadFixture(deployEscrowFixture);

      await expect(f.escrow.setTreasury(ethers.ZeroAddress)).to.be.revertedWithCustomError(
        f.escrow,
        "ZeroAddress",
      );
      await expect(f.escrow.setTreasury(f.keeper.address))
        .to.emit(f.escrow, "TreasurySet")
        .withArgs(f.keeper.address);

      await f.escrow.grantRole(await f.escrow.POLICY_ADMIN_ROLE(), f.outsider.address);
      await expect(f.escrow.connect(f.outsider).setTreasury(f.outsider.address))
        .to.be.revertedWithCustomError(f.escrow, "AccessControlUnauthorizedAccount")
        .withArgs(f.outsider.address, await f.escrow.DEFAULT_ADMIN_ROLE());
    });

    it("restricts every policy setter to POLICY_ADMIN_ROLE and lets the admin delegate it", async function () {
      const f = await loadFixture(deployEscrowFixture);
      const role = await f.escrow.POLICY_ADMIN_ROLE();
      const asOutsider = f.escrow.connect(f.outsider);

      for (const call of [
        () => asOutsider.setPolicy(CATEGORY.ecommerce, POLICIES.ecommerce),
        () => asOutsider.setFeeBps(100),
        () => asOutsider.setDepositBps([1, 1, 1], 1),
        () => asOutsider.setArbiterTimeout(HOUR),
      ]) {
        await expect(call())
          .to.be.revertedWithCustomError(f.escrow, "AccessControlUnauthorizedAccount")
          .withArgs(f.outsider.address, role);
      }

      await f.escrow.grantRole(role, f.outsider.address);
      await expect(asOutsider.setFeeBps(100)).to.emit(f.escrow, "FeeBpsSet").withArgs(100);
    });
  });

  describe("input validation", function () {
    it("validates listings: policy, price, terms and the exact deposit", async function () {
      const f = await loadFixture(deployEscrowFixture);
      const asSharer = f.escrow.connect(f.sharer);
      const list = (category: number, price: bigint, terms: string, value: bigint) =>
        asSharer.createListing(category, price, 0, terms, ethers.ZeroHash, EMPTY_AUTH, { value });

      await expect(list(9, PRICE, TERMS_HASH, SHARER_DEPOSIT))
        .to.be.revertedWithCustomError(f.escrow, "PolicyInactive")
        .withArgs(9);
      await expect(list(CATEGORY.ecommerce, 0n, TERMS_HASH, 0n)).to.be.revertedWithCustomError(
        f.escrow,
        "InvalidPrice",
      );
      await expect(
        list(CATEGORY.ecommerce, 2n ** 128n, TERMS_HASH, 0n),
      ).to.be.revertedWithCustomError(f.escrow, "InvalidPrice");
      await expect(
        list(CATEGORY.ecommerce, PRICE, ethers.ZeroHash, SHARER_DEPOSIT),
      ).to.be.revertedWithCustomError(f.escrow, "TermsRequired");
      for (const value of [0n, SHARER_DEPOSIT - 1n, SHARER_DEPOSIT + 1n]) {
        await expect(list(CATEGORY.ecommerce, PRICE, TERMS_HASH, value))
          .to.be.revertedWithCustomError(f.escrow, "IncorrectPayment")
          .withArgs(SHARER_DEPOSIT, value);
      }
    });

    it("validates accepts: payment, self-dealing and status", async function () {
      const f = await loadFixture(deployEscrowFixture);
      const id = await listBuyForYou(f);
      const expected = PRICE + SEEKER_DEPOSIT;

      for (const value of [PRICE, expected + 1n]) {
        await expect(f.escrow.connect(f.seeker).acceptListing(id, { value }))
          .to.be.revertedWithCustomError(f.escrow, "IncorrectPayment")
          .withArgs(expected, value);
      }
      await expect(f.escrow.connect(f.sharer).acceptListing(id, { value: expected }))
        .to.be.revertedWithCustomError(f.escrow, "SharerCannotAccept")
        .withArgs(id);
      await accept(f, id);
      await expect(accept(f, id, f.carol))
        .to.be.revertedWithCustomError(f.escrow, "InvalidStatus")
        .withArgs(id, Status.Locked);
    });

    it("restricts each step to its party and its status", async function () {
      const f = await loadFixture(deployEscrowFixture);
      const id = await listBuyForYou(f);

      await expect(f.escrow.connect(f.sharer).markDelivered(id, PROOF_HASH))
        .to.be.revertedWithCustomError(f.escrow, "InvalidStatus")
        .withArgs(id, Status.Listed);
      await expect(f.escrow.connect(f.keeper).release(id))
        .to.be.revertedWithCustomError(f.escrow, "InvalidStatus")
        .withArgs(id, Status.Listed);
      await accept(f, id);
      await expect(f.escrow.connect(f.seeker).confirmReceipt(id))
        .to.be.revertedWithCustomError(f.escrow, "InvalidStatus")
        .withArgs(id, Status.Locked);
      await expect(f.escrow.connect(f.seeker).raiseDispute(id, EVIDENCE_HASH))
        .to.be.revertedWithCustomError(f.escrow, "InvalidStatus")
        .withArgs(id, Status.Locked);
      await expect(f.escrow.connect(f.seeker).markDelivered(id, PROOF_HASH))
        .to.be.revertedWithCustomError(f.escrow, "NotSharer")
        .withArgs(id, f.seeker.address);
      await expect(
        f.escrow.connect(f.sharer).markDelivered(id, ethers.ZeroHash),
      ).to.be.revertedWithCustomError(f.escrow, "ProofRequired");

      await f.escrow.connect(f.sharer).markDelivered(id, PROOF_HASH);
      await expect(f.escrow.connect(f.carol).confirmReceipt(id))
        .to.be.revertedWithCustomError(f.escrow, "NotSeeker")
        .withArgs(id, f.carol.address);
      await expect(f.escrow.connect(f.keeper).claimTimeout(id))
        .to.be.revertedWithCustomError(f.escrow, "InvalidStatus")
        .withArgs(id, Status.Delivered);
      await expect(f.escrow.connect(f.keeper).defaultResolve(id))
        .to.be.revertedWithCustomError(f.escrow, "InvalidStatus")
        .withArgs(id, Status.Delivered);
      await expect(f.escrow.connect(f.seeker).addEvidence(id, EVIDENCE_HASH))
        .to.be.revertedWithCustomError(f.escrow, "InvalidStatus")
        .withArgs(id, Status.Delivered);
    });

    it("reverts with DealNotFound for unknown ids on every entry point", async function () {
      const f = await loadFixture(deployEscrowFixture);
      const asSeeker = f.escrow.connect(f.seeker);
      const missing = 42n;

      for (const call of [
        () => asSeeker.cancelListing(missing),
        () => asSeeker.acceptListing(missing, { value: PRICE }),
        () => asSeeker.markDelivered(missing, PROOF_HASH),
        () => asSeeker.confirmReceipt(missing),
        () => asSeeker.release(missing),
        () => asSeeker.claimTimeout(missing),
        () => asSeeker.raiseDispute(missing, EVIDENCE_HASH),
        () => asSeeker.addEvidence(missing, EVIDENCE_HASH),
        () => f.escrow.connect(f.arbiter).resolveDispute(missing, 0, Party.None),
        () => asSeeker.defaultResolve(missing),
      ]) {
        await expect(call())
          .to.be.revertedWithCustomError(f.escrow, "DealNotFound")
          .withArgs(missing);
      }
    });

    it("rejects plain transfers and unknown calls", async function () {
      const f = await loadFixture(deployEscrowFixture);
      const to = await f.escrow.getAddress();

      await expect(f.keeper.sendTransaction({ to, value: 1n })).to.be.revertedWithCustomError(
        f.escrow,
        "DirectPaymentRejected",
      );
      await expect(
        f.keeper.sendTransaction({ to, data: "0xdeadbeef", value: 1n }),
      ).to.be.revertedWithCustomError(f.escrow, "DirectPaymentRejected");
      await expect(
        f.keeper.sendTransaction({ to, data: "0xdeadbeef" }),
      ).to.be.revertedWithCustomError(f.escrow, "DirectPaymentRejected");
      await expectSolvent(f.escrow);
    });
  });
});
