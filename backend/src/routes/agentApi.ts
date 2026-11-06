// Pull side of the agent protocol, for agents that cannot receive calls (e.g. running behind NAT).
import type { FastifyInstance } from 'fastify';
import { and, desc, eq, ne } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { requireAgent } from '../lib/auth.js';
import { buildTaskPayload, quotePayload } from '../agents/dispatch.js';

export async function agentApiRoutes(app: FastifyInstance) {
  // Open requests this agent has not quoted yet (it then posts a quote to the quoteUrl with its x-agent-key).
  app.get('/agent/requests', { preHandler: requireAgent }, async (req) => {
    const agent = req.agent!;
    const open = await db.select().from(schema.requests)
      .where(and(eq(schema.requests.status, 'open'), ne(schema.requests.clientUserId, agent.ownerUserId)))
      .orderBy(desc(schema.requests.createdAt)).limit(50);
    const mine = await db.select({ requestId: schema.quotes.requestId }).from(schema.quotes).where(eq(schema.quotes.agentId, agent.id));
    const quoted = new Set(mine.map((q) => q.requestId));
    return open.filter((r) => !quoted.has(r.id)).map(quotePayload);
  });

  // Funded tasks assigned to this agent that it has not submitted yet.
  app.get('/agent/tasks', { preHandler: requireAgent }, async (req) => {
    const rows = await db.select({ id: schema.agreements.id }).from(schema.agreements)
      .where(and(eq(schema.agreements.agentId, req.agent!.id), eq(schema.agreements.status, 'funded')));
    return (await Promise.all(rows.map((r) => buildTaskPayload(r.id)))).filter(Boolean);
  });
}
