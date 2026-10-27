import "server-only";
import { randomUUID } from "crypto";
import { getAbiItem, getAddress, type AbiEvent, type Hex } from "viem";
import { DealStatus, relayEscrowAbi } from "rewardrelay-shared";
import {
  escrowDeployBlock,
  explorerTxUrl,
  publicClient,
  readDeal,
  readDealEvents,
  readDeals,
} from "../chain";
import { keyring } from "../crypto";
import { logAccess } from "../deals/access";
import { syncDealIndex } from "../deals/dealIndex";
import { pathOf, privateDocs } from "../deals/privateDocs";
import { proofDocSchema } from "../deals/proof";
import { readDealOrThrow } from "../deals/read";
import { serverEnv } from "../env";
import { AppError } from "../errors";
import { storeFor } from "../files/store";
import { errorFields, log } from "../log";
import { repos } from "../repositories";
import { txManager } from "../signer";
import { dealIdParam } from "../validation/common";
import { buildDealView, type DealView } from "../views/deal";
import { evidenceAad, type EvidenceBundle } from "./evidence";
import { suggestRuling, type FaultParty, type RulingSuggestion } from "./rulebook";

/**
 * The arbiter's desk (ADMIN_UIDS only): open disputes are discovered from on-chain DisputeRaised
 * events (not from Firestore), each re-read from the chain, with both parties' decrypted evidence,
 * which evidence hashes were actually committed on-chain, the order proof and a rulebook suggestion.
 * A ruling is executed by the ARBITER signer and recorded in an append-only audit collection.
 */

const PARTY_CODE: Record<FaultParty, number> = { None: 0, Sharer: 1, Seeker: 2 };

export interface EvidenceItemView {
  party: "sharer" | "seeker";
  claim: string;
  text: string;
  evidenceHash: Hex;
  committedOnChain: boolean;
  files: { fileId: string; contentType: string; size: number; path: string }[];
  at: string;
}

export interface AdminDisputeView {
  dealId: string;
  deal: DealView;
  evidence: EvidenceItemView[];
  onChainEvidence: {
    party: "sharer" | "seeker";
    evidenceHash: Hex;
    txUrl: string;
    matched: boolean;
  }[];
  proof: {
    submitted: boolean;
    matchesChain: boolean;
    orderId: string | null;
    notes: string | null;
  };
  codeRevealedAt: string | null;
  suggestion: RulingSuggestion;
}

async function disputedDealIds(): Promise<bigint[]> {
  const logs = await publicClient().getLogs({
    address: serverEnv().ESCROW_ADDRESS,
    event: getAbiItem({ abi: relayEscrowAbi, name: "DisputeRaised" }) as AbiEvent,
    fromBlock: escrowDeployBlock(),
    toBlock: "latest",
  });
  const ids = new Set<bigint>();
  for (const entry of logs) ids.add(BigInt(entry.topics[1] as Hex));
  return [...ids].sort((a, b) => (a < b ? -1 : 1));
}

async function disputeView(id: bigint, adminUid: string): Promise<AdminDisputeView> {
  const dealId = id.toString();
  const deal = await readDeal(id);
  const sharer = getAddress(deal.sharer);
  const [view, events, dispute, proof, vault] = await Promise.all([
    buildDealView(id, null, deal),
    readDealEvents(id),
    repos.disputes.get(dealId),
    privateDocs(dealId, proofDocSchema).get("proof"),
    deal.policy.dealType === 1 ? repos.vault.get(deal.codeFingerprint) : Promise.resolve(undefined),
  ]);

  const onChain = events
    .filter((event) => event.name === "DisputeRaised" || event.name === "EvidenceAdded")
    .map((event) => {
      const by = getAddress((event.args.seeker ?? event.args.party) as string);
      return {
        party: (by === sharer ? "sharer" : "seeker") as "sharer" | "seeker",
        evidenceHash: event.args.evidenceHash as Hex,
        txUrl: explorerTxUrl(event.transactionHash),
      };
    });
  const committed = new Set(onChain.map((item) => item.evidenceHash.toLowerCase()));

  const ring = keyring();
  const evidence: EvidenceItemView[] = (dispute?.evidence ?? []).map((item) => {
    const bundle = ring.decryptJson<EvidenceBundle>(
      item.bundle,
      evidenceAad(dealId, item.evidenceHash as Hex),
    );
    return {
      party: item.party,
      claim: item.claim,
      text: bundle.text,
      evidenceHash: item.evidenceHash as Hex,
      committedOnChain: committed.has(item.evidenceHash.toLowerCase()),
      files: item.files.map((file) => ({
        fileId: file.fileId,
        contentType: file.contentType,
        size: file.size,
        path: `/api/admin/disputes/${dealId}/files/${file.fileId}`,
      })),
      at: new Date(item.at).toISOString(),
    };
  });
  const offChain = new Set(evidence.map((item) => item.evidenceHash.toLowerCase()));

  const proofMatchesChain = Boolean(
    proof && proof.proofHash.toLowerCase() === deal.proofHash.toLowerCase(),
  );
  const suggestion = suggestRuling({
    dealType: deal.policy.dealType === 0 ? "BuyForYou" : "PassOn",
    proofMatchesChain,
    seekerEvidence: evidence.filter((item) => item.party === "seeker" && item.committedOnChain),
  });

  await logAccess(dealId, adminUid, "evidence", "admin");
  return {
    dealId,
    deal: view,
    evidence,
    onChainEvidence: onChain.map((item) => ({
      ...item,
      matched: offChain.has(item.evidenceHash.toLowerCase()),
    })),
    proof: {
      submitted: Boolean(proof),
      matchesChain: proofMatchesChain,
      orderId: proof
        ? ring.decrypt(proof.orderId, pathOf(dealId, "proof", "orderId")).toString("utf8")
        : null,
      notes: proof?.notes
        ? ring.decrypt(proof.notes, pathOf(dealId, "proof", "notes")).toString("utf8")
        : null,
    },
    codeRevealedAt: vault?.revealedAt ? new Date(vault.revealedAt).toISOString() : null,
    suggestion,
  };
}

/** Every deal whose on-chain status is Disputed right now. */
export async function listOpenDisputes(adminUid: string): Promise<{ items: AdminDisputeView[] }> {
  const ids = await disputedDealIds();
  const deals = await readDeals(ids);
  const open = ids.filter((_, index) => deals[index]?.status === DealStatus.Disputed);
  const items: AdminDisputeView[] = [];
  for (const id of open) {
    try {
      items.push(await disputeView(id, adminUid));
    } catch (error) {
      log("error", "admin.dispute_view_failed", { dealId: id.toString(), ...errorFields(error) });
    }
  }
  return { items };
}

export async function readEvidenceFile(
  adminUid: string,
  idParam: string | undefined,
  fileId: string | undefined,
) {
  const dealId = dealIdParam(idParam).toString();
  const dispute = await repos.disputes.get(dealId);
  const file = dispute?.evidence
    .flatMap((item) => item.files)
    .find((entry) => entry.fileId === fileId);
  if (!file) throw new AppError("NOT_FOUND", { message: "No such evidence file." });
  const bytes = await storeFor(file).get(`disputes/${dealId}`, file);
  await logAccess(dealId, adminUid, "evidence", "admin");
  return { bytes, contentType: file.contentType };
}

export interface RulingInput {
  seekerShareBps: number;
  faultParty: FaultParty;
  reason: string;
}

export async function resolveDispute(
  adminUid: string,
  idParam: string | undefined,
  ruling: RulingInput,
) {
  const id = dealIdParam(idParam);
  const dealId = id.toString();
  const deal = await readDealOrThrow(id);
  if (deal.status !== DealStatus.Disputed) {
    throw new AppError("CHAIN_STATE_MISMATCH", {
      message: "This deal is not in dispute on-chain.",
    });
  }

  let result;
  try {
    result = await txManager("verifier").writeContract({
      address: serverEnv().ESCROW_ADDRESS,
      abi: relayEscrowAbi,
      functionName: "resolveDispute",
      args: [id, ruling.seekerShareBps, PARTY_CODE[ruling.faultParty]],
    });
  } catch (error) {
    if (error instanceof AppError && error.details?.reason === "InvalidStatus") {
      throw new AppError("CHAIN_STATE_MISMATCH", { message: "This dispute was already settled." });
    }
    throw error;
  }
  if (result.status !== "success")
    throw new AppError("TX_FAILED", { details: { hash: result.hash } });

  const auditId = randomUUID();
  const now = Date.now();
  await repos.audit.create(auditId, {
    kind: "dispute.resolve",
    dealId,
    adminUid,
    ruling: { seekerShareBps: ruling.seekerShareBps, faultParty: ruling.faultParty },
    reason: ruling.reason,
    txHash: result.hash,
    at: now,
  });
  await repos.disputes
    .update(dealId, { status: "resolved", resolvedAt: now, updatedAt: now })
    .catch(() => undefined);
  await syncDealIndex(dealId, await readDeal(id));

  return {
    dealId,
    status: "Resolved",
    ruling: { seekerShareBps: ruling.seekerShareBps, faultParty: ruling.faultParty },
    txHash: result.hash,
    txUrl: explorerTxUrl(result.hash),
    auditId,
  };
}
