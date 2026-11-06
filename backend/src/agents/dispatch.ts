// The platform's side of the agent protocol:
//   asks listed agents for a quote when a request is created   -> POST {agent}/quote
//   tells the agent on a funded task to start work             -> POST {agent}/tasks
// Agents that cannot receive calls (behind NAT) pull the same data from GET /agent/requests and GET /agent/tasks.
import { and, desc, eq, isNotNull, ne } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { env } from '../env.js';

const MAX_AGENTS_ASKED = 10;
const post = (url: string, body: unknown) =>
  fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) });

// ---------------- quotes ----------------
/** What an agent answers to /quote: a price, or a refusal. */
export const quoteReplySchema = z.object({
  decline: z.boolean().optional(),
  priceTinybar: z.string().regex(/^\d+$/).optional(),
  etaHours: z.number().int().positive().optional(),
});

export function quotePayload(request: typeof schema.requests.$inferSelect) {
  return {
    requestId: request.id,
    title: request.title,
    requirements: request.requirements,
    budgetTinybar: String(request.budgetTinybar),
    checksRequested: request.checksRequested,
    deadlineAt: request.deadlineAt,
    quoteUrl: `${env.API_PUBLIC_URL}/requests/${request.id}/quotes`,
  };
}

/** Ask every listed agent that has an endpoint (except the requester's own) for a quote. Returns what happened. */
export async function requestQuotes(requestId: string) {
  const [request] = await db.select().from(schema.requests).where(eq(schema.requests.id, requestId)).limit(1);
  if (!request || request.status !== 'open') return { asked: 0, quoted: 0, declined: 0, failed: 0 };

  const agents = await db.select().from(schema.agents)
    .where(and(eq(schema.agents.status, 'listed'), isNotNull(schema.agents.endpointUrl), ne(schema.agents.ownerUserId, request.clientUserId)))
    .orderBy(desc(schema.agents.createdAt)).limit(MAX_AGENTS_ASKED);

  const budget = BigInt(request.budgetTinybar);
  const result = { asked: agents.length, quoted: 0, declined: 0, failed: 0 };
  await Promise.allSettled(agents.map(async (agent) => {
    try {
      const already = await db.select({ id: schema.quotes.id }).from(schema.quotes)
        .where(and(eq(schema.quotes.requestId, requestId), eq(schema.quotes.agentId, agent.id))).limit(1);
      if (already.length) return;
      const res = await post(`${agent.endpointUrl!.replace(/\/$/, '')}/quote`, quotePayload(request));
      if (!res.ok) { result.failed++; return; }
      const reply = quoteReplySchema.parse(await res.json());
      const price = reply.priceTinybar ? BigInt(reply.priceTinybar) : 0n;
      if (reply.decline || price <= 0n) { result.declined++; return; }
      if (price > budget) { result.declined++; return; } // over the client's budget
      await db.insert(schema.quotes).values({ requestId, agentId: agent.id, priceTinybar: price.toString(), etaHours: reply.etaHours });
      result.quoted++;
    } catch { result.failed++; }
  }));
  return result;
}

// ---------------- starting work ----------------
/** Everything an agent needs to start work on a funded task. Also served by GET /agent/tasks. */
export async function buildTaskPayload(agreementId: string) {
  const [agreement] = await db.select().from(schema.agreements).where(eq(schema.agreements.id, agreementId)).limit(1);
  if (!agreement) return null;
  const [request] = await db.select().from(schema.requests).where(eq(schema.requests.id, agreement.requestId)).limit(1);
  const [specRow] = await db.select().from(schema.contractSpecs)
    .where(and(eq(schema.contractSpecs.agreementId, agreementId), eq(schema.contractSpecs.kind, 'root'))).limit(1);
  const spec = specRow?.spec as { deadlineHours?: number; maxSubBps?: number; maxSubLegs?: number; passThresholdPct?: number; checks?: string[] } | undefined;
  return {
    agreementId,
    title: request.title,
    requirements: request.requirements,
    priceTinybar: String(agreement.priceTinybar),
    deadlineAt: agreement.deadlineAt,
    taskContract: agreement.escrowAddress,
    terms: spec ? { deadlineHours: spec.deadlineHours, maxSubBps: spec.maxSubBps, maxSubLegs: spec.maxSubLegs, passThresholdPct: spec.passThresholdPct, checks: spec.checks } : null,
    submitUrl: `${env.API_PUBLIC_URL}/agreements/${agreementId}/submit`,
    hireUrl: `${env.API_PUBLIC_URL}/a2a/quote`,
  };
}

/** Tell the agent on a funded task to start work. Retries a few times; the result is recorded on the agreement. */
export async function dispatchTask(agreementId: string): Promise<'sent' | 'failed' | 'no_endpoint' | 'skipped'> {
  const [agreement] = await db.select().from(schema.agreements).where(eq(schema.agreements.id, agreementId)).limit(1);
  if (!agreement || agreement.status !== 'funded') return 'skipped';
  const [agent] = await db.select().from(schema.agents).where(eq(schema.agents.id, agreement.agentId)).limit(1);
  const record = (status: string, error: string | null) =>
    db.update(schema.agreements).set({ taskDispatchStatus: status, taskDispatchError: error, taskDispatchedAt: status === 'sent' ? new Date() : null }).where(eq(schema.agreements.id, agreementId));

  if (!agent?.endpointUrl) { await record('no_endpoint', 'Agent has no endpoint; it can pull the task from GET /agent/tasks'); return 'no_endpoint'; }
  const payload = await buildTaskPayload(agreementId);
  let lastError = '';
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await post(`${agent.endpointUrl.replace(/\/$/, '')}/tasks`, payload);
      if (res.ok) { await record('sent', null); return 'sent'; }
      lastError = `agent answered ${res.status}`;
    } catch (e) { lastError = (e as Error).message; }
    await new Promise((r) => setTimeout(r, 2000 * attempt));
  }
  await record('failed', lastError);
  return 'failed';
}
