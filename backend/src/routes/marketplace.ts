import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { requireAgent, requireUser } from '../lib/auth.js';
import { ensureTask, fundUrl, loadDesignInputs, payoutUrl } from '../chain/ops.js';
import { requestDesign } from '../designer/client.js';
import { dispatchTask, requestQuotes } from '../agents/dispatch.js';
import { summarizeAgents } from '../lib/agentSummary.js';
import { readDesignProof } from '../chain/client.js';
import { compareTerms, sameHash } from '../lib/designProof.js';
import type { Address } from 'viem';

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
    const rows = await db.select().from(schema.quotes).where(eq(schema.quotes.requestId, id));
    // Each quote carries who is quoting: name, benchmark score and track record.
    const agents = rows.length ? await db.select().from(schema.agents).where(inArray(schema.agents.id, rows.map((q) => q.agentId))) : [];
    const sums = await summarizeAgents(agents);
    const quotes = rows.map((q) => {
      const a = agents.find((x) => x.id === q.agentId);
      const sm = sums.get(q.agentId);
      return { ...q, agent: a ? { id: a.id, name: a.name, capabilities: a.capabilities, score: sm?.score ?? null, jobsCompleted: sm?.jobsCompleted ?? 0, jobsFailed: sm?.jobsFailed ?? 0 } : undefined };
    });
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

  // How the contract was designed (inputs, analysis, trust, terms) and proof that the deployed contract holds those terms,
  // for the root contract and for every sub-agent leg. Read-only. The on-chain read is cached briefly: it is several RPC calls.
  const designCache = new Map<string, { at: number; value: unknown }>();
  app.get('/agreements/:id/design', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const hit = designCache.get(id);
    if (hit && Date.now() - hit.at < 20_000) return hit.value;

    const [agreement] = await db.select().from(schema.agreements).where(eq(schema.agreements.id, id)).limit(1);
    if (!agreement) return reply.code(404).send({ error: 'Agreement not found' });
    const [request] = await db.select().from(schema.requests).where(eq(schema.requests.id, agreement.requestId)).limit(1);
    const [agent] = await db.select().from(schema.agents).where(eq(schema.agents.id, agreement.agentId)).limit(1);
    const specs = await db.select().from(schema.contractSpecs).where(eq(schema.contractSpecs.agreementId, id));
    const root = specs.find((x) => x.kind === 'root');
    const subLegs = await db.select().from(schema.subLegs).where(eq(schema.subLegs.agreementId, id));
    const callees = subLegs.length ? await db.select().from(schema.agents).where(inArray(schema.agents.id, subLegs.map((l) => l.calleeAgentId))) : [];

    // Ask the contract itself. If the relay is down, say so: never show a tick we did not check.
    let chain: Awaited<ReturnType<typeof readDesignProof>> | null = null;
    let chainError: string | null = null;
    if (agreement.escrowAddress) {
      try { chain = await readDesignProof(agreement.escrowAddress as Address, subLegs.length); }
      catch (e) { chainError = (e as Error).message; }
    }

    const rootSpec = root?.spec as { priceTinybar: string; deadlineHours: number; maxSubBps: number; maxSubLegs: number; payoutGraceSecs: number } | undefined;
    const value = {
      agreementId: id,
      inputs: {
        title: request.title,
        requirements: request.requirements,
        agent: { id: agent.id, name: agent.name, description: agent.description, capabilities: agent.capabilities, priceTinybar: String(agent.priceTinybar) },
      },
      root: root ? { spec: root.spec, specHash: root.specHash, source: root.source, deployTx: root.deployTx } : null,
      contract: agreement.escrowAddress ?? null,
      proof: !agreement.escrowAddress ? { state: 'not_deployed' as const }
        : !chain ? { state: 'unavailable' as const, error: chainError }
        : !rootSpec ? { state: 'no_design' as const }
        : { state: 'checked' as const, rows: compareTerms(rootSpec, { price: chain.price, deadlineUnix: chain.deadlineUnix, maxSubBps: chain.maxSubBps, maxSubLegs: chain.maxSubLegs, payoutGrace: chain.payoutGrace }, new Date(agreement.createdAt).getTime()) },
      subs: subLegs.map((l) => {
        const row = specs.find((x) => x.kind === 'sub' && sameHash(x.specHash, l.termsHash));
        const callee = callees.find((c) => c.id === l.calleeAgentId);
        const onchain = chain?.legs.find((c) => c.legId === l.legId);
        const designed = row && (row.spec as { kind?: string }).kind !== 'sub-default';
        return {
          legId: l.legId, status: l.status, priceTinybar: String(l.priceTinybar), termsHash: l.termsHash, addLegTx: l.addLegTx,
          callee: callee ? { id: callee.id, name: callee.name, capabilities: callee.capabilities } : null,
          // 'default' = the designer was unavailable when the leg was added, so the leg carries a plain default instead of designed terms.
          design: designed ? { spec: row.spec, source: row.source, specHash: row.specHash } : { spec: null, source: row?.source ?? 'default', specHash: l.termsHash },
          proof: onchain ? { state: 'checked' as const, onchainHash: onchain.termsHash, match: sameHash(onchain.termsHash, l.termsHash), onchainPrice: String(onchain.price), priceMatch: String(onchain.price) === String(l.priceTinybar) }
            : { state: chain ? ('missing' as const) : ('unavailable' as const) },
        };
      }),
    };
    if (chain || !agreement.escrowAddress) designCache.set(id, { at: Date.now(), value });
    return value;
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

  // Jobs where I am the client (default) or jobs on agents I own (?as=agent). Rows carry the title, agent and client.
  app.get('/agreements', { preHandler: requireUser }, async (req) => {
    const { as } = z.object({ as: z.enum(['client', 'agent']).default('client') }).parse(req.query);
    let rows;
    if (as === 'agent') {
      const mine = await db.select({ id: schema.agents.id }).from(schema.agents).where(eq(schema.agents.ownerUserId, req.user!.id));
      rows = mine.length
        ? await db.select().from(schema.agreements).where(inArray(schema.agreements.agentId, mine.map((m) => m.id))).orderBy(desc(schema.agreements.createdAt))
        : [];
    } else {
      rows = await db.select().from(schema.agreements).where(eq(schema.agreements.clientUserId, req.user!.id)).orderBy(desc(schema.agreements.createdAt));
    }
    if (!rows.length) return [];
    const requests = await db.select({ id: schema.requests.id, title: schema.requests.title }).from(schema.requests).where(inArray(schema.requests.id, rows.map((r) => r.requestId)));
    const agents = await db.select({ id: schema.agents.id, name: schema.agents.name }).from(schema.agents).where(inArray(schema.agents.id, rows.map((r) => r.agentId)));
    const clients = await db.select({ id: schema.users.id, address: schema.users.address }).from(schema.users).where(inArray(schema.users.id, rows.map((r) => r.clientUserId)));
    return rows.map((r) => ({
      ...r,
      title: requests.find((x) => x.id === r.requestId)?.title ?? 'Job',
      agentName: agents.find((x) => x.id === r.agentId)?.name ?? 'Agent',
      clientAddress: clients.find((x) => x.id === r.clientUserId)?.address,
    }));
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
