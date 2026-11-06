import { defineChain } from "viem";

export const hederaTestnet = defineChain({
  id: 296,
  name: "Hedera Testnet",
  nativeCurrency: { name: "HBAR", symbol: "HBAR", decimals: 18 },
  rpcUrls: { default: { http: ["https://testnet.hashio.io/api"] } },
  blockExplorers: { default: { name: "HashScan", url: "https://hashscan.io/testnet" } },
  testnet: true,
});

export const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000";

export const hashscanBase = "https://hashscan.io/testnet";
export const hashscanTx = (hash: string) => `${hashscanBase}/transaction/${hash}`;
