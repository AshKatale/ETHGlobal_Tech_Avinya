// Builds the provider's track record from OUR records (benchmark runs, agreements, payments, on-chain events).
// This is what the Solidity agent analyses; nothing here comes from what the agent says about itself.
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import type { AgentStats } from './client.js';

export async function buildAgentStats(agentId: string): Promise<AgentStats> {
  const [agent] = await db.select().from(schema.agents).where(eq(schema.agents.id, agentId)).limit(1);
  if (!agent) throw new Error('Agent not found');

  let benchmarkScore: number | null = null;
  if (agent.latestBenchmarkId) {
    const [run] = await db.select({ score: schema.benchmarkRuns.score }).from(schema.benchmarkRuns).where(eq(schema.benchmarkRuns.id, agent.latestBenchmarkId)).limit(1);
    if (run?.score != null) benchmarkScore = Number(run.score);
  }

  const agreements = await db.select().from(schema.agreements).where(eq(schema.agreements.agentId, agentId));
  const jobsCompleted = agreements.filter((a) => a.status === 'released').length;
  const jobsFailed = agreements.filter((a) => a.status === 'refunded').length;

  // How long the agent took compared with the time it was given, averaged over finished jobs.
  const finished = agreements.filter((a) => ['released', 'refunded'].includes(a.status) && a.deadlineAt);
  let avgDeliveryRatio: number | null = null;
  if (finished.length) {
    const ids = finished.map((a) => a.id);
    const subs = await db.select().from(schema.submissions).where(inArray(schema.submissions.agreementId, ids));
    const funds = await db.select().from(schema.payments).where(and(inArray(schema.payments.agreementId, ids), eq(schema.payments.kind, 'fund')));
    const ratios: number[] = [];
    for (const a of finished) {
      const sub = subs.find((s) => s.agreementId === a.id);
      const fund = funds.find((f) => f.agreementId === a.id);
      if (!sub || !fund) continue;
      const allowed = a.deadlineAt!.getTime() - fund.createdAt.getTime();
      const taken = sub.submittedAt.getTime() - fund.createdAt.getTime();
      if (allowed > 0 && taken >= 0) ratios.push(taken / allowed);
    }
    if (ratios.length) avgDeliveryRatio = ratios.reduce((x, y) => x + y, 0) / ratios.length;
  }

  // Debts this agent (as the paying side of an A -> B leg) let default on-chain.
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.subLegs)
    .innerJoin(schema.agreements, eq(schema.agreements.id, schema.subLegs.agreementId))
    .where(and(eq(schema.agreements.agentId, agentId), eq(schema.subLegs.status, 'defaulted')));

  return { benchmarkScore, jobsCompleted, jobsFailed, payoutDefaults: count, avgDeliveryRatio };
}
