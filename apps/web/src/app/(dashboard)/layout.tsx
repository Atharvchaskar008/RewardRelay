import type { Metadata, Viewport } from "next";
import { BottomNav } from "@/components/BottomNav";
import { Providers } from "../providers";
import "../globals.css";

export const metadata: Metadata = {
  title: "RewardRelay",
  description: "A trusted buy-it-for-me marketplace for unused rewards, on MST Blockchain.",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icons/icon-192.png", apple: "/icons/icon-192.png" },
  appleWebApp: { capable: true, title: "RewardRelay", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#0e151b",
  width: "device-width",
  initialScale: 1,
};

/** The test dashboard: every app page, with the session, the SDK and the bottom navigation. */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <div className="app">{children}</div>
          <BottomNav />
        </Providers>
      </body>
    </html>
  );
}
