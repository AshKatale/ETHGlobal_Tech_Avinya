import type { FastifyInstance } from 'fastify';
import { desc, eq, inArray } from 'drizzle-orm';
import { isAddress } from 'viem';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { newToken, requireUser, sha256 } from '../lib/auth.js';
import { summarizeAgents } from '../lib/agentSummary.js';

const tinybarStr = z.string().regex(/^\d+$/, 'tinybar must be a whole-number string');

const createAgentBody = z.object({
  name: z.string().min(1).max(100),
  description: z.string().min(1).max(2000),
  capabilities: z.array(z.string().min(1).max(40)).min(1).max(10),
  endpointUrl: z.string().url().optional(),
  payoutAddress: z.string().refine(isAddress, 'Invalid payout address').optional(),
  hederaAccountId: z.string().regex(/^\d+\.\d+\.\d+$/).optional(),
  priceTinybar: tinybarStr,
  repoUrl: z.string().url().optional(),
});

// Never expose the key hash.
const publicAgent = (a: typeof schema.agents.$inferSelect) => {
  const { apiKeyHash: _omit, ...rest } = a;
  return rest;
};

/** Agent rows (without the key hash) plus the public numbers the marketplace shows. */
async function withSummary(rows: (typeof schema.agents.$inferSelect)[]) {
  const sums = await summarizeAgents(rows);
  return rows.map((a) => ({ ...publicAgent(a), ...sums.get(a.id) }));
}

export async function agentRoutes(app: FastifyInstance) {
  app.post('/agents', { preHandler: requireUser }, async (req, reply) => {
    const body = createAgentBody.parse(req.body);
    const apiKey = `afk_${newToken(24)}`;
    const [agent] = await db
      .insert(schema.agents)
      .values({
        ownerUserId: req.user!.id,
        name: body.name,
        description: body.description,
        capabilities: body.capabilities,
        endpointUrl: body.endpointUrl,
        payoutAddress: (body.payoutAddress ?? req.user!.address).toLowerCase(),
        hederaAccountId: body.hederaAccountId,
        priceTinybar: body.priceTinybar,
        repoUrl: body.repoUrl,
        apiKeyHash: sha256(apiKey),
      })
      .returning();
    // The key is shown once. The lister puts it in the agent's .env as x-agent-key.
    return reply.code(201).send({ agent: publicAgent(agent), apiKey });
  });

  app.get('/agents', async (req) => {
    const q = z
      .object({ capability: z.string().optional(), status: z.string().optional(), mine: z.string().optional() })
      .parse(req.query);
    let rows = await db.select().from(schema.agents).orderBy(desc(schema.agents.createdAt));
    // Public list shows listed agents by default.
    const status = q.status ?? 'listed';
    if (status !== 'all') rows = rows.filter((a) => a.status === status);
    if (q.capability) rows = rows.filter((a) => a.capabilities.includes(q.capability!));
    return withSummary(rows);
  });

  app.get('/agents/mine', { preHandler: requireUser }, async (req) => {
    const rows = await db
      .select()
      .from(schema.agents)
      .where(eq(schema.agents.ownerUserId, req.user!.id))
      .orderBy(desc(schema.agents.createdAt));
    return withSummary(rows);
  });

  // Take your own agent off the marketplace (it can be listed again by re-running the benchmark).
  app.post('/agents/:id/unlist', { preHandler: requireUser }, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const [agent] = await db.select().from(schema.agents).where(eq(schema.agents.id, id)).limit(1);
    if (!agent) return reply.code(404).send({ error: 'Agent not found' });
    if (agent.ownerUserId !== req.user!.id) return reply.code(403).send({ error: 'Not your agent' });
    await db.update(schema.agents).set({ status: 'draft' }).where(eq(schema.agents.id, id));
    return { id, status: 'draft' };
  });

  app.get('/agents/:id', async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const [agent] = await db.select().from(schema.agents).where(eq(schema.agents.id, id)).limit(1);
    if (!agent) return reply.code(404).send({ error: 'Agent not found' });
    let benchmark = null;
    if (agent.latestBenchmarkId) {
      [benchmark] = await db
        .select()
        .from(schema.benchmarkRuns)
        .where(eq(schema.benchmarkRuns.id, agent.latestBenchmarkId))
        .limit(1);
    }
    const [withNumbers] = await withSummary([agent]);
    // The agent's most recent jobs (public: titles and outcomes, no client details).
    const jobs = await db
      .select({ id: schema.agreements.id, status: schema.agreements.status, priceTinybar: schema.agreements.priceTinybar, createdAt: schema.agreements.createdAt, title: schema.requests.title })
      .from(schema.agreements)
      .innerJoin(schema.requests, eq(schema.requests.id, schema.agreements.requestId))
      .where(eq(schema.agreements.agentId, id))
      .orderBy(desc(schema.agreements.createdAt))
      .limit(5);
    return { agent: withNumbers, benchmark, recentJobs: jobs };
  });

}
