// Public numbers about agents that the marketplace shows: benchmark score, pass rate and earnings.
// They come from our own records (benchmark runs, agreements, payments, sub-agent legs).
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';

export type AgentSummary = {
  score: number | null;
  customScore: number | null;
  aiScore: number | null;
  jobsCompleted: number; // released to the agent
  jobsFailed: number; // refunded to the client
  earnedTinybar: string; // paid to the agent, net of what it paid its own sub-agents, plus what it earned as a sub-agent
};

const num = (v: string | null | undefined) => (v == null ? null : Number(v));

export async function summarizeAgents(agents: { id: string; latestBenchmarkId: string | null }[]): Promise<Map<string, AgentSummary>> {
  const out = new Map<string, AgentSummary>();
  if (!agents.length) return out;
  const ids = agents.map((a) => a.id);
  const benchIds = agents.map((a) => a.latestBenchmarkId).filter((x): x is string => !!x);

  const benches = benchIds.length ? await db.select().from(schema.benchmarkRuns).where(inArray(schema.benchmarkRuns.id, benchIds)) : [];
  const benchById = new Map(benches.map((b) => [b.id, b]));

  const counts = await db
    .select({ agentId: schema.agreements.agentId, status: schema.agreements.status, n: sql<number>`count(*)::int` })
    .from(schema.agreements)
    .where(inArray(schema.agreements.agentId, ids))
    .groupBy(schema.agreements.agentId, schema.agreements.status);

  const released = await db
    .select({ agentId: schema.agreements.agentId, total: sql<string>`coalesce(sum(${schema.payments.amountTinybar}),0)::text` })
    .from(schema.payments)
    .innerJoin(schema.agreements, eq(schema.agreements.id, schema.payments.agreementId))
    .where(and(inArray(schema.agreements.agentId, ids), eq(schema.payments.kind, 'release'), eq(schema.payments.status, 'confirmed')))
    .groupBy(schema.agreements.agentId);

  const receivedAsSub = await db
    .select({ agentId: schema.subLegs.calleeAgentId, total: sql<string>`coalesce(sum(${schema.subLegs.priceTinybar}),0)::text` })
    .from(schema.subLegs)
    .where(and(inArray(schema.subLegs.calleeAgentId, ids), eq(schema.subLegs.status, 'paid')))
    .groupBy(schema.subLegs.calleeAgentId);

  const paidOut = await db
    .select({ agentId: schema.agreements.agentId, total: sql<string>`coalesce(sum(${schema.subLegs.priceTinybar}),0)::text` })
    .from(schema.subLegs)
    .innerJoin(schema.agreements, eq(schema.agreements.id, schema.subLegs.agreementId))
    .where(and(inArray(schema.agreements.agentId, ids), eq(schema.subLegs.status, 'paid')))
    .groupBy(schema.agreements.agentId);

  for (const a of agents) {
    const b = a.latestBenchmarkId ? benchById.get(a.latestBenchmarkId) : undefined;
    const n = (status: string) => counts.find((c) => c.agentId === a.id && c.status === status)?.n ?? 0;
    const big = (rows: { agentId: string; total: string }[]) => BigInt(rows.find((r) => r.agentId === a.id)?.total ?? '0');
    const earned = big(released) + big(receivedAsSub) - big(paidOut);
    out.set(a.id, {
      score: num(b?.score), customScore: num(b?.customScore), aiScore: num(b?.aiScore),
      jobsCompleted: n('released'), jobsFailed: n('refunded'),
      earnedTinybar: (earned < 0n ? 0n : earned).toString(),
    });
  }
  return out;
}
