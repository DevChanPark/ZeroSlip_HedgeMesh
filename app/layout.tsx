import type { Metadata } from "next";

import "./globals.css";
import { Web3Provider } from "./providers";

export const metadata: Metadata = {
  title: "ZeroSlip HedgeMesh",
  description: "AI-powered hedge intent netting layer on Mantle Sepolia"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Web3Provider>{children}</Web3Provider>
      </body>
    </html>
  );
}
