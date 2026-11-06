// Backend -> agent callbacks (docs/contracts/agent-protocol.md): POST /quote and POST /tasks.
// Every call goes through the SSRF guard. Failures are stored or ignored; they never throw into the indexer or a request handler.
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { env } from '../env.js';
import { safeFetch, SsrfError, type SafeResponse } from './ssrf.js';

export type Fetcher = (url: string, init: { method: string; headers: Record<string, string>; body: string }, opts: { timeoutMs: number; maxBytes: number }) => Promise<SafeResponse>;

export const quoteAnswer = z.object({
  priceTinybar: z.string().regex(/^\d+$/, 'priceTinybar must be a digit string'),
  etaHours: z.number().int().min(1).max(100_000).optional(),
});

const headers = (): Record<string, string> => ({
  'content-type': 'application/json',
  ...(env.AGENT_CALLBACK_SECRET ? { 'x-backend-key': env.AGENT_CALLBACK_SECRET } : {}),
});
const join = (base: string, path: string) => `${base.replace(/\/+$/, '')}${path}`;

/** Ask one agent for a price. Returns null on any failure or invalid answer. */
export async function askForQuote(endpointUrl: string, requirements: string, fetcher: Fetcher = safeFetch): Promise<z.infer<typeof quoteAnswer> | null> {
  try {
    const res = await fetcher(join(endpointUrl, '/quote'), { method: 'POST', headers: headers(), body: JSON.stringify({ requirements }) }, { timeoutMs: 15_000, maxBytes: 64_000 });
    if (!res.ok) return null;
    const parsed = quoteAnswer.safeParse(JSON.parse(res.text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Background: solicit a quote from every listed agent that has an endpoint. Ignores agents that fail. */
export async function solicitQuotes(requestId: string, fetcher: Fetcher = safeFetch): Promise<number> {
  const [request] = await db.select().from(schema.requests).where(eq(schema.requests.id, requestId)).limit(1);
  if (!request) return 0;
  const agents = await db.select().from(schema.agents).where(eq(schema.agents.status, 'listed'));
  const targets = agents.filter((a) => a.endpointUrl);
  const results = await Promise.all(
    targets.map(async (agent) => {
      const answer = await askForQuote(agent.endpointUrl!, request.requirements, fetcher);
      if (!answer) return 0;
      try {
        const [current] = await db.select({ status: schema.requests.status }).from(schema.requests).where(eq(schema.requests.id, requestId)).limit(1);
        if (current?.status !== 'open') return 0;
        const existing = await db.select({ id: schema.quotes.id }).from(schema.quotes)
          .where(and(eq(schema.quotes.requestId, requestId), eq(schema.quotes.agentId, agent.id))).limit(1);
        if (existing.length) return 0;
        await db.insert(schema.quotes).values({ requestId, agentId: agent.id, priceTinybar: answer.priceTinybar, etaHours: answer.etaHours });
        return 1;
      } catch {
        return 0;
      }
    }),
  );
  return results.reduce<number>((a, b) => a + b, 0);
}

export const DISPATCH_BACKOFF_MS = [5_000, 15_000, 45_000];
const inflight = new Set<string>();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type DispatchResult = { ok: true } | { ok: false; error: string } | { skipped: string };

/**
 * Call the agent's POST /tasks once for a funded agreement. Marks dispatched_at on a 2xx.
 * Retries on network error, timeout or 5xx; a 4xx ends retries. A failure is stored in dispatch_error and can be retried.
 */
export async function dispatchAgreement(agreementId: string, opts: { fetcher?: Fetcher; backoffMs?: number[] } = {}): Promise<DispatchResult> {
  const fetcher = opts.fetcher ?? safeFetch;
  const backoff = opts.backoffMs ?? DISPATCH_BACKOFF_MS;
  if (inflight.has(agreementId)) return { skipped: 'already in flight' };
  inflight.add(agreementId);
  try {
    const [agreement] = await db.select().from(schema.agreements).where(eq(schema.agreements.id, agreementId)).limit(1);
    if (!agreement) return { skipped: 'agreement not found' };
    if (agreement.status !== 'funded') return { skipped: `status is ${agreement.status}` };
    if (agreement.dispatchedAt) return { skipped: 'already dispatched' };
    const [agent] = await db.select().from(schema.agents).where(eq(schema.agents.id, agreement.agentId)).limit(1);
    const [request] = await db.select().from(schema.requests).where(eq(schema.requests.id, agreement.requestId)).limit(1);

    const fail = async (error: string): Promise<DispatchResult> => {
      await db.update(schema.agreements).set({ dispatchError: error.slice(0, 500) }).where(eq(schema.agreements.id, agreementId));
      return { ok: false, error };
    };
    if (!agent?.endpointUrl) return await fail('Agent has no endpoint URL');

    let lastError = 'unknown error';
    for (let attempt = 0; attempt <= backoff.length; attempt++) {
      if (attempt > 0) await sleep(backoff[attempt - 1]);
      try {
        const res = await fetcher(join(agent.endpointUrl, '/tasks'),
          { method: 'POST', headers: headers(), body: JSON.stringify({ agreementId, requirements: request.requirements }) },
          { timeoutMs: 5_000, maxBytes: 64_000 });
        if (res.ok) {
          await db.update(schema.agreements).set({ dispatchedAt: new Date(), dispatchError: null })
            .where(and(eq(schema.agreements.id, agreementId), isNull(schema.agreements.dispatchedAt)));
          return { ok: true };
        }
        lastError = `agent responded ${res.status}`; // body deliberately not stored: it is lister-controlled text
        if (res.status < 500) break; // 4xx is final
      } catch (e) {
        lastError = (e as Error).message;
        if (e instanceof SsrfError) break; // guard refusal is final
      }
    }
    return await fail(lastError);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  } finally {
    inflight.delete(agreementId);
  }
}
