// Mirror-node indexer. Reads each active escrow's contract logs and updates money states from the on-chain events.
// Mirror node, not Hashio (rate limits). Log filtering by topic would need a timestamp range <= 7 days; we filter by timestamp only.
import { and, eq, inArray } from 'drizzle-orm';
import { decodeEventLog, type Hex } from 'viem';
import { db, schema } from '../db/index.js';
import { env } from '../env.js';
import { escrowAbi } from './abi.js';
import { dispatchAgreement } from '../lib/agentClient.js';

type MirrorLog = {
  address: string; data: string; topics: string[]; timestamp: string; transaction_hash: string; index: number;
};

async function fetchLogs(address: string, afterTs: string): Promise<MirrorLog[]> {
  const out: MirrorLog[] = [];
  let url: string | null = `${env.HEDERA_MIRROR_URL}/api/v1/contracts/${address}/results/logs?order=asc&limit=100&timestamp=gt:${afterTs}`;
  for (let page = 0; url && page < 20; page++) {
    const res: Response = await fetch(url, { headers: { accept: 'application/json' } });
    if (res.status === 404) return out; // contract not yet visible on the mirror node
    if (!res.ok) throw new Error(`mirror node ${res.status}`);
    const body = (await res.json()) as { logs: MirrorLog[]; links?: { next?: string | null } };
    out.push(...body.logs);
    url = body.links?.next ? `${env.HEDERA_MIRROR_URL}${body.links.next}` : null;
  }
  return out;
}

/**
 * Delegated(agreementId, subAgent, amount): make sure the a2a payment exists exactly once.
 * The /a2a/call route records the same tx hash; a unique index on a2a payments makes both writers idempotent.
 * If the route marked the call failed after the chain tx actually landed, the event heals the call to paid.
 */
export async function applyDelegated(agreement: typeof schema.agreements.$inferSelect, subAgent: string, amount: string, txHash: string) {
  await db.insert(schema.payments)
    .values({ agreementId: agreement.id, kind: 'a2a', amountTinybar: amount, txHash, status: 'confirmed' })
    .onConflictDoNothing();
  const calls = await db.select().from(schema.a2aCalls).where(eq(schema.a2aCalls.agreementId, agreement.id));
  const callees = await db.select({ id: schema.agents.id, payout: schema.agents.payoutAddress }).from(schema.agents);
  const payoutOf = new Map(callees.map((c) => [c.id, c.payout.toLowerCase()]));
  const healable = calls.find((c) =>
    c.status === 'failed' && (c.blockedReason ?? '').startsWith('Payment failed') &&
    c.priceTinybar === amount && payoutOf.get(c.calleeAgentId) === subAgent.toLowerCase());
  if (healable) {
    await db.update(schema.a2aCalls).set({ status: 'paid', blockedReason: null }).where(eq(schema.a2aCalls.id, healable.id));
  }
}

async function applyEvent(agreement: typeof schema.agreements.$inferSelect, eventName: string, args: Record<string, unknown>, txHash: string) {
  switch (eventName) {
    case 'Funded':
      await db.update(schema.agreements).set({ status: 'funded' }).where(and(eq(schema.agreements.id, agreement.id), eq(schema.agreements.status, 'agreed')));
      await db.insert(schema.payments).values({ agreementId: agreement.id, kind: 'fund', amountTinybar: String(args.amount), txHash, status: 'confirmed' });
      // Tell the agent to start. Background, never blocks or breaks the indexer; failures are stored and retryable.
      void dispatchAgreement(agreement.id).catch((e) => console.error(`[dispatch] ${agreement.id}: ${(e as Error).message}`));
      break;
    case 'Delegated':
      await applyDelegated(agreement, String(args.subAgent), String(args.amount), txHash);
      break;
    case 'Released':
    case 'Refunded': {
      const released = eventName === 'Released';
      await db
        .update(schema.agreements)
        .set({ status: released ? 'released' : 'refunded' })
        .where(and(eq(schema.agreements.id, agreement.id), inArray(schema.agreements.status, ['funded', 'submitted', 'verifying'])));
      const kind = released ? 'release' : 'refund';
      const updated = await db
        .update(schema.payments)
        .set({ status: 'confirmed', amountTinybar: String(args.amount), txHash })
        .where(and(eq(schema.payments.agreementId, agreement.id), eq(schema.payments.kind, kind), eq(schema.payments.status, 'pending')))
        .returning({ id: schema.payments.id });
      if (updated.length === 0) {
        await db.insert(schema.payments).values({ agreementId: agreement.id, kind, amountTinybar: String(args.amount), txHash, status: 'confirmed' });
      }
      break;
    }
    default:
      break; // Submitted is recorded in chain_events; its DB row is written when the backend sends it.
  }
}

async function indexEscrow(agreement: typeof schema.agreements.$inferSelect) {
  const address = agreement.escrowAddress!;
  const [cursor] = await db.select().from(schema.chainCursor).where(eq(schema.chainCursor.contract, address)).limit(1);
  const logs = await fetchLogs(address, cursor?.lastConsensusTs ?? '0');
  let last = cursor?.lastConsensusTs ?? '0';
  for (const log of logs) {
    let decoded: { eventName: string; args: Record<string, unknown> };
    try {
      decoded = decodeEventLog({ abi: escrowAbi, data: log.data as Hex, topics: log.topics as [Hex, ...Hex[]] }) as never;
    } catch {
      continue; // not one of our events
    }
    const inserted = await db
      .insert(schema.chainEvents)
      .values({
        contract: address, event: decoded.eventName, txHash: log.transaction_hash, logIndex: log.index, consensusTs: log.timestamp,
        args: JSON.parse(JSON.stringify(decoded.args, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))),
      })
      .onConflictDoNothing()
      .returning({ id: schema.chainEvents.id });
    if (inserted.length > 0) await applyEvent(agreement, decoded.eventName, decoded.args as Record<string, unknown>, log.transaction_hash);
    last = log.timestamp;
  }
  if (last !== (cursor?.lastConsensusTs ?? '0')) {
    await db.insert(schema.chainCursor).values({ contract: address, lastConsensusTs: last })
      .onConflictDoUpdate({ target: schema.chainCursor.contract, set: { lastConsensusTs: last } });
  }
}

let running = false;
export async function indexOnce() {
  if (running) return;
  running = true;
  try {
    const active = await db
      .select()
      .from(schema.agreements)
      .where(inArray(schema.agreements.status, ['agreed', 'funded', 'submitted', 'verifying']));
    for (const agreement of active) {
      if (!agreement.escrowAddress) continue;
      try { await indexEscrow(agreement); } catch (e) { console.error(`[indexer] ${agreement.escrowAddress}: ${(e as Error).message}`); }
      // Funded but never dispatched (e.g. the backend restarted mid-dispatch). Stored failures are retried manually.
      if (agreement.status === 'funded' && !agreement.dispatchedAt && !agreement.dispatchError) {
        void dispatchAgreement(agreement.id).catch(() => {});
      }
    }
  } finally {
    running = false;
  }
}

export function startIndexer(intervalMs = 5000) {
  if (env.INDEXER_ENABLED !== 'true') return () => {};
  const t = setInterval(() => { void indexOnce().catch((e) => console.error('[indexer]', e)); }, intervalMs);
  return () => clearInterval(t);
}
