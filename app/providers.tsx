"use client";

import { ReactNode, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Chain } from "viem";
import { WagmiProvider, createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";

export const mantleSepolia = {
  id: 5003,
  name: "Mantle Sepolia",
  nativeCurrency: {
    decimals: 18,
    name: "MNT",
    symbol: "MNT"
  },
  rpcUrls: {
    default: { http: ["https://rpc.sepolia.mantle.xyz"] },
    public: { http: ["https://rpc.sepolia.mantle.xyz"] }
  },
  blockExplorers: {
    default: {
      name: "Mantle Sepolia Explorer",
      url: "https://explorer.sepolia.mantle.xyz"
    }
  },
  testnet: true
} as const satisfies Chain;

const config = createConfig({
  chains: [mantleSepolia],
  connectors: [injected({ shimDisconnect: true })],
  ssr: true,
  transports: {
    [mantleSepolia.id]: http(mantleSepolia.rpcUrls.default.http[0])
  }
});

export function Web3Provider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
