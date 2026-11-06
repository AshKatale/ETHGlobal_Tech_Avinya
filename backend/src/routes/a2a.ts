import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { optionalAuth, requireAgent } from '../lib/auth.js';
import { canViewPrivate, publicCall } from '../lib/access.js';
import { env } from '../env.js';
import { canDelegateInStatus, remainingBudget, withinBudget } from '../lib/a2aBudget.js';
import { reserveA2aCall } from '../lib/a2aReserve.js';
import { assertSafeUrl, safeFetch } from '../lib/ssrf.js';
import { delegateOnChain, signDelegation } from '../chain/client.js';
import type { Address } from 'viem';

const MAX_DEPTH = 2;

async function evaluate(agreementId: string, callerAgentId: string, calleeAgentId: string) {
  const [agreement] = await db.select().from(schema.agreements).where(eq(schema.agreements.id, agreementId)).limit(1);
  if (!agreement) return { error: 'Agreement not found' as const };
  if (agreement.agentId !== callerAgentId) return { error: 'Caller is not the agent on this agreement' as const };
  if (!canDelegateInStatus(agreement.status)) return { error: `Agreement is ${agreement.status}; escrow must be funded` as const };

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

    const ev = await evaluate(call.agreementId, call.callerAgentId, call.calleeAgentId);
    if ('error' in ev) return reply.code(400).send({ error: ev.error });
    if (!ev.callee.endpointUrl) return reply.code(400).send({ error: 'Callee agent has no endpoint URL' });
    if (!ev.agreement.escrowAddress) return reply.code(400).send({ error: 'Agreement has no escrow' });
    // Refuse an unsafe callee URL before any money moves.
    try { await assertSafeUrl(ev.callee.endpointUrl); } catch (e) {
      return reply.code(400).send({ error: `Callee endpoint refused: ${(e as Error).message}` });
    }

    // Budget re-check plus quoted -> paid in one transaction under a per-agreement advisory lock.
    const reserved = await reserveA2aCall(call.id, req.agent!.id, env.A2A_MAX_PERCENT);
    if (!reserved.ok) return reply.code(reserved.code).send({ error: reserved.error });

    // Pay the callee out of the job's escrow (JobEscrow.delegate), authorised by a verifier-signed message.
    let payTx: string;
    try {
      const amount = BigInt(call.priceTinybar);
      const escrow = ev.agreement.escrowAddress as Address;
      const subAgent = ev.callee.payoutAddress as Address;
      const { sig, nonce } = await signDelegation(escrow, call.agreementId, subAgent, amount);
      payTx = (await delegateOnChain(escrow, subAgent, amount, nonce, sig)).hash;
    } catch (e) {
      // 'failed' here means no payment is known to have landed. If the tx did land, the Delegated indexer heals the row to 'paid'.
      await db.update(schema.a2aCalls).set({ status: 'failed', blockedReason: 'Payment failed' }).where(eq(schema.a2aCalls.id, call.id));
      return reply.code(502).send({ error: `Payment failed: ${(e as Error).message}` });
    }
    // The Delegated indexer may have recorded this tx already; the unique index on a2a payments makes this idempotent.
    await db.insert(schema.payments).values({ agreementId: call.agreementId, kind: 'a2a', amountTinybar: call.priceTinybar, txHash: payTx, status: 'confirmed' }).onConflictDoNothing();

    try {
      const res = await safeFetch(
        `${ev.callee.endpointUrl.replace(/\/$/, '')}/a2a`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...(env.AGENT_CALLBACK_SECRET ? { 'x-backend-key': env.AGENT_CALLBACK_SECRET } : {}) },
          body: JSON.stringify({ agreementId: call.agreementId, callId: call.id, input: body.input }),
        },
        { timeoutMs: 90_000, maxBytes: 1_000_000 },
      );
      if (!res.ok) throw new Error(`callee responded ${res.status}`);
      await db.update(schema.a2aCalls).set({ status: 'done' }).where(eq(schema.a2aCalls.id, call.id));
      let output: unknown = res.text;
      try { output = JSON.parse(res.text); } catch { /* keep text */ }
      return { status: 'done', output };
    } catch (e) {
      // The payment already went out, so the row stays 'paid' and keeps counting against the cap (never overwritten with 'failed').
      // Only a generic reason is stored: GET /agreements/:id/a2a is public and must not echo upstream text.
      await db.update(schema.a2aCalls).set({ blockedReason: 'Callee failed after payment' }).where(eq(schema.a2aCalls.id, call.id));
      return reply.code(502).send({ error: 'Callee failed after payment' });
    }
  });

  app.get('/agreements/:id/a2a', { preHandler: optionalAuth }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const [agreement] = await db.select().from(schema.agreements).where(eq(schema.agreements.id, id)).limit(1);
    const calls = await db.select().from(schema.a2aCalls).where(eq(schema.a2aCalls.agreementId, id));
    if (!agreement) return calls.map(publicCall); // keep the old behaviour (empty list) for an unknown id
    return (await canViewPrivate(req, agreement)) ? calls : calls.map(publicCall);
  });
}
