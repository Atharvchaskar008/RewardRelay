"use client";

import { useCertificate } from "@/hooks/useCertificate";

export default function CertificateStats() {
  const { name, symbol, totalSupply, isDeployed, isNameLoading, isSymbolLoading, isTotalSupplyLoading } =
    useCertificate();

  return (
    <div className="card">
      <div className="card-header">
        <h2>Registry</h2>
        <p className="hint">The on-chain credential registry this project deployed.</p>
      </div>

      {!isDeployed ? (
        <p className="hint">
          No Certificate deployment found for this network. Run <code>npm run deploy:testnet</code> first.
        </p>
      ) : (
        <div className="grid grid-3">
          <div className="stat">
            <p className="hint">Registry</p>
            <p className="stat-value">{isNameLoading ? "Loading…" : name?.toString() || "-"}</p>
          </div>
          <div className="stat">
            <p className="hint">Symbol</p>
            <p className="stat-value">{isSymbolLoading ? "Loading…" : symbol?.toString() || "-"}</p>
          </div>
          <div className="stat">
            <p className="hint">Certificates issued</p>
            <p className="stat-value">
              {isTotalSupplyLoading ? "Loading…" : totalSupply?.toString() || "0"}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
