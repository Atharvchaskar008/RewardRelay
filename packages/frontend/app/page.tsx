"use client";

import WalletPanel from "@/components/WalletPanel";
import CertificateStats from "@/components/CertificateStats";
import IssuePanel from "@/components/IssuePanel";
import BatchIssuePanel from "@/components/BatchIssuePanel";
import AutoIssuePanel from "@/components/AutoIssuePanel";
import AutoBatchIssuePanel from "@/components/AutoBatchIssuePanel";
import LookupPanel from "@/components/LookupPanel";
import IssuerAdminPanel from "@/components/IssuerAdminPanel";

export default function Page() {
  return (
    <main>
      <div className="page-header">
        <h1>On-Chain Certificate</h1>
        <p className="hint">
          Issue tamper-proof credentials as soulbound NFTs — every certificate&apos;s fingerprint is
          locked on-chain, and anyone can verify it in under 2 seconds by token ID or QR code.
        </p>
      </div>

      <WalletPanel />
      <CertificateStats />
      <IssuePanel />
      <BatchIssuePanel />
      <AutoIssuePanel />
      <AutoBatchIssuePanel />
      <LookupPanel />
      <IssuerAdminPanel />
    </main>
  );
}
