import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import type { ContractTransactionResponse } from "ethers";
import type { EscrowActor } from "../typechain-types";
import {
  CATEGORY,
  DAY,
  DealType,
  HOUR,
  MINUTE,
  Party,
  Status,
  TERMS_HASH,
  deployEscrowFixture,
  latestTime,
  signListingAuth,
} from "./helpers/escrow";

/**
 * Randomised invariant run. A seeded PRNG drives listings, accepts, deliveries, confirmations,
 * releases, timeouts, disputes, rulings, cancellations, withdrawals and clock jumps across six badge
 * holders and one contract that refuses payments half of the time. After every step:
 *   I1  solvencyDelta() == 0 and balance == totalEscrowed + totalWithdrawable
 *   I2  totalEscrowed == sum of what open deals hold
 *   I3  totalWithdrawable == sum of withdrawable balances
 *   I4  every deal's status is unchanged or moved along an allowed edge for its deal type
 * Reproduce a run with INVARIANT_SEED=<n> INVARIANT_STEPS=<n> npm run contracts:test.
 */

const DEFAULT_SEED = 20261027;
const SEED = Number(process.env.INVARIANT_SEED ?? DEFAULT_SEED);
const STEPS = Number(process.env.INVARIANT_STEPS ?? 300);
const MAX_DEALS = 60;

/** mulberry32: small, fast, deterministic. */
function prng(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)),
    pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)],
  };
}

const ALLOWED: Record<Status, Status[]> = {
  [Status.Listed]: [Status.Locked, Status.Delivered, Status.Cancelled],
  [Status.Locked]: [Status.Delivered, Status.Refunded],
  [Status.Delivered]: [Status.Completed, Status.Disputed],
  [Status.Disputed]: [Status.Completed, Status.Resolved],
  [Status.Completed]: [],
  [Status.Refunded]: [],
  [Status.Resolved]: [],
  [Status.Cancelled]: [],
};

type Participant =
  | { kind: "eoa"; address: string; signer: HardhatEthersSigner }
  | { kind: "actor"; address: string; actor: EscrowActor };

interface TrackedDeal {
  id: bigint;
  type: DealType;
  status: Status;
}

const OPS = [
  "createBuyForYou",
  "createPassOn",
  "cancel",
  "accept",
  "deliver",
  "confirm",
  "release",
  "claimTimeout",
  "dispute",
  "evidence",
  "resolve",
  "defaultResolve",
  "withdraw",
  "toggleActor",
  "wait",
] as const;
type Op = (typeof OPS)[number];
/** Deal statuses an op needs (any one of them); ops without an entry are always applicable. */
const NEEDS: Partial<Record<Op, Status[]>> = {
  cancel: [Status.Listed],
  accept: [Status.Listed],
  deliver: [Status.Locked],
  claimTimeout: [Status.Locked],
  confirm: [Status.Delivered, Status.Disputed],
  release: [Status.Delivered],
  dispute: [Status.Delivered],
  evidence: [Status.Disputed],
  resolve: [Status.Disputed],
  defaultResolve: [Status.Disputed],
};

const WEIGHTS: Record<Op, number> = {
  createBuyForYou: 9,
  createPassOn: 5,
  cancel: 2,
  accept: 12,
  deliver: 9,
  confirm: 7,
  release: 7,
  claimTimeout: 5,
  dispute: 5,
  evidence: 2,
  resolve: 6,
  defaultResolve: 3,
  withdraw: 6,
  toggleActor: 3,
  wait: 10,
};

describe("RelayEscrow randomized invariants", function () {
  it(`keeps solvency, accounting and the state machine intact (seed ${SEED}, ${STEPS} steps)`, async function () {
    this.timeout(600_000);
    const f = await loadFixture(deployEscrowFixture);
    const { escrow, sbt, verifier, arbiter, keeper } = f;
    const rand = prng(SEED);

    await escrow.setArbiterTimeout(30n * MINUTE); // reachable default rulings within the run

    const extra = f.others.slice(0, 3);
    for (const signer of extra) await sbt.connect(verifier).mint(signer.address);
    const actor = await ethers.deployContract("EscrowActor", [await escrow.getAddress()]);
    await sbt.connect(verifier).mint(await actor.getAddress());

    const eoas: Participant[] = [f.sharer, f.seeker, f.carol, ...extra].map((signer) => ({
      kind: "eoa",
      address: signer.address,
      signer,
    }));
    const participants: Participant[] = [
      ...eoas,
      { kind: "actor", address: await actor.getAddress(), actor },
    ];
    const byAddress = new Map(participants.map((p) => [p.address, p]));
    const creditHolders = [...participants.map((p) => p.address), f.treasury.address];

    const deals: TrackedDeal[] = [];
    const executed: Partial<Record<Op, number>> = {};
    let reverted = 0;
    let codeCounter = 0;
    let actorRefuses = true;
    await actor.setMode(1, "0x"); // starts by refusing payments, so payouts get deferred
    const actorParticipant = participants[participants.length - 1];
    /** The refusing contract takes part in 30% of Buy-for-you roles. */
    const pickParty = (exclude?: string) => {
      const pool = participants.filter((p) => p.address !== exclude);
      return rand.next() < 0.3 && actorParticipant.address !== exclude
        ? actorParticipant
        : rand.pick(pool.filter((p) => p.kind === "eoa"));
    };

    const pickDeal = (...statuses: Status[]) => {
      const candidates = deals.filter((d) => statuses.includes(d.status));
      return candidates.length ? rand.pick(candidates) : undefined;
    };
    const participantOf = (address: string) => byAddress.get(address)!;

    async function create(type: DealType): Promise<ContractTransactionResponse | undefined> {
      if (deals.length >= MAX_DEALS) return undefined;
      const sharer = type === DealType.PassOn ? rand.pick(eoas) : pickParty();
      const price = BigInt(rand.int(1, 50)) * 10n ** 14n; // 0.0001 .. 0.005 MSTC
      const deposit = await escrow.requiredSharerDeposit(sharer.address, price);

      if (type === DealType.PassOn && sharer.kind === "eoa") {
        const fingerprint = ethers.id(`invariant-code-${codeCounter++}`);
        const auth = await signListingAuth(
          escrow,
          verifier,
          sharer.address,
          fingerprint,
          await escrow.nonces(sharer.address),
          (await latestTime()) + HOUR,
        );
        return escrow
          .connect(sharer.signer)
          .createListing(CATEGORY.coupon, price, 0, TERMS_HASH, fingerprint, auth, {
            value: deposit,
          });
      }
      const travel = rand.next() < 0.3;
      if (sharer.kind === "actor") {
        return sharer.actor.createListing(CATEGORY.ecommerce, price, TERMS_HASH, {
          value: deposit,
        });
      }
      const eventTime = travel ? (await latestTime()) + BigInt(rand.int(10, 120)) * MINUTE : 0n;
      return escrow
        .connect(sharer.signer)
        .createListing(
          travel ? CATEGORY.travel : CATEGORY.ecommerce,
          price,
          eventTime,
          TERMS_HASH,
          ethers.ZeroHash,
          { nonce: 0n, deadline: 0n, signature: "0x" },
          { value: deposit },
        );
    }

    async function run(op: Op): Promise<ContractTransactionResponse | undefined> {
      switch (op) {
        case "createBuyForYou":
          return create(DealType.BuyForYou);
        case "createPassOn":
          return create(DealType.PassOn);
        case "cancel": {
          const deal = pickDeal(Status.Listed);
          if (!deal) return undefined;
          const sharer = participantOf((await escrow.getDeal(deal.id)).sharer);
          return sharer.kind === "actor"
            ? sharer.actor.cancelListing(deal.id)
            : escrow.connect(sharer.signer).cancelListing(deal.id);
        }
        case "accept": {
          const deal = pickDeal(Status.Listed);
          if (!deal) return undefined;
          const onChain = await escrow.getDeal(deal.id);
          const seeker = pickParty(onChain.sharer);
          const value = onChain.price + onChain.seekerDeposit;
          return seeker.kind === "actor"
            ? seeker.actor.acceptListing(deal.id, { value })
            : escrow.connect(seeker.signer).acceptListing(deal.id, { value });
        }
        case "deliver": {
          const deal = pickDeal(Status.Locked);
          if (!deal) return undefined;
          const sharer = participantOf((await escrow.getDeal(deal.id)).sharer);
          const proof = ethers.id(`proof-${deal.id}`);
          return sharer.kind === "actor"
            ? sharer.actor.markDelivered(deal.id, proof)
            : escrow.connect(sharer.signer).markDelivered(deal.id, proof);
        }
        case "confirm": {
          const deal = pickDeal(Status.Delivered, Status.Disputed);
          if (!deal) return undefined;
          const seeker = participantOf((await escrow.getDeal(deal.id)).seeker);
          return seeker.kind === "actor"
            ? seeker.actor.confirmReceipt(deal.id)
            : escrow.connect(seeker.signer).confirmReceipt(deal.id);
        }
        case "release": {
          const deal = pickDeal(Status.Delivered);
          return deal && escrow.connect(keeper).release(deal.id);
        }
        case "claimTimeout": {
          const deal = pickDeal(Status.Locked);
          return deal && escrow.connect(keeper).claimTimeout(deal.id);
        }
        case "dispute": {
          const deal = pickDeal(Status.Delivered);
          if (!deal) return undefined;
          const seeker = participantOf((await escrow.getDeal(deal.id)).seeker);
          const evidence = ethers.id(`evidence-${deal.id}`);
          return seeker.kind === "actor"
            ? seeker.actor.raiseDispute(deal.id, evidence)
            : escrow.connect(seeker.signer).raiseDispute(deal.id, evidence);
        }
        case "evidence": {
          const deal = pickDeal(Status.Disputed);
          if (!deal) return undefined;
          const onChain = await escrow.getDeal(deal.id);
          const party = participantOf(rand.pick([onChain.sharer, onChain.seeker]));
          if (party.kind === "actor") return undefined; // the actor has no addEvidence passthrough
          return escrow.connect(party.signer).addEvidence(deal.id, ethers.id(`more-${deal.id}`));
        }
        case "resolve": {
          const deal = pickDeal(Status.Disputed);
          const fault = rand.pick([Party.None, Party.Sharer, Party.Seeker]);
          return (
            deal && escrow.connect(arbiter).resolveDispute(deal.id, rand.int(0, 10_000), fault)
          );
        }
        case "defaultResolve": {
          const deal = pickDeal(Status.Disputed);
          return deal && escrow.connect(keeper).defaultResolve(deal.id);
        }
        case "withdraw": {
          const holders: Participant[] = [];
          for (const p of participants) {
            if ((await escrow.withdrawable(p.address)) > 0n) holders.push(p);
          }
          if (!holders.length) return undefined;
          const holder = rand.pick(holders);
          return holder.kind === "actor"
            ? holder.actor.withdraw()
            : escrow.connect(holder.signer).withdraw();
        }
        case "toggleActor":
          actorRefuses = !actorRefuses;
          return actor.setMode(actorRefuses ? 1 : 0, "0x");
        case "wait": {
          const roll = rand.next();
          const jump =
            roll < 0.05
              ? DAY
              : roll < 0.15
                ? HOUR
                : BigInt(roll < 0.4 ? rand.int(120, 300) : rand.int(10, 90));
          await time.increase(jump);
          return undefined;
        }
      }
    }

    async function checkInvariants(step: number, op: Op) {
      const where = `step ${step} (${op})`;
      expect(await escrow.solvencyDelta(), `${where}: solvencyDelta`).to.equal(0n);

      const count = await escrow.dealCount();
      for (let id = BigInt(deals.length) + 1n; id <= count; id++) {
        const onChain = await escrow.getDeal(id);
        deals.push({ id, type: Number(onChain.policy.dealType), status: Status.Listed });
      }

      let held = 0n;
      for (const deal of deals) {
        const onChain = await escrow.getDeal(deal.id);
        const next = Number(onChain.status) as Status;
        if (next !== deal.status) {
          expect(
            ALLOWED[deal.status],
            `${where}: deal ${deal.id} ${deal.status}→${next}`,
          ).to.include(next);
          if (deal.status === Status.Listed) {
            expect(next, `${where}: deal ${deal.id} accept edge`).to.not.equal(
              deal.type === DealType.BuyForYou ? Status.Delivered : Status.Locked,
            );
          }
          deal.status = next;
        }
        if (next === Status.Listed) held += onChain.sharerDeposit;
        else if (next === Status.Locked || next === Status.Delivered || next === Status.Disputed) {
          held += onChain.price + onChain.sharerDeposit + onChain.seekerDeposit;
        }
      }
      const totalEscrowed = await escrow.totalEscrowed();
      expect(totalEscrowed, `${where}: totalEscrowed == Σ held`).to.equal(held);

      let credits = 0n;
      for (const address of creditHolders) credits += await escrow.withdrawable(address);
      const totalWithdrawable = await escrow.totalWithdrawable();
      expect(totalWithdrawable, `${where}: totalWithdrawable == Σ withdrawable`).to.equal(credits);
      expect(
        await ethers.provider.getBalance(await escrow.getAddress()),
        `${where}: balance`,
      ).to.equal(totalEscrowed + totalWithdrawable);
    }

    for (let step = 1; step <= STEPS; step++) {
      // Weighted pick among the ops that have something to act on right now.
      const present = new Set(deals.map((d) => d.status));
      const applicable = OPS.filter((candidate) => {
        if (candidate.startsWith("create")) return deals.length < MAX_DEALS;
        const needs = NEEDS[candidate];
        return !needs || needs.some((status) => present.has(status));
      });
      let roll = rand.next() * applicable.reduce((sum, op) => sum + WEIGHTS[op], 0);
      const op = applicable.find((candidate) => (roll -= WEIGHTS[candidate]) < 0) ?? "wait";
      try {
        const tx = await run(op);
        if (tx) {
          await tx.wait();
          executed[op] = (executed[op] ?? 0) + 1;
        }
      } catch {
        reverted++; // e.g. release before releaseAt: a guarded no-op, still checked below
      }
      await checkInvariants(step, op);
    }

    const finalStatuses = deals.reduce<Record<string, number>>((acc, deal) => {
      const name = Status[deal.status];
      acc[name] = (acc[name] ?? 0) + 1;
      return acc;
    }, {});
    console.log(
      `      seed ${SEED}: ${STEPS} steps, ${deals.length} deals, ${reverted} guarded reverts`,
      `\n      executed: ${JSON.stringify(executed)}`,
      `\n      final statuses: ${JSON.stringify(finalStatuses)}`,
      `\n      deferred payouts outstanding: ${await escrow.totalWithdrawable()} wei`,
    );

    if (SEED === DEFAULT_SEED && STEPS >= 300) {
      // The default run must actually explore the state space, not just stay solvent.
      for (const terminal of ["Completed", "Refunded", "Resolved", "Cancelled"]) {
        expect(finalStatuses[terminal] ?? 0, `default run reaches ${terminal}`).to.be.greaterThan(
          0,
        );
      }
      expect(executed.withdraw ?? 0, "default run exercises withdraw").to.be.greaterThan(0);
    }
  });
});
