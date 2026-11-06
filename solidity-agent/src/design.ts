// The designer's decision pipeline: provider history -> trust score; requirement -> analysis; both -> bounded terms.
import { z } from 'zod';
import { analyzeWithModel, type Analyzer } from './analyze.js';
import { buildSpec, specHash, type ContractSpec } from './spec.js';
import { computeTrust, type Trust } from './trust.js';

const tinybar = z.string().regex(/^\d+$/, 'tinybar must be a whole-number string');

export const designRequestSchema = z.object({
  request: z.object({
    requirements: z.string().min(10),
    budgetTinybar: tinybar,
    checksRequested: z.array(z.string()).default([]),
  }),
  agent: z.object({
    name: z.string(),
    description: z.string(),
    capabilities: z.array(z.string()),
    stats: z.object({
      benchmarkScore: z.number().min(0).max(100).nullable(),
      jobsCompleted: z.number().int().min(0),
      jobsFailed: z.number().int().min(0),
      payoutDefaults: z.number().int().min(0),
      avgDeliveryRatio: z.number().min(0).nullable(),
    }),
  }),
  quotePriceTinybar: tinybar,
});
export type DesignRequest = z.infer<typeof designRequestSchema>;

export type Design = { spec: ContractSpec; specHash: `0x${string}`; trust: Trust; source: 'ai' | 'fallback' };

export async function design(req: DesignRequest, analyze: Analyzer = analyzeWithModel): Promise<Design> {
  const trust = computeTrust(req.agent.stats);
  const { analysis, source } = await analyze({
    requirements: req.request.requirements,
    agentName: req.agent.name,
    agentDescription: req.agent.description,
    capabilities: req.agent.capabilities,
  });
  const spec = buildSpec({
    analysis, trust, analysisSource: source,
    quotePriceTinybar: BigInt(req.quotePriceTinybar),
    budgetTinybar: BigInt(req.request.budgetTinybar),
    requestedChecks: req.request.checksRequested,
    avgDeliveryRatio: req.agent.stats.avgDeliveryRatio,
  });
  return { spec, specHash: specHash(spec), trust, source };
}
