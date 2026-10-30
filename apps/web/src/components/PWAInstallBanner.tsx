"use client";

import { useState } from "react";
import { usePWAInstall } from "@/client/hooks/usePWAInstall";
import { Button, Card } from "@/components/ds";

/** Topbar compact install pill for desktop/mobile browsers */
export function PWAInstallPill() {
  const { canInstall, isInstalled, promptInstall } = usePWAInstall();
  const [loading, setLoading] = useState(false);

  if (isInstalled || !canInstall) return null;

  return (
    <button
      type="button"
      className="pill pill-subtle"
      style={{
        fontSize: 12,
        padding: "3px 10px",
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        background: "rgba(22, 101, 52, 0.08)",
        color: "#15803d",
        borderColor: "rgba(22, 101, 52, 0.2)",
      }}
      onClick={async () => {
        setLoading(true);
        await promptInstall();
        setLoading(false);
      }}
      disabled={loading}
      aria-label="Install SAKER Progressive Web App"
      title="Install SAKER as an app on your phone or desktop"
    >
      <span style={{ fontSize: 13 }}>📲</span>
      <span>{loading ? "Installing…" : "Install App"}</span>
    </button>
  );
}

/** Rich Settings / Profile Card showing PWA status and instructions */
export function PWAMobileCard() {
  const { canInstall, isInstalled, isIOS, promptInstall } = usePWAInstall();
  const [busy, setBusy] = useState(false);
  const [showIosGuide, setShowIosGuide] = useState(false);

  return (
    <Card>
      <div className="card-head">
        <span className="label">Mobile Experience (PWA)</span>
        {isInstalled ? (
          <span className="pill pill-green">Standalone Active</span>
        ) : (
          <span className="pill pill-subtle">App Ready</span>
        )}
      </div>

      <div className="stack" style={{ gap: 12, marginTop: 8 }}>
        <p className="muted" style={{ fontSize: 13, lineHeight: 1.5 }}>
          {isInstalled
            ? "SAKER is running as a standalone progressive web app with full offline cache and fast loading."
            : "Install SAKER directly to your device home screen for instant access, smooth touch navigation, and zero gas-fee escrow."}
        </p>

        {canInstall && (
          <div>
            <Button
              size="sm"
              loading={busy}
              onClick={async () => {
                setBusy(true);
                await promptInstall();
                setBusy(false);
              }}
            >
              📲 Install SAKER on this Device
            </Button>
          </div>
        )}

        {isIOS && (
          <div className="stack" style={{ gap: 8 }}>
            <Button size="sm" variant="outline" onClick={() => setShowIosGuide((prev) => !prev)}>
              {showIosGuide ? "Hide iOS Instructions" : "📲 Add to iPhone / iPad Home Screen"}
            </Button>
            {showIosGuide && (
              <div
                style={{
                  background: "var(--bg-subtle, #f9fafb)",
                  border: "1px solid var(--line)",
                  borderRadius: 8,
                  padding: "10px 14px",
                  fontSize: 13,
                  lineHeight: 1.6,
                }}
              >
                <ol style={{ paddingLeft: 18, margin: 0 }}>
                  <li>
                    Tap the <strong>Share</strong> button (box with upward arrow) at the bottom of
                    Safari.
                  </li>
                  <li>
                    Scroll down and tap <strong>Add to Home Screen</strong>.
                  </li>
                  <li>
                    Tap <strong>Add</strong> in the top-right corner.
                  </li>
                </ol>
              </div>
            )}
          </div>
        )}

        {!canInstall && !isIOS && !isInstalled && (
          <div
            className="row"
            style={{ gap: 8, alignItems: "center", fontSize: 12, color: "var(--ink-3)" }}
          >
            <span>✓ Web app manifest and service worker active.</span>
          </div>
        )}
      </div>
    </Card>
  );
}
