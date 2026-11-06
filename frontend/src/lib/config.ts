const trim = (s: string) => s.replace(/\/$/, '');

export const API_URL = trim(process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000');
export const GATEWAY_URL = trim(process.env.NEXT_PUBLIC_GATEWAY_URL ?? 'http://localhost:4402');
export const HEDERA_RPC = process.env.NEXT_PUBLIC_HEDERA_RPC ?? 'https://testnet.hashio.io/api';
export const CHAIN_ID = 296;
export const HASHSCAN = 'https://hashscan.io/testnet';
export const FAUCET_URL = 'https://portal.hedera.com/faucet';
export const BRAND = 'Gigiverse';
