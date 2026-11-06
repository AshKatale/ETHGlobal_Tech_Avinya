import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { requireAgent, requireUser } from '../lib/auth.js';
import { ensureTask, fundUrl, loadDesignInputs, payoutUrl } from '../chain/ops.js';
import { requestDesign } from '../designer/client.js';
import { dispatchTask, requestQuotes } from '../agents/dispatch.js';

const tinybarStr = z.string().regex(/^\d+$/, 'tinybar must be a whole-number string');
const idParam = z.object({ id: z.string().uuid() });

const CHECKS = ['build_config', 'lint_rules', 'secrets_scan', 'dependency_check', 'security_review'] as const;

export async function marketplaceRoutes(app: FastifyInstance) {
  // ---------- requests ----------
  app.post('/requests', { preHandler: requireUser }, async (req, reply) => {
    const body = z
      .object({
        title: z.string().min(1).max(200),
        requirements: z.string().min(10).max(10000),
        checksRequested: z.array(z.enum(CHECKS)).default([]),
        budgetTinybar: tinybarStr,
        deadlineAt: z.string().datetime().optional(),
      })
      .parse(req.body);
    const [row] = await db
      .insert(schema.requests)
      .values({
        clientUserId: req.user!.id,
        title: body.title,
        requirements: body.requirements,
        checksRequested: body.checksRequested,
        budgetTinybar: body.budgetTinybar,
        deadlineAt: body.deadlineAt ? new Date(body.deadlineAt) : null,
      })
      .returning();
    // Ask the listed agents for quotes in the background; their quotes appear on GET /requests/:id as they answer.
    void requestQuotes(row.id)
      .then((r) => app.log.info({ requestId: row.id, ...r }, 'quote requests sent'))
      .catch((e) => app.log.error(e, 'quote fan-out failed'));
    return reply.code(201).send({ ...row, quoting: 'started' });
  });

  // Ask the agents again (e.g. a new agent was listed, or an agent was down the first time).
  app.post('/requests/:id/request-quotes', { preHandler: requireUser }, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const [request] = await db.select().from(schema.requests).where(eq(schema.requests.id, id)).limit(1);
    if (!request) return reply.code(404).send({ error: 'Request not found' });
    if (request.clientUserId !== req.user!.id) return reply.code(403).send({ error: 'Not your request' });
    return requestQuotes(id);
  });

  app.get('/requests', async (req) => {
    const q = z.object({ status: z.string().optional() }).parse(req.query);
    const rows = await db.select().from(schema.requests).orderBy(desc(schema.requests.createdAt));
    return q.status ? rows.filter((r) => r.status === q.status) : rows;
  });

  app.get('/requests/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const [request] = await db.select().from(schema.requests).where(eq(schema.requests.id, id)).limit(1);
    if (!request) return reply.code(404).send({ error: 'Request not found' });
    const quotes = await db.select().from(schema.quotes).where(eq(schema.quotes.requestId, id));
    return { request, quotes };
  });

  // ---------- quotes ----------
  // An agent posts a quote with x-agent-key, or its lister posts one with a session.
  async function quoteAuth(req: FastifyRequest, reply: FastifyReply) {
    if (req.headers['x-agent-key']) return requireAgent(req, reply);
    return requireUser(req, reply);
  }

  app.post('/requests/:id/quotes', { preHandler: quoteAuth }, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const body = z
      .object({ agentId: z.string().uuid().optional(), priceTinybar: tinybarStr, etaHours: z.number().int().positive().optional() })
      .parse(req.body);

    const [request] = await db.select().from(schema.requests).where(eq(schema.requests.id, id)).limit(1);
    if (!request) return reply.code(404).send({ error: 'Request not found' });
    if (request.status !== 'open') return reply.code(409).send({ error: 'Request is not open' });

    let agent = req.agent;
    if (!agent) {
      if (!body.agentId) return reply.code(400).send({ error: 'agentId required' });
      [agent] = await db.select().from(schema.agents).where(eq(schema.agents.id, body.agentId)).limit(1);
      if (!agent || agent.ownerUserId !== req.user!.id) return reply.code(403).send({ error: 'Not your agent' });
    }
    if (agent.status !== 'listed') return reply.code(403).send({ error: 'Agent is not listed (pass the benchmark first)' });

    const [quote] = await db
      .insert(schema.quotes)
      .values({ requestId: id, agentId: agent.id, priceTinybar: body.priceTinybar, etaHours: body.etaHours })
      .returning();
    return reply.code(201).send(quote);
  });

  app.post('/quotes/:id/accept', { preHandler: requireUser }, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const [quote] = await db.select().from(schema.quotes).where(eq(schema.quotes.id, id)).limit(1);
    if (!quote) return reply.code(404).send({ error: 'Quote not found' });
    const [request] = await db.select().from(schema.requests).where(eq(schema.requests.id, quote.requestId)).limit(1);
    if (request.clientUserId !== req.user!.id) return reply.code(403).send({ error: 'Not your request' });
    if (request.status !== 'open' || quote.status !== 'open') return reply.code(409).send({ error: 'Already decided' });

    const agreement = await db.transaction(async (tx) => {
      await tx.update(schema.quotes).set({ status: 'accepted' }).where(eq(schema.quotes.id, quote.id));
      await tx
        .update(schema.quotes)
        .set({ status: 'rejected' })
        .where(and(eq(schema.quotes.requestId, request.id), eq(schema.quotes.status, 'open')));
      await tx.update(schema.requests).set({ status: 'agreed' }).where(eq(schema.requests.id, request.id));
      const [a] = await tx
        .insert(schema.agreements)
        .values({
          requestId: request.id,
          quoteId: quote.id,
          clientUserId: request.clientUserId,
          agentId: quote.agentId,
          priceTinybar: quote.priceTinybar,
          deadlineAt: request.deadlineAt,
        })
        .returning();
      return a;
    });
    // The Solidity agent designs the terms and deploys this task's single contract. If it (or the chain) is unavailable
    // the agreement still exists; POST /agreements/:id/escrow retries.
    try {
      const escrowAddress = await ensureTask(agreement.id);
      const [fresh] = await db.select().from(schema.agreements).where(eq(schema.agreements.id, agreement.id)).limit(1);
      return reply.code(201).send({ ...fresh, escrowAddress });
    } catch (e) {
      return reply.code(201).send({ ...agreement, escrowError: (e as Error).message });
    }
  });

  // Preview the contract terms the Solidity agent would design for this quote. No chain access, nothing saved.
  app.post('/quotes/:id/terms', { preHandler: requireUser }, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    let inputs;
    try { inputs = await loadDesignInputs(id); } catch { return reply.code(404).send({ error: 'Quote not found' }); }
    if (inputs.request.clientUserId !== req.user!.id) return reply.code(403).send({ error: 'Not your request' });
    try {
      const d = await requestDesign(inputs.designInput);
      return { spec: d.spec, specHash: d.specHash, trust: d.trust, source: d.source, agent: { id: inputs.agent.id, name: inputs.agent.name } };
    } catch (e) {
      return reply.code(502).send({ error: (e as Error).message });
    }
  });

  // ---------- agreements ----------
  app.get('/agreements/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const [agreement] = await db.select().from(schema.agreements).where(eq(schema.agreements.id, id)).limit(1);
    if (!agreement) return reply.code(404).send({ error: 'Agreement not found' });
    const [request] = await db.select().from(schema.requests).where(eq(schema.requests.id, agreement.requestId)).limit(1);
    const [agent] = await db
      .select({ id: schema.agents.id, name: schema.agents.name, payoutAddress: schema.agents.payoutAddress })
      .from(schema.agents)
      .where(eq(schema.agents.id, agreement.agentId))
      .limit(1);
    const [submission] = await db.select().from(schema.submissions).where(eq(schema.submissions.agreementId, id)).limit(1);
    const [verdict] = await db.select().from(schema.verdicts).where(eq(schema.verdicts.agreementId, id)).limit(1);
    const payments = await db.select().from(schema.payments).where(eq(schema.payments.agreementId, id));
    const [specRow] = await db.select().from(schema.contractSpecs).where(and(eq(schema.contractSpecs.agreementId, id), eq(schema.contractSpecs.kind, 'root'))).limit(1);
    const subLegs = await db.select().from(schema.subLegs).where(eq(schema.subLegs.agreementId, id));
    return {
      agreement, request, agent, submission: submission ?? null, verdict: verdict ?? null, payments,
      terms: specRow ? { spec: specRow.spec, specHash: specRow.specHash, source: specRow.source } : null,
      subLegs: subLegs.map((l) => ({ ...l, payUrl: payoutUrl(id, l.legId) })),
    };
  });

  // How the client funds the task: over x402 (agents, key-based clients) or by calling fund() from a wallet.
  app.get('/agreements/:id/funding', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const [a] = await db.select().from(schema.agreements).where(eq(schema.agreements.id, id)).limit(1);
    if (!a) return reply.code(404).send({ error: 'Agreement not found' });
    if (!a.escrowAddress) return reply.code(409).send({ error: 'Task contract not deployed yet; retry POST /agreements/:id/escrow' });
    return {
      status: a.status,
      priceTinybar: String(a.priceTinybar),
      taskContract: a.escrowAddress,
      taskAccountId: a.taskAccountId,
      x402: { url: fundUrl(id), network: 'hedera:testnet', asset: '0.0.0', amountTinybar: String(a.priceTinybar), payTo: a.taskAccountId },
      wallet: { method: 'fund()', to: a.escrowAddress, valueTinybar: String(a.priceTinybar), note: 'JSON-RPC value is tinybar x 10^10 (weibar)' },
    };
  });

  // Where agent A pays each sub-agent (over x402) after the task is released.
  app.get('/agreements/:id/payouts', async (req) => {
    const { id } = idParam.parse(req.params);
    const legs = await db.select().from(schema.subLegs).where(eq(schema.subLegs.agreementId, id));
    return legs.map((l) => ({ legId: l.legId, status: l.status, priceTinybar: String(l.priceTinybar), payeeAccountId: l.payeeAccountId, payUrl: payoutUrl(id, l.legId), payoutTx: l.payoutTx }));
  });

  app.get('/agreements', { preHandler: requireUser }, async (req) => {
    const mine = await db
      .select()
      .from(schema.agreements)
      .where(eq(schema.agreements.clientUserId, req.user!.id))
      .orderBy(desc(schema.agreements.createdAt));
    return mine;
  });

  // Retry escrow creation if the chain was unavailable at accept time.
  app.post('/agreements/:id/escrow', { preHandler: requireUser }, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const [a] = await db.select().from(schema.agreements).where(eq(schema.agreements.id, id)).limit(1);
    if (!a) return reply.code(404).send({ error: 'Agreement not found' });
    if (a.clientUserId !== req.user!.id) return reply.code(403).send({ error: 'Not your agreement' });
    try {
      return { escrowAddress: await ensureTask(id) };
    } catch (e) {
      return reply.code(502).send({ error: `Chain error: ${(e as Error).message}` });
    }
  });

  // Tell the agent to start work again (it was down when the task was funded).
  app.post('/agreements/:id/dispatch', { preHandler: requireUser }, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const [a] = await db.select().from(schema.agreements).where(eq(schema.agreements.id, id)).limit(1);
    if (!a) return reply.code(404).send({ error: 'Agreement not found' });
    if (a.clientUserId !== req.user!.id) return reply.code(403).send({ error: 'Not your agreement' });
    if (a.status !== 'funded') return reply.code(409).send({ error: `Agreement is ${a.status}; work starts once it is funded` });
    return { status: await dispatchTask(id) };
  });
}
