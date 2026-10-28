import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import {
  PRICE,
  PROOF_HASH,
  POLICIES,
  Status,
  accept,
  deployEscrowFixture,
  expectSolvent,
  listBuyForYou,
  listPassOn,
} from "./helpers/escrow";

describe("RelayEscrow smoke", function () {
  it("settles a Buy-for-you and a Pass-on deal with solvencyDelta() == 0 after every step", async function () {
    const f = await loadFixture(deployEscrowFixture);
    const { escrow, sharer, seeker, keeper, treasury } = f;
    const treasuryBefore = await ethers.provider.getBalance(treasury.address);
    await expectSolvent(escrow);

    // Buy-for-you: list → accept → deliver → release by a keeper after releaseAt.
    const buyId = await listBuyForYou(f);
    await expectSolvent(escrow);
    await accept(f, buyId);
    await expectSolvent(escrow);
    expect((await escrow.getDeal(buyId)).status).to.equal(Status.Locked);
    await escrow.connect(sharer).markDelivered(buyId, PROOF_HASH);
    await expectSolvent(escrow);
    await time.increase(POLICIES.ecommerce.releaseDelay);
    await escrow.connect(keeper).release(buyId);
    await expectSolvent(escrow);
    expect((await escrow.getDeal(buyId)).status).to.equal(Status.Completed);

    // Pass-on: verifier-authorised listing → accept (delivered at once) → seeker confirms.
    const { id: passId } = await listPassOn(f);
    await expectSolvent(escrow);
    await accept(f, passId);
    await expectSolvent(escrow);
    expect((await escrow.getDeal(passId)).status).to.equal(Status.Delivered);
    await escrow.connect(seeker).confirmReceipt(passId);
    await expectSolvent(escrow);
    expect((await escrow.getDeal(passId)).status).to.equal(Status.Completed);

    // Nothing is left behind, and the treasury earned 2% of both prices.
    expect(await escrow.totalEscrowed()).to.equal(0n);
    expect(await escrow.totalWithdrawable()).to.equal(0n);
    expect(await ethers.provider.getBalance(await escrow.getAddress())).to.equal(0n);
    expect((await ethers.provider.getBalance(treasury.address)) - treasuryBefore).to.equal(
      (2n * PRICE * 200n) / 10_000n,
    );
  });
});
