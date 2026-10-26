import { expect } from "chai";
import { ethers } from "hardhat";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import type { RelayEscrow, ReputationSBT } from "../../typechain-types";
import type { IRelayEscrow } from "../../typechain-types/contracts/RelayEscrow";

export const MINUTE = 60n;
export const HOUR = 60n * MINUTE;
export const DAY = 24n * HOUR;

/** Category ids used by the tests (mirrors the H5 configuration). */
export const CATEGORY = {
  ecommerce: 0,
  travel: 1,
  coupon: 5,
} as const;

export enum DealType {
  BuyForYou = 0,
  PassOn = 1,
}

export enum Status {
  Listed = 0,
  Locked = 1,
  Delivered = 2,
  Completed = 3,
  Refunded = 4,
  Disputed = 5,
  Resolved = 6,
  Cancelled = 7,
}

export enum Party {
  None = 0,
  Sharer = 1,
  Seeker = 2,
}

export enum NextAction {
  None = 0,
  Wait = 1,
  Accept = 2,
  Cancel = 3,
  MarkDelivered = 4,
  ConfirmOrDispute = 5,
  Release = 6,
  ClaimRefund = 7,
  AddEvidence = 8,
  Resolve = 9,
  DefaultResolve = 10,
}

/** Tier limits at the demo rate 1 tMSTC = Rs 1,00,000: Rs 500 / Rs 2,000 / Rs 10,000. */
export const TIER_LIMITS: [bigint, bigint, bigint] = [
  ethers.parseEther("0.005"),
  ethers.parseEther("0.02"),
  ethers.parseEther("0.1"),
];
export const RELAY_POINT_UNIT = 10n ** 14n;
/** Rs 400, inside the New-tier limit. */
export const PRICE = ethers.parseEther("0.004");
export const TERMS_HASH = ethers.id("terms: Rs 400 off with Bank A card, delivered to the seeker");
export const PROOF_HASH = ethers.id("order 402-1234567 + salt");
export const EVIDENCE_HASH = ethers.id("evidence bundle v1");

/** A category policy with concrete types (assignable to the contract's PolicyStruct). */
export interface PolicyConfig {
  dealType: DealType;
  deliveryWindow: bigint;
  releaseDelay: bigint;
  eventBuffer: bigint;
  disputeWindow: bigint;
  active: boolean;
}

export const POLICIES: Record<keyof typeof CATEGORY, PolicyConfig> = {
  ecommerce: {
    dealType: DealType.BuyForYou,
    deliveryWindow: 3n * MINUTE,
    releaseDelay: 2n * MINUTE,
    eventBuffer: 0n,
    disputeWindow: 10n * MINUTE,
    active: true,
  },
  travel: {
    dealType: DealType.BuyForYou,
    deliveryWindow: 3n * MINUTE,
    releaseDelay: 2n * MINUTE,
    eventBuffer: 30n * MINUTE,
    disputeWindow: 10n * MINUTE,
    active: true,
  },
  coupon: {
    dealType: DealType.PassOn,
    deliveryWindow: 0n,
    releaseDelay: 2n * MINUTE,
    eventBuffer: 0n,
    disputeWindow: 10n * MINUTE,
    active: true,
  },
};

export const EMPTY_AUTH: IRelayEscrow.ListingAuthorizationStruct = {
  nonce: 0n,
  deadline: 0n,
  signature: "0x",
};

export interface EscrowFixture {
  sbt: ReputationSBT;
  escrow: RelayEscrow;
  admin: HardhatEthersSigner;
  verifier: HardhatEthersSigner;
  arbiter: HardhatEthersSigner;
  treasury: HardhatEthersSigner;
  sharer: HardhatEthersSigner;
  seeker: HardhatEthersSigner;
  carol: HardhatEthersSigner;
  outsider: HardhatEthersSigner;
  keeper: HardhatEthersSigner;
  others: HardhatEthersSigner[];
}

/**
 * Deploys the badge and the escrow exactly as the H5 scripts will: escrow holds ESCROW_ROLE on the
 * badge, the verifier mints and signs, the arbiter rules. Sharer, seeker and carol hold badges.
 */
export async function deployEscrowFixture(): Promise<EscrowFixture> {
  const [admin, verifier, arbiter, treasury, sharer, seeker, carol, outsider, keeper, ...others] =
    await ethers.getSigners();

  const sbt = await ethers.deployContract("ReputationSBT", [admin.address, RELAY_POINT_UNIT]);
  const escrow = await ethers.deployContract("RelayEscrow", [
    await sbt.getAddress(),
    treasury.address,
    verifier.address,
    admin.address,
  ]);

  await sbt.grantRole(await sbt.ESCROW_ROLE(), await escrow.getAddress());
  await sbt.grantRole(await sbt.VERIFIER_ROLE(), verifier.address);
  await sbt.setTierLimits(TIER_LIMITS);
  await escrow.grantRole(await escrow.ARBITER_ROLE(), arbiter.address);
  for (const [name, policy] of Object.entries(POLICIES)) {
    await escrow.setPolicy(CATEGORY[name as keyof typeof CATEGORY], policy);
  }
  for (const user of [sharer, seeker, carol]) {
    await sbt.connect(verifier).mint(user.address);
  }

  return {
    sbt,
    escrow,
    admin,
    verifier,
    arbiter,
    treasury,
    sharer,
    seeker,
    carol,
    outsider,
    keeper,
    others,
  };
}

/** Signs an EIP-712 ListingAuth; `domain` overrides let tests forge other chains or contracts. */
export async function signListingAuth(
  escrow: RelayEscrow,
  signer: HardhatEthersSigner,
  sharer: string,
  fingerprint: string,
  nonce: bigint,
  deadline: bigint,
  domain: { chainId?: bigint; verifyingContract?: string } = {},
): Promise<IRelayEscrow.ListingAuthorizationStruct> {
  const signature = await signer.signTypedData(
    {
      name: "RewardRelay",
      version: "1",
      chainId: domain.chainId ?? (await ethers.provider.getNetwork()).chainId,
      verifyingContract: domain.verifyingContract ?? (await escrow.getAddress()),
    },
    {
      ListingAuth: [
        { name: "sharer", type: "address" },
        { name: "fingerprint", type: "bytes32" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    },
    { sharer, fingerprint, nonce, deadline },
  );
  return { nonce, deadline, signature };
}

export async function latestTime(): Promise<bigint> {
  const block = await ethers.provider.getBlock("latest");
  return BigInt(block!.timestamp);
}

/** Creates a Buy-for-you listing with the exact required deposit; returns the new deal id. */
export async function listBuyForYou(
  f: EscrowFixture,
  opts: {
    category?: number;
    price?: bigint;
    eventTime?: bigint;
    sharer?: HardhatEthersSigner;
  } = {},
): Promise<bigint> {
  const sharer = opts.sharer ?? f.sharer;
  const price = opts.price ?? PRICE;
  const deposit = await f.escrow.requiredSharerDeposit(sharer.address, price);
  await f.escrow
    .connect(sharer)
    .createListing(
      opts.category ?? CATEGORY.ecommerce,
      price,
      opts.eventTime ?? 0n,
      TERMS_HASH,
      ethers.ZeroHash,
      EMPTY_AUTH,
      { value: deposit },
    );
  return f.escrow.dealCount();
}

/** Creates a Pass-on listing authorised by the verifier; returns the deal id and fingerprint. */
export async function listPassOn(
  f: EscrowFixture,
  opts: { code?: string; price?: bigint; sharer?: HardhatEthersSigner } = {},
): Promise<{ id: bigint; fingerprint: string }> {
  const sharer = opts.sharer ?? f.sharer;
  const price = opts.price ?? PRICE;
  const fingerprint = ethers.id(opts.code ?? "SCRATCH-CARD-CODE-1");
  const nonce = await f.escrow.nonces(sharer.address);
  const auth = await signListingAuth(
    f.escrow,
    f.verifier,
    sharer.address,
    fingerprint,
    nonce,
    (await latestTime()) + HOUR,
  );
  const deposit = await f.escrow.requiredSharerDeposit(sharer.address, price);
  await f.escrow
    .connect(sharer)
    .createListing(CATEGORY.coupon, price, 0n, TERMS_HASH, fingerprint, auth, { value: deposit });
  return { id: await f.escrow.dealCount(), fingerprint };
}

/** Accepts deal `id` paying exactly price + seeker deposit. */
export async function accept(f: EscrowFixture, id: bigint, seeker = f.seeker) {
  const deal = await f.escrow.getDeal(id);
  return f.escrow.connect(seeker).acceptListing(id, { value: deal.price + deal.seekerDeposit });
}

/** Asserts the solvency invariant I1 and that the books match the contract balance. */
export async function expectSolvent(escrow: RelayEscrow) {
  expect(await escrow.solvencyDelta()).to.equal(0n);
  const balance = await ethers.provider.getBalance(await escrow.getAddress());
  expect(balance).to.equal((await escrow.totalEscrowed()) + (await escrow.totalWithdrawable()));
}
