import Fastify from 'fastify';
import { z } from 'zod';
import { config } from './lib/config.js';
import { log } from './lib/log.js';
import { requireBackendKey, submitWithRetry } from './lib/guard.js';
import { reviewCode, type Review } from './audit.js';

process.env.AGENT_NAME = 'static-auditor';
const app = Fastify({ logger: false });

const asText = (r: Review) =>
  `Static audit: ${r.summary}\n` +
  (r.findings.length ? r.findings.map((f, i) => `${i + 1}. [${f.severity.toUpperCase()}] ${f.title}: ${f.detail}${f.fix ? ` Fix: ${f.fix}` : ''}`).join('\n') : 'No findings.');

app.get('/health', async () => ({ ok: true, capability: 'static-audit' }));

// Protocol (inferred from docs/build_steps.md Phase 2; confirm against docs/contracts/agent-protocol.md).
app.post('/quote', { preHandler: requireBackendKey }, async () => ({ priceTinybar: config.priceTinybar, etaHours: config.etaHours }));

// Agent-to-agent call. Body {agreementId, callId, input:{code, context?}}. Returns the structured review.
const cache = new Map<string, Promise<{ review: Review }>>(); // dedupe on callId
const seen = new Set<string>();

app.post('/a2a', { preHandler: requireBackendKey }, async (req, reply) => {
  const body = z
    .object({ agreementId: z.string(), callId: z.string(), input: z.object({ code: z.string().min(1), context: z.string().optional() }) })
    .safeParse(req.body);
  if (!body.success) return reply.code(400).send({ error: 'Expected {agreementId, callId, input:{code}}' });
  log('info', 'a2a call', { agreementId: body.data.agreementId, callId: body.data.callId, bytes: body.data.input.code.length });
  try {
    let p = cache.get(body.data.callId);
    if (!p) { p = reviewCode(body.data.input.code, body.data.input.context).then((review) => ({ review })); cache.set(body.data.callId, p); p.catch(() => cache.delete(body.data.callId)); }
    return await p;
  } catch (e) {
    log('error', 'a2a failed', { error: (e as Error).message });
    return reply.code(502).send({ error: (e as Error).message });
  }
});

// Direct hire: requirements holds the code to review. Respond 202, work in the background, submit.
app.post('/tasks', { preHandler: requireBackendKey }, async (req, reply) => {
  const body = z.object({ agreementId: z.string(), requirements: z.union([z.string(), z.record(z.string(), z.unknown())]) }).safeParse(req.body);
  if (!body.success) return reply.code(400).send({ error: 'Expected {agreementId, requirements}' });
  const { agreementId, requirements } = body.data;
  if (seen.has(agreementId)) return reply.code(202).send({ accepted: true });
  seen.add(agreementId);
  void (async () => {
    try {
      const code = typeof requirements === 'string' ? requirements : String((requirements as Record<string, unknown>).code ?? JSON.stringify(requirements));
      const review = await reviewCode(code);
      await submitWithRetry(agreementId, asText(review));
      log('info', 'submitted', { agreementId, findings: review.findings.length });
    } catch (e) {
      // Never submit a fake result; the lister sees the error in the log.
      seen.delete(agreementId);
      log('error', 'task failed', { agreementId, error: (e as Error).message });
    }
  })();
  return reply.code(202).send({ accepted: true });
});

app.listen({ port: config.port, host: '0.0.0.0' }).then(() => log('info', 'listening', { port: config.port }));
