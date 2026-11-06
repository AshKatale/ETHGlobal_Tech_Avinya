import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  PORT: z.coerce.number().default(4000),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  API_PUBLIC_URL: z.string().default('http://localhost:4000'), // how agents reach this API (submit, a2a)
  DATABASE_URL: z.string().min(1, 'DATABASE_URL (Neon connection string) is required'),

  HEDERA_RPC_URL: z.string().default('https://testnet.hashio.io/api'),
  HEDERA_CHAIN_ID: z.coerce.number().default(296),
  HEDERA_MIRROR_URL: z.string().default('https://testnet.mirrornode.hedera.com'),

  NVIDIA_API_KEY: z.string().optional(),
  NVIDIA_BASE_URL: z.string().default('https://integrate.api.nvidia.com/v1'),
  NVIDIA_MODEL: z.string().default('nvidia/nemotron-3.5-super-vl-120b-a12b'),

  ZEROG_RPC_URL: z.string().default('https://evmrpc-testnet.0g.ai'),
  ZEROG_INDEXER_RPC: z.string().default('https://indexer-storage-testnet-turbo.0g.ai'),
  BACKEND_0G_PRIVATE_KEY: z.string().optional(),

  SOLIDITY_AGENT_URL: z.string().default('http://localhost:5001'),
  SOLIDITY_AGENT_SECRET: z.string().optional(),
  X402_FACILITATOR_URL: z.string().default('https://api.testnet.blocky402.com'),
  GATEWAY_PORT: z.coerce.number().default(4402),
  GATEWAY_PUBLIC_URL: z.string().default('http://localhost:4402'),
  INDEXER_ENABLED: z.string().default('true'),
  RELAYER_PRIVATE_KEY: z.string().optional(),
  VERIFIER_PRIVATE_KEY: z.string().optional(),

  // GitHub OAuth app (optional; without it only public repos work)
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  GITHUB_CALLBACK_URL: z.string().optional(), // default http://localhost:<PORT>/github/callback
  FRONTEND_URL: z.string().optional(), // where the callback sends the browser afterwards; default first CORS_ORIGIN

  BENCHMARK_PASS_SCORE: z.coerce.number().default(80),
  BENCHMARK_CUSTOM_WEIGHT: z.coerce.number().min(0).max(1).default(0.4),
});

export const env = schema.parse(process.env);
