// Trust score for a provider agent. Pure and deterministic: the model never sets this.
// Inputs come from the platform's own records (benchmark and job history), never from what the agent says about itself.

export type AgentStats = {
  benchmarkScore: number | null;   // 0-100, latest benchmark, null if none
  jobsCompleted: number;           // tasks released to the agent
  jobsFailed: number;              // tasks refunded to the client
  payoutDefaults: number;          // sub-agent payments the agent failed to make on time
  avgDeliveryRatio: number | null; // time taken / time allowed (1.0 = exactly on deadline), null if unknown
};

export type TrustTier = 'new' | 'standard' | 'trusted';
export type Trust = { score: number; tier: TrustTier; reasons: string[] };

/** Lower bound of the 95% Wilson interval for the success rate: rewards volume, not just a lucky 1/1. */
export function wilsonLowerBound(successes: number, total: number, z = 1.96): number {
  if (total <= 0) return 0;
  const p = successes / total;
  const z2 = z * z;
  const centre = p + z2 / (2 * total);
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * total)) / total);
  return Math.max(0, (centre - margin) / (1 + z2 / total));
}

export function computeTrust(s: AgentStats): Trust {
  const reasons: string[] = [];
  const n = s.jobsCompleted + s.jobsFailed;
  const bench = s.benchmarkScore ?? 0;

  const history = wilsonLowerBound(s.jobsCompleted, n) * 100;
  // History counts for more as it accumulates (full weight at 10 jobs). Until then the benchmark carries the score,
  // discounted, because a benchmark is weaker evidence than real delivered jobs.
  const wHistory = Math.min(1, n / 10) * 0.6;
  let score = wHistory * history + (1 - wHistory) * bench * 0.8;

  reasons.push(s.benchmarkScore === null ? 'no benchmark on record' : `benchmark ${s.benchmarkScore.toFixed(0)}/100`);
  reasons.push(n === 0 ? 'no finished jobs yet' : `${s.jobsCompleted} of ${n} jobs delivered and paid`);

  if (n < 3 && score > 60) {
    score = 60;
    reasons.push('capped at 60 until the agent has 3 finished jobs');
  }
  if (s.payoutDefaults > 0) {
    const penalty = Math.min(40, s.payoutDefaults * 10);
    score -= penalty;
    reasons.push(`${s.payoutDefaults} unpaid sub-agent payment(s), -${penalty}`);
  }
  if (s.avgDeliveryRatio !== null && s.avgDeliveryRatio > 1) {
    const penalty = Math.min(15, Math.round((s.avgDeliveryRatio - 1) * 15));
    score -= penalty;
    reasons.push(`usually late (${s.avgDeliveryRatio.toFixed(2)}x the time allowed), -${penalty}`);
  }

  score = Math.round(Math.max(0, Math.min(100, score)) * 10) / 10;
  const tier: TrustTier = score < 40 ? 'new' : score < 70 ? 'standard' : 'trusted';
  return { score, tier, reasons };
}
