"use client";

import { useCertificate } from "@/hooks/useCertificate";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export default function VerifyPage({ params }: { params: { tokenId: string } }) {
  let parsedTokenId: bigint | undefined;
  try {
    parsedTokenId = BigInt(params.tokenId);
  } catch {
    parsedTokenId = undefined;
  }

  const { verifyResult, isVerifyLoading, isDeployed } = useCertificate(parsedTokenId);

  const notFound = verifyResult && !verifyResult.isValid && verifyResult.holder === ZERO_ADDRESS && !verifyResult.revoked;

  return (
    <main>
      <div className="page-header">
        <h1>Certificate Verification</h1>
        <p className="hint">Token #{params.tokenId} — read directly from the Certificate contract.</p>
      </div>

      <div className="card">
        {!isDeployed ? (
          <p className="hint">No Certificate deployment found for this network.</p>
        ) : parsedTokenId === undefined ? (
          <p className="status-error">Invalid token ID.</p>
        ) : isVerifyLoading ? (
          <p className="hint">Checking…</p>
        ) : !verifyResult || notFound ? (
          <>
            <p className="badge badge-revoked">Not found</p>
            <p className="hint" style={{ marginTop: "0.75rem" }}>
              No certificate exists with this token ID on the connected network.
            </p>
          </>
        ) : (
          <>
            <p>
              <span className={verifyResult.revoked ? "badge badge-revoked" : "badge badge-valid"}>
                {verifyResult.revoked ? "Revoked — do not trust" : "Valid certificate"}
              </span>
            </p>

            <div className="form-stack" style={{ marginTop: "1.25rem" }}>
              <div className="field">
                <p className="hint">Holder</p>
                <p className="mono break">{verifyResult.holder}</p>
              </div>
              <div className="field">
                <p className="hint">Fingerprint (keccak256)</p>
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
            </div>
          </>
        )}
      </div>
    </main>
  );
}
