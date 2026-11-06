// Read-side helpers that add display fields (latest benchmark score, agent names, tx hashes, timestamps). Additive only.
import { and, eq, inArray } from 'drizzle-orm';
import { db, schema } from '../db/index.js';

/** agentId -> latest benchmark score (numeric string) or null. */
export async function latestScores(agents: { id: string; latestBenchmarkId: string | null }[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>(agents.map((a) => [a.id, null]));
  const benchIds = agents.map((a) => a.latestBenchmarkId).filter((x): x is string => !!x);
  if (!benchIds.length) return out;
  const runs = await db.select({ id: schema.benchmarkRuns.id, score: schema.benchmarkRuns.score }).from(schema.benchmarkRuns).where(inArray(schema.benchmarkRuns.id, benchIds));
  const scoreOf = new Map(runs.map((r) => [r.id, r.score]));
  for (const a of agents) if (a.latestBenchmarkId) out.set(a.id, scoreOf.get(a.latestBenchmarkId) ?? null);
  return out;
}

type CallLike = { id: string; priceTinybar: string; status: string; createdAt: Date };
type PayLike = { amountTinybar: string; txHash: string | null; createdAt: Date; kind: string };

/**
 * Link each paid a2a call to its delegate payment. payments carry no call id, so match on amount in creation order,
 * using each payment once. Calls that never paid get null.
 */
export function matchA2aTxHashes(calls: CallLike[], payments: PayLike[]): Map<string, string | null> {
  const pool = payments.filter((p) => p.kind === 'a2a' && p.txHash).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const used = new Set<number>();
  const out = new Map<string, string | null>();
  for (const c of [...calls].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
    out.set(c.id, null);
    if (c.status !== 'paid' && c.status !== 'done') continue;
    const i = pool.findIndex((p, idx) => !used.has(idx) && p.amountTinybar === c.priceTinybar);
    if (i >= 0) { used.add(i); out.set(c.id, pool[i].txHash); }
  }
  return out;
}

/** Hedera consensus timestamp "seconds.nanos" -> Date. */
export const consensusToDate = (ts: string) => new Date(Math.floor(Number(ts.split('.')[0]) * 1000));

export async function agreementTimestamps(agreement: { id: string; escrowAddress: string | null; createdAt: Date }) {
  let fundedAt: Date | null = null;
  if (agreement.escrowAddress) {
    const [ev] = await db.select({ ts: schema.chainEvents.consensusTs }).from(schema.chainEvents)
      .where(and(eq(schema.chainEvents.contract, agreement.escrowAddress), eq(schema.chainEvents.event, 'Funded'))).limit(1);
    if (ev) fundedAt = consensusToDate(ev.ts);
  }
  const payments = await db.select().from(schema.payments).where(eq(schema.payments.agreementId, agreement.id));
  const settled = payments.filter((p) => (p.kind === 'release' || p.kind === 'refund') && p.status === 'confirmed').sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  if (!fundedAt) {
    const fund = payments.find((p) => p.kind === 'fund' && p.status === 'confirmed');
    if (fund) fundedAt = fund.createdAt;
  }
  return { fundedAt, settledAt: settled[0]?.createdAt ?? null, payments };
}
