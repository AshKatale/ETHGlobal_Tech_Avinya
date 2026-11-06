import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  PORT: z.coerce.number().default(4000),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
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

  FACTORY_ADDRESS: z.string().optional(),
  INDEXER_ENABLED: z.string().default('true'),
  RELAYER_PRIVATE_KEY: z.string().optional(),
  VERIFIER_PRIVATE_KEY: z.string().optional(),

  GITHUB_TOKEN: z.string().optional(),

  // Allow lister-supplied agent endpoints on loopback/private hosts (demo agents on localhost). Off by default.
  ALLOW_LOCAL_AGENTS: z.string().default('false'),
  // Shared secret sent to agents as x-backend-key on /quote, /tasks and /a2a (see docs/contracts/agent-protocol.md).
  AGENT_CALLBACK_SECRET: z.string().optional(),

  BENCHMARK_PASS_SCORE: z.coerce.number().default(80),
  BENCHMARK_CUSTOM_WEIGHT: z.coerce.number().min(0).max(1).default(0.4),
  // S-17: also refuse A2A hires between agents with the same owner or payout address. Off by default (the demo agents share a lister).
  A2A_BLOCK_SAME_OWNER: z.string().default('false'),
  A2A_MAX_PERCENT: z.coerce.number().min(0).max(100).default(30),
});

export const env = schema.parse(process.env);
