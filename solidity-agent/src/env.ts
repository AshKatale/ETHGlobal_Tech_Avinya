import 'dotenv/config';
import { z } from 'zod';

export const env = z.object({
  PORT: z.coerce.number().default(5001),
  AGENT_SHARED_SECRET: z.string().optional(),
  DESIGNER_PRIVATE_KEY: z.string().optional(),
  TASK_FACTORY_ADDRESS: z.string().optional(),
  HEDERA_RPC_URL: z.string().default('https://testnet.hashio.io/api'),
  HEDERA_CHAIN_ID: z.coerce.number().default(296),
  NVIDIA_API_KEY: z.string().optional(),
  NVIDIA_BASE_URL: z.string().default('https://integrate.api.nvidia.com/v1'),
  NVIDIA_MODEL: z.string().default('nvidia/nemotron-3.5-super-vl-120b-a12b'),
}).parse(process.env);
