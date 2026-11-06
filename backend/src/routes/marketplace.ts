import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { requireAgent, requireUser } from '../lib/auth.js';
import { assertTransition } from '../lib/stateMachine.js';

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
    return reply.code(201).send(row);
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
    // Phase 3: create the JobEscrow here and store escrow_address.
    return reply.code(201).send(agreement);
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
    return { agreement, request, agent, submission: submission ?? null, verdict: verdict ?? null, payments };
  });

  app.get('/agreements', { preHandler: requireUser }, async (req) => {
    const mine = await db
      .select()
      .from(schema.agreements)
      .where(eq(schema.agreements.clientUserId, req.user!.id))
      .orderBy(desc(schema.agreements.createdAt));
    return mine;
  });

  // DEV ONLY: stands in for the on-chain Funded event until the indexer exists (step 3.9). Remove then.
  if (process.env.NODE_ENV !== 'production') {
    app.post('/dev/agreements/:id/mark-funded', async (req, reply) => {
      const { id } = idParam.parse(req.params);
      const [a] = await db.select().from(schema.agreements).where(eq(schema.agreements.id, id)).limit(1);
      if (!a) return reply.code(404).send({ error: 'Agreement not found' });
      assertTransition(a.status as never, 'funded');
      await db.update(schema.agreements).set({ status: 'funded' }).where(eq(schema.agreements.id, id));
      await db.insert(schema.payments).values({ agreementId: id, kind: 'fund', amountTinybar: a.priceTinybar, status: 'confirmed' });
      return { ok: true, status: 'funded' };
    });
  }
}
