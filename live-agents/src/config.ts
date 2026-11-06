import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
// Own .env first; the sibling backend .env only fills gaps (NVIDIA key, shared secret), so nothing is copied around.
loadEnv({ path: here('../.env') });
loadEnv({ path: here('../../backend/.env') });

const get = (k: string, d = '') => process.env[k] ?? d;

export const config = {
  backendUrl: get('BACKEND_URL', 'http://localhost:4000').replace(/\/$/, ''),
  backendSecret: get('BACKEND_SECRET') || undefined,
  nvidiaKey: get('NVIDIA_API_KEY'),
  nvidiaBaseUrl: get('NVIDIA_BASE_URL', 'https://integrate.api.nvidia.com/v1'),
  nvidiaModel: get('NVIDIA_MODEL', 'nvidia/nemotron-3.5-super-vl-120b-a12b'),
  network: 'hedera:testnet' as const,
};
