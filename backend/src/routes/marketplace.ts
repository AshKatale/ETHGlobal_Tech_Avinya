import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { optionalAuth, requireAgent, requireUser } from '../lib/auth.js';
import { canViewPrivate, publicSubmission, publicVerdict } from '../lib/access.js';
import { ensureEscrow } from '../chain/ops.js';
import { latestSubmission } from '../lib/submissions.js';
import { solicitQuotes } from '../lib/agentClient.js';
import { deadlineError, defaultDeadline } from '../lib/deadline.js';
import { agreementTimestamps, latestScores } from '../lib/enrich.js';
import { env } from '../env.js';

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
    // S-15: no deadline under 15 minutes away; default is 7 days.
    const deadline = body.deadlineAt ? new Date(body.deadlineAt) : defaultDeadline();
    const dErr = body.deadlineAt ? deadlineError(deadline) : null;
    if (dErr) return reply.code(400).send({ error: dErr });
    const [row] = await db
      .insert(schema.requests)
      .values({
        clientUserId: req.user!.id,
        title: body.title,
        requirements: body.requirements,
        checksRequested: body.checksRequested,
        budgetTinybar: body.budgetTinybar,
        deadlineAt: deadline,
      })
      .returning();
    // Background: ask every listed agent with an endpoint for a quote. Failures are ignored.
    void solicitQuotes(row.id).catch((e) => app.log.warn({ err: (e as Error).message }, 'quote solicitation failed'));
    return reply.code(201).send(row);
  });

  app.get('/requests', { preHandler: optionalAuth }, async (req) => {
    const q = z.object({ status: z.string().optional(), mine: z.string().optional() }).parse(req.query);
    let rows = await db.select().from(schema.requests).orderBy(desc(schema.requests.createdAt));
    // ?mine=true with a valid session lists only the caller's own requests (anonymous callers get the public list).
    if (q.mine === 'true' && req.user) rows = rows.filter((r) => r.clientUserId === req.user!.id);
    return q.status ? rows.filter((r) => r.status === q.status) : rows;
  });

  app.get('/requests/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const [request] = await db.select().from(schema.requests).where(eq(schema.requests.id, id)).limit(1);
    if (!request) return reply.code(404).send({ error: 'Request not found' });
    const rawQuotes = await db.select().from(schema.quotes).where(eq(schema.quotes.requestId, id));
    const agents = rawQuotes.length
      ? await db.select().from(schema.agents).where(inArray(schema.agents.id, rawQuotes.map((qt) => qt.agentId)))
      : [];
    const scores = await latestScores(agents);
    const nameOf = new Map(agents.map((a) => [a.id, a.name]));
    const quotes = rawQuotes.map((qt) => ({ ...qt, agentName: nameOf.get(qt.agentId) ?? null, latestScore: scores.get(qt.agentId) ?? null }));
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
    if (request.deadlineAt) {
      const dErr = deadlineError(request.deadlineAt);
      if (dErr) return reply.code(409).send({ error: `Request deadline is too close to accept: ${dErr}` });
    }

    // S-14: the first statement is an atomic claim (open -> agreed). Concurrent accepts: exactly one gets a row back,
    // the others abort and roll back, so one request can never produce two agreements.
    const agreement = await db.transaction(async (tx) => {
      const claimed = await tx
        .update(schema.requests)
        .set({ status: 'agreed' })
        .where(and(eq(schema.requests.id, request.id), eq(schema.requests.status, 'open')))
        .returning({ id: schema.requests.id });
      if (claimed.length === 0) return null;
      const accepted = await tx
        .update(schema.quotes)
        .set({ status: 'accepted' })
        .where(and(eq(schema.quotes.id, quote.id), eq(schema.quotes.status, 'open')))
        .returning({ id: schema.quotes.id });
      if (accepted.length === 0) { tx.rollback(); }
      await tx
        .update(schema.quotes)
        .set({ status: 'rejected' })
        .where(and(eq(schema.quotes.requestId, request.id), eq(schema.quotes.status, 'open')));
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
    }).catch((e) => { if ((e as Error).name === 'TransactionRollbackError') return null; throw e; });
    if (!agreement) return reply.code(409).send({ error: 'Already decided' });
    // Create the per-agreement JobEscrow on Hedera. If the chain is unavailable the agreement still exists;
    // the client can retry with POST /agreements/:id/escrow.
    try {
      const escrowAddress = await ensureEscrow(agreement.id);
      return reply.code(201).send({ ...agreement, escrowAddress });
    } catch (e) {
      return reply.code(201).send({ ...agreement, escrowError: (e as Error).message });
    }
  });

  // ---------- agreements ----------
  app.get('/agreements/:id', { preHandler: optionalAuth }, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const [agreement] = await db.select().from(schema.agreements).where(eq(schema.agreements.id, id)).limit(1);
    if (!agreement) return reply.code(404).send({ error: 'Agreement not found' });
    const [request] = await db.select().from(schema.requests).where(eq(schema.requests.id, agreement.requestId)).limit(1);
    const [agent] = await db
      .select({ id: schema.agents.id, name: schema.agents.name, payoutAddress: schema.agents.payoutAddress })
      .from(schema.agents)
      .where(eq(schema.agents.id, agreement.agentId))
      .limit(1);
    const submission = await latestSubmission(id);
    const [verdict] = await db.select().from(schema.verdicts).where(eq(schema.verdicts.agreementId, id)).limit(1);
    const ts = await agreementTimestamps(agreement);
    const payments = ts.payments;
    // S-09: submission content and raw error strings only for the client, the agent's owner or the agent itself.
    const full = await canViewPrivate(req, agreement);
    return {
      agreement: full ? agreement : { ...agreement, dispatchError: null },
      request,
      agent,
      submission: full ? (submission ?? null) : publicSubmission(submission),
      verdict: full ? (verdict ?? null) : publicVerdict(verdict),
      payments,
      timestamps: { fundedAt: ts.fundedAt, submittedAt: submission?.submittedAt ?? null, settledAt: ts.settledAt },
      a2aMaxPercent: env.A2A_MAX_PERCENT,
      viewerAccess: full ? 'full' : 'public',
    };
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
      return { escrowAddress: await ensureEscrow(id) };
    } catch (e) {
      return reply.code(502).send({ error: `Chain error: ${(e as Error).message}` });
    }
  });
}
