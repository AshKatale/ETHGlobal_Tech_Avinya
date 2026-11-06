// ContractSpec: the dynamic terms put into a TaskEscrow. The model supplies an ANALYSIS of the job;
// this file decides the numbers, bounded by the provider's trust and by hard limits.
import { keccak256, toBytes, type Hex } from 'viem';
import { z } from 'zod';
import type { Trust } from './trust.js';

export const ALLOWED_CHECKS = ['build_config', 'lint_rules', 'secrets_scan', 'dependency_check', 'security_review'] as const;

export const analysisSchema = z.object({
  complexity: z.number().int().min(1).max(5),
  effortHours: z.number().min(0.25).max(2000),
  risk: z.enum(['low', 'medium', 'high']),
  summary: z.string().max(1200),
  suggestedChecks: z.array(z.string()).max(10).default([]),
});
export type Analysis = z.infer<typeof analysisSchema>;

export const contractSpecSchema = z.object({
  priceTinybar: z.string().regex(/^\d+$/),
  deadlineHours: z.number().int().min(2).max(720),
  maxSubBps: z.number().int().min(0).max(4000),
  maxSubLegs: z.number().int().min(0).max(3),
  payoutGraceSecs: z.number().int().min(600).max(86_400),
  passThresholdPct: z.number().int().min(50).max(100),
  checks: z.array(z.enum(ALLOWED_CHECKS)),
  complexity: z.number().int().min(1).max(5),
  effortHours: z.number(),
  risk: z.enum(['low', 'medium', 'high']),
  trustScore: z.number(),
  trustTier: z.enum(['new', 'standard', 'trusted']),
  rationale: z.array(z.string()),
  warnings: z.array(z.string()),
});
export type ContractSpec = z.infer<typeof contractSpecSchema>;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function buildSpec(input: {
  analysis: Analysis;
  trust: Trust;
  quotePriceTinybar: bigint;
  budgetTinybar: bigint;
  requestedChecks: string[];
  avgDeliveryRatio: number | null;
  analysisSource: 'ai' | 'fallback';
}): ContractSpec {
  const { analysis: a, trust: t } = input;
  const rationale: string[] = [];
  const warnings: string[] = [];

  // Deadline: effort scaled by how reliable and fast the agent has been, plus a buffer.
  const base = t.tier === 'trusted' ? 1.0 : t.tier === 'standard' ? 1.2 : 1.5;
  const speed = input.avgDeliveryRatio && input.avgDeliveryRatio > 1 ? base * Math.min(2, input.avgDeliveryRatio) : base;
  const deadlineHours = clamp(Math.ceil(a.effortHours * speed * 1.5), 2, 720);
  rationale.push(`Estimated effort ${a.effortHours}h (complexity ${a.complexity}/5, risk ${a.risk}). Deadline ${deadlineHours}h = effort x ${speed.toFixed(2)} agent factor x 1.5 buffer.`);

  // Subcontracting cap: more trust allows more of the price to be handed to sub-agents.
  let maxSubBps = Math.round(clamp(1000 + t.score * 30, 1000, 4000));
  if (a.risk === 'high') {
    maxSubBps = Math.min(maxSubBps, 2000);
    rationale.push('High-risk job: sub-agent spending capped at 20% of the price.');
  }
  const maxSubLegs = t.score < 40 ? 1 : t.score < 70 ? 2 : 3;
  rationale.push(`Trust ${t.score}/100 (${t.tier}): up to ${maxSubLegs} sub-agent(s), sub-agent spending capped at ${(maxSubBps / 100).toFixed(0)}% of the price.`);

  // How long the agent has to pay its sub-agents after it is paid: longer for complex, multi-step jobs.
  const payoutGraceSecs = clamp(a.complexity >= 4 ? 6 * 3600 : 3600, 600, 86_400);
  rationale.push(`The agent must pay its sub-agents within ${payoutGraceSecs / 3600}h of release, or each unpaid debt is marked defaulted on-chain.`);

  const passThresholdPct = a.risk === 'high' ? 100 : a.risk === 'medium' ? 95 : 90;
  rationale.push(`Verification pass threshold ${passThresholdPct}%.`);

  const checks = [...new Set([...input.requestedChecks, ...a.suggestedChecks])].filter((c): c is (typeof ALLOWED_CHECKS)[number] =>
    (ALLOWED_CHECKS as readonly string[]).includes(c),
  );
  if (a.risk !== 'low' && !checks.includes('security_review')) {
    checks.push('security_review');
    rationale.push('Security review added because the job is not low risk.');
  }

  if (input.quotePriceTinybar > input.budgetTinybar) warnings.push('Quoted price is above the client budget.');
  if (input.quotePriceTinybar === 0n) warnings.push('Quoted price is zero.');
  if (input.analysisSource === 'fallback') warnings.push('AI analysis unavailable; effort estimated by a simple heuristic.');
  rationale.push(...t.reasons.map((r) => `Provider history: ${r}.`));
  rationale.push(a.summary);

  return contractSpecSchema.parse({
    priceTinybar: input.quotePriceTinybar.toString(), deadlineHours, maxSubBps, maxSubLegs, payoutGraceSecs, passThresholdPct, checks,
    complexity: a.complexity, effortHours: a.effortHours, risk: a.risk, trustScore: t.score, trustTier: t.tier, rationale, warnings,
  });
}

/** Stable JSON (sorted keys) so the same spec always hashes the same. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson((v as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}
export const specHash = (spec: ContractSpec): Hex => keccak256(toBytes(canonicalJson(spec)));

/** Used when the model is unavailable: rough effort from the requirement length. Flagged as a fallback in the spec. */
export function heuristicAnalysis(requirements: string): Analysis {
  const words = requirements.trim().split(/\s+/).length;
  const complexity = clamp(Math.ceil(words / 60), 1, 5);
  return {
    complexity, effortHours: complexity * 2, risk: complexity >= 4 ? 'high' : complexity >= 3 ? 'medium' : 'low',
    summary: `Heuristic estimate from the requirement length (${words} words).`, suggestedChecks: [],
  };
}
