// Atomic budget reservation for an A2A call: the budget check and the quoted -> paid update run in one
// transaction behind a per-agreement advisory lock, so two simultaneous calls cannot overspend the cap.
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db as defaultDb, schema } from '../db/index.js';
import { canDelegateInStatus, withinBudget } from './a2aBudget.js';

export type Reservation =
  | { ok: true; call: typeof schema.a2aCalls.$inferSelect }
  | { ok: false; code: 403 | 404 | 409; error: string };

export async function reserveA2aCall(
  callId: string,
  callerAgentId: string,
  maxPercent: number,
  database: typeof defaultDb = defaultDb,
): Promise<Reservation> {
  const [first] = await database.select().from(schema.a2aCalls).where(eq(schema.a2aCalls.id, callId)).limit(1);
  if (!first || first.callerAgentId !== callerAgentId) return { ok: false, code: 404, error: 'Call not found' };

  return database.transaction(async (tx): Promise<Reservation> => {
    // Serialises all reservations for this agreement until commit.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${first.agreementId}))`);

    const [call] = await tx.select().from(schema.a2aCalls).where(eq(schema.a2aCalls.id, callId)).limit(1);
    if (!call || call.callerAgentId !== callerAgentId) return { ok: false, code: 404, error: 'Call not found' };
    if (call.status !== 'quoted') return { ok: false, code: 409, error: `Call is ${call.status}` };

    const [agreement] = await tx.select().from(schema.agreements).where(eq(schema.agreements.id, call.agreementId)).limit(1);
    if (!agreement) return { ok: false, code: 404, error: 'Agreement not found' };
    if (!canDelegateInStatus(agreement.status)) return { ok: false, code: 409, error: `Agreement is ${agreement.status}; escrow must be funded` };

    const spentRows = await tx
      .select({ price: schema.a2aCalls.priceTinybar })
      .from(schema.a2aCalls)
      .where(and(eq(schema.a2aCalls.agreementId, call.agreementId), inArray(schema.a2aCalls.status, ['paid', 'done'])));
    const spent = spentRows.reduce((s, r) => s + BigInt(r.price), 0n);

    if (!withinBudget({ jobPrice: BigInt(agreement.priceTinybar), alreadySpent: spent, price: BigInt(call.priceTinybar), maxPercent })) {
      await tx.update(schema.a2aCalls).set({ status: 'blocked', blockedReason: 'Budget exceeded at call time' }).where(eq(schema.a2aCalls.id, call.id));
      return { ok: false, code: 403, error: 'Budget exceeded' };
    }
    // Reserve: 'paid' counts against the cap from here on. The route reverts to 'failed' if the on-chain payment fails.
    await tx.update(schema.a2aCalls).set({ status: 'paid' }).where(eq(schema.a2aCalls.id, call.id));
    return { ok: true, call: { ...call, status: 'paid' } };
  });
}
