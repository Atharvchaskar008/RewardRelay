import type { Metadata, Viewport } from "next";
import { AppNav } from "@/components/AppNav";
import { fontVariables } from "@/styles/fonts";
import { Providers } from "../providers";
import "@/styles/tokens.css";
import "@/styles/ds.css";
import "@/styles/app.css";

export const metadata: Metadata = {
  title: { default: "SAKER", template: "%s · SAKER" },
  description: "Card offers for everyone, settled by smart contracts on MST Blockchain.",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icons/icon-192.png", apple: "/icons/icon-192.png" },
  appleWebApp: { capable: true, title: "SAKER", statusBarStyle: "default" },
  other: {
    "mobile-web-app-capable": "yes",
  },
};

export const viewport: Viewport = {
  themeColor: "#f5f5f4",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
};

/** The SAKER app: session, SDK, top bar (desktop) and bottom bar (mobile). */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={fontVariables}>
      <body>
        <Providers>
          <AppNav />
          {children}
        </Providers>
      </body>
    </html>
  );
}
