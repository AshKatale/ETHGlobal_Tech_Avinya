// Agent-to-agent hiring. Agent A hires sub-agent B inside the SAME task contract (max 2 hops: client -> A -> B).
// B's price is added as a leg of the contract; after the whole task is released, A pays B over x402.
import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { requireAgent } from '../lib/auth.js';
import { createSubLeg, payoutUrl } from '../chain/ops.js';
import { readTaskTerms } from '../chain/client.js';
import type { Address } from 'viem';

/** Why a hire is not allowed right now, or null. Mirrors the contract's own checks so the reason is readable. */
async function blockReason(agreementId: string, callerAgentId: string, calleeAgentId: string) {
  const [agreement] = await db.select().from(schema.agreements).where(eq(schema.agreements.id, agreementId)).limit(1);
  if (!agreement) return { error: 'Agreement not found' as const };
  // Only the agent on the client leg can hire: a sub-agent cannot hire further (that would be a third hop).
  if (agreement.agentId !== callerAgentId) return { error: 'Only the agent on this agreement can hire sub-agents (max 2 hops)' as const };
  if (!['funded', 'submitted'].includes(agreement.status)) return { error: `Agreement is ${agreement.status}; the task must be funded first` as const };
  if (!agreement.escrowAddress) return { error: 'Agreement has no task contract' as const };
  const [callee] = await db.select().from(schema.agents).where(eq(schema.agents.id, calleeAgentId)).limit(1);
  if (!callee) return { error: 'Callee agent not found' as const };

  let reason: string | null = null;
  const price = BigInt(callee.priceTinybar);
  const t = await readTaskTerms(agreement.escrowAddress as Address);
  if (callee.status !== 'listed') reason = 'Callee agent is not listed';
  else if (callee.id === callerAgentId) reason = 'An agent cannot hire itself';
  else if (price <= 0n) reason = 'Callee has no price';
  else if (t.subLegCount >= t.maxSubLegs) reason = `Sub-agent limit reached (${t.maxSubLegs})`;
  else if ((t.subTotal + price) * 10_000n > t.price * BigInt(t.maxSubBps)) reason = `Would exceed the ${(t.maxSubBps / 100).toFixed(2)}% sub-agent spending cap for this task`;

  const cap = (t.price * BigInt(t.maxSubBps)) / 10_000n;
  return { agreement, callee, price, reason, remaining: cap > t.subTotal ? cap - t.subTotal : 0n };
}

export async function a2aRoutes(app: FastifyInstance) {
  // Ask whether hiring B is allowed (and for how much) before committing.
  app.post('/a2a/quote', { preHandler: requireAgent }, async (req, reply) => {
    const body = z.object({ agreementId: z.string().uuid(), calleeAgentId: z.string().uuid() }).parse(req.body);
    const r = await blockReason(body.agreementId, req.agent!.id, body.calleeAgentId);
    if ('error' in r) return reply.code(400).send({ error: r.error });

    const [call] = await db.insert(schema.a2aCalls).values({
      agreementId: body.agreementId, callerAgentId: req.agent!.id, calleeAgentId: body.calleeAgentId,
      priceTinybar: r.price.toString(), rail: 'x402', status: r.reason ? 'blocked' : 'quoted', blockedReason: r.reason, depth: 2,
    }).returning();
    if (r.reason) return reply.code(403).send({ allowed: false, reason: r.reason, callId: call.id, remainingBudgetTinybar: r.remaining.toString() });
    return { allowed: true, callId: call.id, priceTinybar: r.price.toString(), remainingBudgetTinybar: r.remaining.toString(), payment: 'x402, after the task is released' };
  });

  // Commit the hire: the leg is added to the contract on-chain, then the sub-task is sent to B and B's result is returned to A.
  app.post('/a2a/call', { preHandler: requireAgent }, async (req, reply) => {
    const body = z.object({ callId: z.string().uuid(), input: z.unknown() }).parse(req.body);
    const [call] = await db.select().from(schema.a2aCalls).where(and(eq(schema.a2aCalls.id, body.callId), eq(schema.a2aCalls.callerAgentId, req.agent!.id))).limit(1);
    if (!call) return reply.code(404).send({ error: 'Call not found' });
    if (call.status !== 'quoted') return reply.code(409).send({ error: `Call is ${call.status}` });

    const r = await blockReason(call.agreementId, call.callerAgentId, call.calleeAgentId);
    if ('error' in r) return reply.code(400).send({ error: r.error });
    if (r.reason) {
      await db.update(schema.a2aCalls).set({ status: 'blocked', blockedReason: r.reason }).where(eq(schema.a2aCalls.id, call.id));
      return reply.code(403).send({ error: r.reason });
    }
    if (!r.callee.endpointUrl) return reply.code(400).send({ error: 'Callee agent has no endpoint URL' });

    const subtask = typeof body.input === 'string' ? body.input : JSON.stringify(body.input ?? {});
    let leg;
    try {
      leg = (await createSubLeg({ agreementId: call.agreementId, calleeAgentId: call.calleeAgentId, subtask })).leg;
    } catch (e) {
      await db.update(schema.a2aCalls).set({ status: 'failed', blockedReason: `Could not add the leg: ${(e as Error).message}` }).where(eq(schema.a2aCalls.id, call.id));
      return reply.code(502).send({ error: (e as Error).message });
    }
    await db.update(schema.a2aCalls).set({ status: 'committed' }).where(eq(schema.a2aCalls.id, call.id));
    await db.update(schema.subLegs).set({ a2aCallId: call.id }).where(eq(schema.subLegs.id, leg.id));

    try {
      const res = await fetch(`${r.callee.endpointUrl.replace(/\/$/, '')}/a2a`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ agreementId: call.agreementId, callId: call.id, legId: leg.legId, input: body.input }),
        signal: AbortSignal.timeout(90_000),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`callee responded ${res.status}: ${text.slice(0, 200)}`);
      await db.update(schema.a2aCalls).set({ status: 'done' }).where(eq(schema.a2aCalls.id, call.id));
      let output: unknown = text;
      try { output = JSON.parse(text); } catch { /* keep text */ }
      return { status: 'done', legId: leg.legId, priceTinybar: String(leg.priceTinybar), payUrl: payoutUrl(call.agreementId, leg.legId), output };
    } catch (e) {
      // The leg stays on the contract (it can only be paid after release, so a failed sub-task costs nothing yet).
      await db.update(schema.a2aCalls).set({ status: 'failed', blockedReason: (e as Error).message }).where(eq(schema.a2aCalls.id, call.id));
      return reply.code(502).send({ error: `Callee failed: ${(e as Error).message}`, legId: leg.legId });
    }
  });

  app.get('/agreements/:id/a2a', async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const calls = await db.select().from(schema.a2aCalls).where(eq(schema.a2aCalls.agreementId, id));
    const legs = await db.select().from(schema.subLegs).where(eq(schema.subLegs.agreementId, id));
    return { calls, legs: legs.map((l) => ({ ...l, payUrl: payoutUrl(id, l.legId) })) };
  });
}
