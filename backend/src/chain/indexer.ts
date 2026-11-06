// Mirror-node indexer. Reads each active task contract's logs and updates money states from the on-chain events.
// Mirror node, not Hashio (rate limits). Log filtering by topic would need a timestamp range <= 7 days; we filter by timestamp only.
import { and, eq, inArray } from 'drizzle-orm';
import { decodeEventLog, type Address, type Hex } from 'viem';
import { db, schema } from '../db/index.js';
import { env } from '../env.js';
import { taskEscrowAbi } from './abi.js';
import { markDefaultOnChain, readTaskTerms } from './client.js';
import { notifyPayoutsDue } from './ops.js';
import { dispatchTask } from '../agents/dispatch.js';

type MirrorLog = { address: string; data: string; topics: string[]; timestamp: string; transaction_hash: string; index: number };

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

type Agreement = typeof schema.agreements.$inferSelect;

async function applyEvent(agreement: Agreement, eventName: string, args: Record<string, unknown>, txHash: string) {
  switch (eventName) {
    case 'Funded': {
      await db.update(schema.agreements).set({ status: 'funded' }).where(and(eq(schema.agreements.id, agreement.id), eq(schema.agreements.status, 'agreed')));
      // Complete the pending x402 funding row if the gateway created one; otherwise (wallet fund()) insert it.
      const done = await db.update(schema.payments)
        .set({ status: 'confirmed', amountTinybar: String(args.amount), txHash })
        .where(and(eq(schema.payments.agreementId, agreement.id), eq(schema.payments.kind, 'fund'), eq(schema.payments.status, 'pending')))
        .returning({ id: schema.payments.id });
      if (done.length === 0) await db.insert(schema.payments).values({ agreementId: agreement.id, kind: 'fund', amountTinybar: String(args.amount), txHash, status: 'confirmed' });
      // The money is locked: tell the agent to start work.
      void dispatchTask(agreement.id).catch((e) => console.error('[indexer] dispatchTask', e));
      break;
    }
    case 'Released':
    case 'Refunded': {
      const released = eventName === 'Released';
      await db.update(schema.agreements).set({ status: released ? 'released' : 'refunded' })
        .where(and(eq(schema.agreements.id, agreement.id), inArray(schema.agreements.status, ['funded', 'submitted', 'verifying'])));
      const kind = released ? 'release' : 'refund';
      const updated = await db.update(schema.payments)
        .set({ status: 'confirmed', amountTinybar: String(args.amount), txHash })
        .where(and(eq(schema.payments.agreementId, agreement.id), eq(schema.payments.kind, kind), eq(schema.payments.status, 'pending')))
        .returning({ id: schema.payments.id });
      if (updated.length === 0) await db.insert(schema.payments).values({ agreementId: agreement.id, kind, amountTinybar: String(args.amount), txHash, status: 'confirmed' });
      // A has been paid by the contract; tell it who it now owes and where to pay (over x402).
      if (released) void notifyPayoutsDue(agreement.id);
      break;
    }
    case 'PayoutRecorded':
      await db.update(schema.subLegs).set({ status: 'paid', payoutTx: String(args.hederaTxId) })
        .where(and(eq(schema.subLegs.agreementId, agreement.id), eq(schema.subLegs.legId, Number(args.legId))));
      break;
    case 'PayoutDefaulted':
      await db.update(schema.subLegs).set({ status: 'defaulted' })
        .where(and(eq(schema.subLegs.agreementId, agreement.id), eq(schema.subLegs.legId, Number(args.legId))));
      break;
    default:
      break; // Submitted and SubLegAdded are recorded in chain_events; their DB rows are written when the backend sends them.
  }
}

async function indexTask(agreement: Agreement) {
  const address = agreement.escrowAddress!;
  const [cursor] = await db.select().from(schema.chainCursor).where(eq(schema.chainCursor.contract, address)).limit(1);
  const logs = await fetchLogs(address, cursor?.lastConsensusTs ?? '0');
  let last = cursor?.lastConsensusTs ?? '0';
  for (const log of logs) {
    let decoded: { eventName: string; args: Record<string, unknown> };
    try {
      decoded = decodeEventLog({ abi: taskEscrowAbi, data: log.data as Hex, topics: log.topics as [Hex, ...Hex[]] }) as never;
    } catch {
      continue; // not one of our events
    }
    const inserted = await db.insert(schema.chainEvents).values({
      contract: address, event: decoded.eventName, txHash: log.transaction_hash, logIndex: log.index, consensusTs: log.timestamp,
      args: JSON.parse(JSON.stringify(decoded.args, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))),
    }).onConflictDoNothing().returning({ id: schema.chainEvents.id });
    if (inserted.length > 0) await applyEvent(agreement, decoded.eventName, decoded.args as Record<string, unknown>, log.transaction_hash);
    last = log.timestamp;
  }
  if (last !== (cursor?.lastConsensusTs ?? '0')) {
    await db.insert(schema.chainCursor).values({ contract: address, lastConsensusTs: last })
      .onConflictDoUpdate({ target: schema.chainCursor.contract, set: { lastConsensusTs: last } });
  }
}

/** A released task whose sub-agents were not paid within the grace period: mark each debt defaulted on-chain. */
async function markOverdueDefaults() {
  const pending = await db.select({ leg: schema.subLegs, agreement: schema.agreements })
    .from(schema.subLegs).innerJoin(schema.agreements, eq(schema.agreements.id, schema.subLegs.agreementId))
    .where(and(eq(schema.subLegs.status, 'pending'), eq(schema.agreements.status, 'released')));
  const now = Math.floor(Date.now() / 1000);
  for (const { leg, agreement } of pending) {
    try {
      const t = await readTaskTerms(agreement.escrowAddress as Address);
      if (t.releasedAt > 0 && now > t.releasedAt + t.payoutGrace) await markDefaultOnChain(agreement.escrowAddress as Address, leg.legId);
    } catch (e) { console.error(`[indexer] markDefault ${agreement.escrowAddress}/${leg.legId}: ${(e as Error).message}`); }
  }
}

let running = false;
export async function indexOnce() {
  if (running) return;
  running = true;
  try {
    const active = await db.select().from(schema.agreements).where(inArray(schema.agreements.status, ['agreed', 'funded', 'submitted', 'verifying']));
    // Released tasks stay indexed while a sub-agent is still owed: PayoutRecorded / PayoutDefaulted arrive after release.
    const owing = await db.select({ agreement: schema.agreements }).from(schema.subLegs)
      .innerJoin(schema.agreements, eq(schema.agreements.id, schema.subLegs.agreementId))
      .where(and(eq(schema.subLegs.status, 'pending'), eq(schema.agreements.status, 'released')));
    const seen = new Set<string>();
    for (const agreement of [...active, ...owing.map((o) => o.agreement)]) {
      if (!agreement.escrowAddress || seen.has(agreement.id)) continue;
      seen.add(agreement.id);
      try { await indexTask(agreement); } catch (e) { console.error(`[indexer] ${agreement.escrowAddress}: ${(e as Error).message}`); }
    }
    await markOverdueDefaults();
  } finally {
    running = false;
  }
}

export function startIndexer(intervalMs = 5000) {
  if (env.INDEXER_ENABLED !== 'true') return () => {};
  const t = setInterval(() => { void indexOnce().catch((e) => console.error('[indexer]', e)); }, intervalMs);
  return () => clearInterval(t);
}
