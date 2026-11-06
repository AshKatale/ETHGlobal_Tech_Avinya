// Mirror-node indexer. Reads each active escrow's contract logs and updates money states from the on-chain events.
// Mirror node, not Hashio (rate limits). Log filtering by topic would need a timestamp range <= 7 days; we filter by timestamp only.
import { and, eq, inArray } from 'drizzle-orm';
import { decodeEventLog, type Hex } from 'viem';
import { db, schema } from '../db/index.js';
import { env } from '../env.js';
import { escrowAbi } from './abi.js';

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

async function applyEvent(agreement: typeof schema.agreements.$inferSelect, eventName: string, args: Record<string, unknown>, txHash: string) {
  switch (eventName) {
    case 'Funded':
      await db.update(schema.agreements).set({ status: 'funded' }).where(and(eq(schema.agreements.id, agreement.id), eq(schema.agreements.status, 'agreed')));
      await db.insert(schema.payments).values({ agreementId: agreement.id, kind: 'fund', amountTinybar: String(args.amount), txHash, status: 'confirmed' });
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
      break; // Submitted and Delegated are recorded in chain_events; their DB rows are written when the backend sends them.
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
