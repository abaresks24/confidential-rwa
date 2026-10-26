import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Confidential Treasury — private yield on a tokenized fund",
  description: "Hidden holding, visible growth, full auditor oversight. A confidential yield vault on Stellar testnet.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
