import type { Metadata, Viewport } from "next";
import { fontVariables } from "@/styles/fonts";
import "@/styles/tokens.css";
import "@/styles/ds.css";
import "@/styles/landing.css";

export const metadata: Metadata = {
  title: "SAKER · Their card. Your discount.",
  description:
    "Use a stranger's card offer without touching their card. Your money waits in a smart contract on MST Blockchain until the order arrives.",
  icons: { icon: "/icons/icon-192.png", apple: "/icons/icon-192.png" },
  openGraph: {
    title: "SAKER · Their card. Your discount.",
    description: "Card offers for everyone, settled by smart contracts on MST Blockchain.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#f5f5f4",
  width: "device-width",
  initialScale: 1,
};

/** The public landing page: its own shell, without the app's session or navigation. */
export default function LandingLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={fontVariables}>
      <body>{children}</body>
    </html>
  );
}
