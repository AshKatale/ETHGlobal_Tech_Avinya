// HTTP client for the Solidity agent (a separate service in /solidity-agent). The backend never designs or deploys itself.
import { env } from '../env.js';

export class DesignerError extends Error {}

export type AgentStats = {
  benchmarkScore: number | null; jobsCompleted: number; jobsFailed: number; payoutDefaults: number; avgDeliveryRatio: number | null;
};
export type DesignInput = {
  request: { requirements: string; budgetTinybar: string; checksRequested: string[] };
  agent: { name: string; description: string; capabilities: string[]; stats: AgentStats };
  quotePriceTinybar: string;
};
export type ContractSpec = {
  priceTinybar: string; deadlineHours: number; maxSubBps: number; maxSubLegs: number; payoutGraceSecs: number; passThresholdPct: number;
  checks: string[]; complexity: number; effortHours: number; risk: 'low' | 'medium' | 'high'; trustScore: number;
  trustTier: 'new' | 'standard' | 'trusted'; rationale: string[]; warnings: string[];
};
export type Design = { spec: ContractSpec; specHash: `0x${string}`; trust: { score: number; tier: string; reasons: string[] }; source: 'ai' | 'fallback' };
export type Deployed = { task: `0x${string}`; txHash: `0x${string}` | null; specHash: `0x${string}`; deadlineUnix: string; alreadyExisted: boolean };

async function call<T>(path: string, body: unknown, timeoutMs: number, withSecret = false): Promise<T> {
  let res: Response;
  try {
    res = await fetch(env.SOLIDITY_AGENT_URL + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(withSecret && env.SOLIDITY_AGENT_SECRET ? { 'x-agent-secret': env.SOLIDITY_AGENT_SECRET } : {}) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    throw new DesignerError(`Solidity agent unreachable at ${env.SOLIDITY_AGENT_URL}: ${(e as Error).message}`);
  }
  const json = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new DesignerError(`Solidity agent ${path} failed (${res.status}): ${json.error ?? 'unknown error'}`);
  return json as T;
}

export const requestDesign = (input: DesignInput) => call<Design>('/design', input, 90_000);

export const requestDeploy = (input: { agreementId: string; client: string; agent: string; spec: ContractSpec }) =>
  call<Deployed>('/deploy', input, 150_000, true);
