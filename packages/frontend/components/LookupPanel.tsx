"use client";

import { useEffect, useState } from "react";
import { useAccount } from "wagmi";

import { useCertificate } from "@/hooks/useCertificate";
import { CertificateQR } from "@/components/QRCode";

export default function LookupPanel() {
  const { isConnected } = useAccount();
  const [tokenIdInput, setTokenIdInput] = useState("1");

  const parsedTokenId = tokenIdInput.trim() === "" ? undefined : BigInt(tokenIdInput);

  const {
    verifyResult,
    isVerifyLoading,
    isDeployed,
    revoke,
    isWritePending,
    isConfirming,
    isConfirmed,
    writeError,
    refetchVerify,
  } = useCertificate(parsedTokenId);

  const verifyUrl =
    typeof window !== "undefined" && parsedTokenId !== undefined
      ? `${window.location.origin}/verify/${parsedTokenId.toString()}`
      : "";

  const handleRevoke = () => {
    if (parsedTokenId === undefined) return;
    revoke(parsedTokenId);
  };

  useEffect(() => {
    if (isConfirmed) refetchVerify();
  }, [isConfirmed, refetchVerify]);

  return (
    <div className="card">
      <div className="card-header">
        <h2>Look Up &amp; Share</h2>
        <p className="hint">
          Check any certificate&apos;s status and get its verification QR code — the same lookup a
          scan resolves to.
        </p>
      </div>

      {!isDeployed ? (
        <p className="hint">
          No Certificate deployment found for this network. Run <code>npm run deploy:testnet</code>{" "}
          first.
        </p>
      ) : (
        <div className="form-stack">
          <div className="field">
            <label htmlFor="lookup-token-id">Token ID</label>
            <input
              id="lookup-token-id"
              type="number"
              min="0"
              value={tokenIdInput}
              onChange={(event) => setTokenIdInput(event.target.value)}
              placeholder="1"
            />
          </div>

          {parsedTokenId !== undefined && (
            <div className="nft-preview">
              <div className="qr-frame">
                <CertificateQR value={verifyUrl || parsedTokenId.toString()} />
              </div>

              <div className="nft-details">
                {isVerifyLoading ? (
                  <p className="hint">Checking…</p>
                ) : !verifyResult || (!verifyResult.isValid && verifyResult.holder === "0x0000000000000000000000000000000000000000") ? (
                  <p className="status-error">No certificate found for this token ID.</p>
                ) : (
                  <>
                    <p>
                      <span className={verifyResult.revoked ? "badge badge-revoked" : "badge badge-valid"}>
                        {verifyResult.revoked ? "Revoked" : "Valid"}
                      </span>
                    </p>
                    <div className="field">
                      <p className="hint">Holder</p>
                      <p className="mono break">{verifyResult.holder}</p>
                    </div>
                    <div className="field">
                      <p className="hint">Fingerprint</p>
                      <p className="mono break">{verifyResult.certHash}</p>
                    </div>
                    <div className="field">
                      <p className="hint">Issued</p>
                      <p>
                        {verifyResult.issuedAt > BigInt(0)
                          ? new Date(Number(verifyResult.issuedAt) * 1000).toLocaleString()
                          : "-"}
                      </p>
                    </div>
                    {verifyUrl && (
                      <div className="field">
                        <p className="hint">Verification link</p>
                        <p className="mono break">{verifyUrl}</p>
                      </div>
                    )}
                    {!verifyResult.revoked && (
                      <div className="wallet">
                        <button
                          type="button"
                          onClick={handleRevoke}
                          disabled={!isConnected || isWritePending || isConfirming}
                        >
                          {isWritePending ? "Confirm in wallet…" : isConfirming ? "Revoking…" : "Revoke"}
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}

          {isConfirmed && <p className="status-success">Certificate revoked.</p>}
          {writeError && <p className="network-warning">{writeError.message}</p>}
        </div>
      )}
    </div>
  );
}
