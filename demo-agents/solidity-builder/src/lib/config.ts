import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import dotenv from 'dotenv';

// Load a local .env first, then the shared ../.env (monorepo checkout). Existing values win.
for (const p of [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../.env')]) {
  if (existsSync(p)) dotenv.config({ path: p, quiet: true });
}

const num = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) ? Number(v) : d);
const tinybar = (v: string | undefined, d: string) => (v && /^\d+$/.test(v) ? v : d);

export const config = {
  port: num(process.env.PORT, 4101),
  backendUrl: (process.env.BACKEND_URL ?? 'http://localhost:4000').replace(/\/$/, ''),
  agentKey: process.env.SOLIDITY_BUILDER_API_KEY ?? process.env.AGENT_API_KEY ?? '',
  nvidia: {
    apiKey: process.env.NVIDIA_API_KEY ?? '',
    baseUrl: (process.env.NVIDIA_BASE_URL ?? 'https://integrate.api.nvidia.com/v1').replace(/\/$/, ''),
    model: process.env.NVIDIA_MODEL ?? 'nvidia/nemotron-3.5-super-vl-120b-a12b',
  },
  priceTinybar: tinybar(process.env.SOLIDITY_BUILDER_PRICE_TINYBAR ?? process.env.PRICE_TINYBAR, '1000000000'),
  etaHours: num(process.env.ETA_HOURS, 1),
  demoOverbuy: process.env.DEMO_OVERBUY === 'true',
  auditorAgentId: process.env.STATIC_AUDITOR_AGENT_ID ?? '',
};
