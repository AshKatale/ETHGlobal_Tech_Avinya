import { backend, BackendError } from './lib/backend.js';
import { config } from './lib/config.js';
import { log } from './lib/log.js';

type Agent = { id: string; name: string; capabilities: string[]; priceTinybar: string };
export type HireResult = { status: 'done'; review: unknown } | { status: 'blocked'; reason: string } | { status: 'error'; reason: string };

async function findAuditorId(): Promise<string> {
  if (config.auditorAgentId) return config.auditorAgentId;
  // GET /agents is public and lists status=listed by default (backend/src/routes/agents.ts).
  const agents = await backend<Agent[]>('GET', '/agents?capability=static-audit');
  if (!agents.length) throw new Error('No listed agent with capability static-audit');
  return agents[0].id;
}

/** Hire the Static Auditor once: /a2a/quote then /a2a/call. A 403 from the quote is the backend blocking the spend. */
export async function hireAuditor(agreementId: string, code: string, context?: string): Promise<HireResult> {
  let calleeAgentId: string;
  try { calleeAgentId = await findAuditorId(); } catch (e) { return { status: 'error', reason: (e as Error).message }; }

  let callId: string;
  try {
    const q = await backend<{ allowed: boolean; callId: string; priceTinybar: string }>('POST', '/a2a/quote', { agreementId, calleeAgentId });
    callId = q.callId;
    log('info', 'a2a quote allowed', { callId, priceTinybar: q.priceTinybar });
  } catch (e) {
    if (e instanceof BackendError && e.status === 403) {
      const reason = String((e.body as { reason?: string }).reason ?? 'blocked');
      log('warn', 'a2a quote blocked by backend', { reason });
      return { status: 'blocked', reason };
    }
    return { status: 'error', reason: (e as Error).message };
  }

  try {
    const r = await backend<{ status: string; output: { review?: unknown } }>('POST', '/a2a/call', { callId, input: { code, context } });
    log('info', 'a2a call done', { callId });
    return { status: 'done', review: r.output?.review ?? r.output };
  } catch (e) {
    if (e instanceof BackendError && e.status === 403) return { status: 'blocked', reason: String((e.body as { error?: string }).error ?? 'blocked') };
    return { status: 'error', reason: (e as Error).message };
  }
}
