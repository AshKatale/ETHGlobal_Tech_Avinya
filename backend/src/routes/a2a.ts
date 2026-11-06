import type { FastifyInstance } from 'fastify';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { requireAgent } from '../lib/auth.js';
import { env } from '../env.js';
import { remainingBudget, withinBudget } from '../lib/a2aBudget.js';
import { delegateOnChain, signDelegation } from '../chain/client.js';
import type { Address } from 'viem';

const MAX_DEPTH = 2;

async function evaluate(agreementId: string, callerAgentId: string, calleeAgentId: string) {
  const [agreement] = await db.select().from(schema.agreements).where(eq(schema.agreements.id, agreementId)).limit(1);
  if (!agreement) return { error: 'Agreement not found' as const };
  if (agreement.agentId !== callerAgentId) return { error: 'Caller is not the agent on this agreement' as const };
  if (!['funded', 'submitted'].includes(agreement.status)) return { error: `Agreement is ${agreement.status}; escrow must be funded` as const };

  const [callee] = await db.select().from(schema.agents).where(eq(schema.agents.id, calleeAgentId)).limit(1);
  if (!callee) return { error: 'Callee agent not found' as const };

  const prior = await db.select().from(schema.a2aCalls).where(eq(schema.a2aCalls.agreementId, agreementId));
  const alreadySpent = prior
    .filter((c) => c.status === 'paid' || c.status === 'done')
    .reduce((sum, c) => sum + BigInt(c.priceTinybar), 0n);
  // Depth: a call made by an agent that was itself called in this agreement is one level deeper.
  const asCallee = prior.filter((c) => c.calleeAgentId === callerAgentId && c.status !== 'blocked');
  const depth = asCallee.length ? Math.max(...asCallee.map((c) => c.depth)) + 1 : 1;

  return { agreement, callee, alreadySpent, depth, price: BigInt(callee.priceTinybar), jobPrice: BigInt(agreement.priceTinybar) };
}

export async function a2aRoutes(app: FastifyInstance) {
  // Ask for a quote, and learn whether the spend would be allowed.
  app.post('/a2a/quote', { preHandler: requireAgent }, async (req, reply) => {
    const body = z.object({ agreementId: z.string().uuid(), calleeAgentId: z.string().uuid() }).parse(req.body);
    const ev = await evaluate(body.agreementId, req.agent!.id, body.calleeAgentId);
    if ('error' in ev) return reply.code(400).send({ error: ev.error });

    let blockedReason: string | null = null;
    if (ev.callee.status !== 'listed') blockedReason = 'Callee agent is not listed';
    else if (ev.callee.id === req.agent!.id) blockedReason = 'An agent cannot hire itself';
    else if (ev.depth > MAX_DEPTH) blockedReason = `Max depth of ${MAX_DEPTH} hops exceeded`;
    else if (!withinBudget({ jobPrice: ev.jobPrice, alreadySpent: ev.alreadySpent, price: ev.price, maxPercent: env.A2A_MAX_PERCENT })) {
      blockedReason = `Would exceed the ${env.A2A_MAX_PERCENT}% A2A budget for this job`;
    }

    const [call] = await db
      .insert(schema.a2aCalls)
      .values({
        agreementId: body.agreementId,
        callerAgentId: req.agent!.id,
        calleeAgentId: body.calleeAgentId,
        priceTinybar: ev.price.toString(),
        status: blockedReason ? 'blocked' : 'quoted',
        blockedReason,
        depth: ev.depth,
      })
      .returning();

    const remaining = remainingBudget({ jobPrice: ev.jobPrice, alreadySpent: ev.alreadySpent, maxPercent: env.A2A_MAX_PERCENT });
    if (blockedReason) return reply.code(403).send({ allowed: false, reason: blockedReason, callId: call.id, remainingBudgetTinybar: remaining.toString() });
    return { allowed: true, callId: call.id, priceTinybar: ev.price.toString(), remainingBudgetTinybar: remaining.toString() };
  });

  // Pay (JobEscrow.delegate) and call the callee.
  app.post('/a2a/call', { preHandler: requireAgent }, async (req, reply) => {
    const body = z.object({ callId: z.string().uuid(), input: z.unknown() }).parse(req.body);
    const [call] = await db.select().from(schema.a2aCalls).where(eq(schema.a2aCalls.id, body.callId)).limit(1);
    if (!call || call.callerAgentId !== req.agent!.id) return reply.code(404).send({ error: 'Call not found' });
    if (call.status !== 'quoted') return reply.code(409).send({ error: `Call is ${call.status}` });

    // Re-check the budget now, in case other calls were paid since the quote.
    const ev = await evaluate(call.agreementId, call.callerAgentId, call.calleeAgentId);
    if ('error' in ev) return reply.code(400).send({ error: ev.error });
    const others = await db
      .select()
      .from(schema.a2aCalls)
      .where(and(eq(schema.a2aCalls.agreementId, call.agreementId), inArray(schema.a2aCalls.status, ['paid', 'done'])));
    const spent = others.reduce((s, c) => s + BigInt(c.priceTinybar), 0n);
    if (!withinBudget({ jobPrice: ev.jobPrice, alreadySpent: spent, price: BigInt(call.priceTinybar), maxPercent: env.A2A_MAX_PERCENT })) {
      await db.update(schema.a2aCalls).set({ status: 'blocked', blockedReason: 'Budget exceeded at call time' }).where(eq(schema.a2aCalls.id, call.id));
      return reply.code(403).send({ error: 'Budget exceeded' });
    }
    if (!ev.callee.endpointUrl) return reply.code(400).send({ error: 'Callee agent has no endpoint URL' });

    // Pay the callee out of the job's escrow (JobEscrow.delegate), authorised by a verifier-signed message.
    if (!ev.agreement.escrowAddress) return reply.code(400).send({ error: 'Agreement has no escrow' });
    let payTx: string;
    try {
      const amount = BigInt(call.priceTinybar);
      const escrow = ev.agreement.escrowAddress as Address;
      const subAgent = ev.callee.payoutAddress as Address;
      const { sig, nonce } = await signDelegation(escrow, call.agreementId, subAgent, amount);
      payTx = (await delegateOnChain(escrow, subAgent, amount, nonce, sig)).hash;
    } catch (e) {
      await db.update(schema.a2aCalls).set({ status: 'failed', blockedReason: `Payment failed: ${(e as Error).message}` }).where(eq(schema.a2aCalls.id, call.id));
      return reply.code(502).send({ error: `Payment failed: ${(e as Error).message}` });
    }
    await db.update(schema.a2aCalls).set({ status: 'paid' }).where(eq(schema.a2aCalls.id, call.id));
    await db.insert(schema.payments).values({ agreementId: call.agreementId, kind: 'a2a', amountTinybar: call.priceTinybar, txHash: payTx, status: 'confirmed' });

    try {
      const res = await fetch(`${ev.callee.endpointUrl.replace(/\/$/, '')}/a2a`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ agreementId: call.agreementId, callId: call.id, input: body.input }),
        signal: AbortSignal.timeout(90_000),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`callee responded ${res.status}: ${text.slice(0, 200)}`);
      await db.update(schema.a2aCalls).set({ status: 'done' }).where(eq(schema.a2aCalls.id, call.id));
      let output: unknown = text;
      try { output = JSON.parse(text); } catch { /* keep text */ }
      return { status: 'done', output };
    } catch (e) {
      await db.update(schema.a2aCalls).set({ status: 'failed', blockedReason: (e as Error).message }).where(eq(schema.a2aCalls.id, call.id));
      return reply.code(502).send({ error: `Callee failed: ${(e as Error).message}` });
    }
  });

  app.get('/agreements/:id/a2a', async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return db.select().from(schema.a2aCalls).where(eq(schema.a2aCalls.agreementId, id));
  });
}
