import { createConfig, http } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { defineChain } from 'viem';
import { CHAIN_ID, HASHSCAN, HEDERA_RPC } from './config';

// Wallets show HBAR with 18 decimals through the JSON-RPC relay (weibar). Contracts see tinybar.
export const hederaTestnet = defineChain({
  id: CHAIN_ID,
  name: 'Hedera Testnet',
  nativeCurrency: { name: 'HBAR', symbol: 'HBAR', decimals: 18 },
  rpcUrls: { default: { http: [HEDERA_RPC] } },
  blockExplorers: { default: { name: 'HashScan', url: HASHSCAN } },
  testnet: true,
});

export const wagmiConfig = createConfig({
  chains: [hederaTestnet],
  connectors: [injected()],
  transports: { [CHAIN_ID]: http(HEDERA_RPC) },
  ssr: true,
});
