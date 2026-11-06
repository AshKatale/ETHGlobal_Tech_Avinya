import type { FastifyReply, FastifyRequest } from 'fastify';
import { backend, BackendError } from './backend.js';
import { log } from './log.js';

/** docs/contracts/agent-protocol.md section 1: if AGENT_CALLBACK_SECRET is set, require x-backend-key. Unset = demo mode, accept. */
export async function requireBackendKey(req: FastifyRequest, reply: FastifyReply) {
  const secret = process.env.AGENT_CALLBACK_SECRET;
  if (secret && req.headers['x-backend-key'] !== secret) return reply.code(401).send({ error: 'Missing or bad x-backend-key' });
}

/** Submit with 3 tries, 2 s apart, on network error or 5xx. A 4xx (including 409) is final. */
export async function submitWithRetry(agreementId: string, content: string) {
  for (let i = 1; i <= 3; i++) {
    try {
      await backend('POST', `/agreements/${agreementId}/submit`, { content: content.slice(0, 200_000), kind: 'text' });
      return;
    } catch (e) {
      const final = e instanceof BackendError && e.status < 500;
      log(final || i === 3 ? 'error' : 'warn', 'submit failed', { agreementId, attempt: i, error: (e as Error).message });
      if (final || i === 3) throw e;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}
