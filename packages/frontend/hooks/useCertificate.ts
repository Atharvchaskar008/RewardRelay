"use client";

import { useEffect } from "react";
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import type { Address } from "viem";
import { deployments } from "rewardrelay-shared";
import { mstMainnet } from "@/lib/chains";

/**
 * Logs a failed read with enough context to tell a bad deployment/ABI
 * apart from a network problem — e.g. "Failed to fetch" / "NetworkError"
 * almost always means the RPC request itself never got a response (wrong
 * network, RPC down, or blocked by CORS), not a contract-level revert.
 */
function useLogReadError(
  label: string,
  error: Error | null,
  contractAddress: Address | undefined,
  network: string,
) {
  useEffect(() => {
    if (!error) return;
    const looksLikeNetworkFailure = /failed to fetch|networkerror|cors/i.test(error.message);
    console.error(
      `[useCertificate] ${label} read failed${looksLikeNetworkFailure ? " (looks like a network/CORS issue, not a contract error — check the Network tab for a blocked/failed request)" : ""}:`,
      error,
      { contractAddress, network },
    );
  }, [label, error, contractAddress, network]);
}

type DeployedContract = { address: Address; abi: readonly unknown[] };

export type VerifyResult = {
  isValid: boolean;
  holder: Address;
  certHash: `0x${string}`;
  issuedAt: bigint;
  revoked: boolean;
};

function useCertificateContract(): DeployedContract | undefined {
  const { chainId } = useAccount();
  const network = chainId === mstMainnet.id ? "mainnet" : "testnet";
  return (deployments as Record<string, any>)[network]?.Certificate as DeployedContract | undefined;
}

/**
 * Reads/writes for the Certificate registry. `tokenId` is optional — pass it
 * to also resolve that certificate's owner, URI, and verification status
 * (used by the public /verify/[tokenId] page, which works without a
 * connected wallet since these are all plain contract reads).
 */
export function useCertificate(tokenId?: bigint) {
  const { address: connectedAddress, chainId } = useAccount();
  const network = chainId === mstMainnet.id ? "mainnet" : "testnet";
  const contract = useCertificateContract();
  const enabled = Boolean(contract);
  const base = contract
    ? { address: contract.address, abi: contract.abi }
    : { address: undefined, abi: undefined };

  const { data: name, isLoading: isNameLoading } = useReadContract({
    ...base,
    functionName: "name",
    query: { enabled },
  });

  const {
    data: owner,
    isLoading: isOwnerLoading,
    isError: isOwnerError,
    error: ownerError,
  } = useReadContract({ ...base, functionName: "owner", query: { enabled } });
  useLogReadError("owner()", ownerError, contract?.address, network);

  const {
    data: isConnectedWalletIssuer,
    isLoading: isIssuerLoading,
    isError: isIssuerError,
    error: issuerError,
    refetch: refetchIsIssuer,
  } = useReadContract({
    ...base,
    functionName: "isIssuer",
    args: connectedAddress ? [connectedAddress] : undefined,
    query: { enabled: enabled && Boolean(connectedAddress) },
  });
  useLogReadError("isIssuer()", issuerError, contract?.address, network);

  const { data: symbol, isLoading: isSymbolLoading } = useReadContract({
    ...base,
    functionName: "symbol",
    query: { enabled },
  });

  const {
    data: totalSupply,
    isLoading: isTotalSupplyLoading,
    refetch: refetchTotalSupply,
  } = useReadContract({ ...base, functionName: "totalSupply", query: { enabled } });

  const {
    data: tokenURI,
    isLoading: isTokenURILoading,
    isError: isTokenURIError,
  } = useReadContract({
    ...base,
    functionName: "tokenURI",
    args: tokenId !== undefined ? [tokenId] : undefined,
    query: { enabled: enabled && tokenId !== undefined },
  });

  const {
    data: verifyData,
    isLoading: isVerifyLoading,
    isError: isVerifyError,
    refetch: refetchVerify,
  } = useReadContract({
    ...base,
    functionName: "verify",
    args: tokenId !== undefined ? [tokenId] : undefined,
    query: { enabled: enabled && tokenId !== undefined },
  });

  const verifyResult: VerifyResult | undefined = verifyData
    ? {
        isValid: (verifyData as any)[0],
        holder: (verifyData as any)[1],
        certHash: (verifyData as any)[2],
        issuedAt: (verifyData as any)[3],
        revoked: (verifyData as any)[4],
      }
    : undefined;

  const {
    data: writeData,
    writeContract,
    isPending: isWritePending,
    error: writeError,
  } = useWriteContract();

  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
    hash: writeData,
  });

  const issue = (to: Address, certHash: `0x${string}`, tokenURI_: string) => {
    if (!contract) return;
    writeContract({
      address: contract.address,
      abi: contract.abi,
      functionName: "issue",
      args: [to, certHash, tokenURI_],
    });
  };

  const batchIssue = (to: Address[], certHashes: `0x${string}`[], tokenURIs: string[]) => {
    if (!contract) return;
    writeContract({
      address: contract.address,
      abi: contract.abi,
      functionName: "batchIssue",
      args: [to, certHashes, tokenURIs],
    });
  };

  const revoke = (tokenIdToRevoke: bigint) => {
    if (!contract) return;
    writeContract({
      address: contract.address,
      abi: contract.abi,
      functionName: "revoke",
      args: [tokenIdToRevoke],
    });
  };

  const setIssuer = (account: Address, allowed: boolean) => {
    if (!contract) return;
    writeContract({
      address: contract.address,
      abi: contract.abi,
      functionName: "setIssuer",
      args: [account, allowed],
    });
  };

  return {
    address: contract?.address,
    isDeployed: enabled,

    name,
    symbol,
    totalSupply,
    tokenURI,
    verifyResult,
    owner,
    isConnectedWalletIssuer,

    isNameLoading,
    isSymbolLoading,
    isTotalSupplyLoading,
    isTokenURILoading,
    isTokenURIError,
    isVerifyLoading,
    isVerifyError,
    isOwnerLoading,
    isOwnerError,
    isIssuerLoading,
    isIssuerError,

    issue,
    batchIssue,
    revoke,
    setIssuer,

    writeData,
    isWritePending,
    isConfirming,
    isConfirmed,
    writeError,

    refetchTotalSupply,
    refetchVerify,
    refetchIsIssuer,
  };
}
