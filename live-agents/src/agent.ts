import Fastify from 'fastify';
import { z } from 'zod';
import { a2aCall, a2aQuote, BackendError, submitWork } from './backend.js';
import { config } from './config.js';
import { ask } from './llm.js';
import { payer, settlementTx } from './pay.js';
import { bySlug, type AgentDef } from './roster.js';
import { loadState } from './state.js';

const text = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v, null, 2));
// Structural checks look at the files delivered, so the deliverable must include the files they look for.
const CHECK_FILES: Record<string, string> = {
  lint_rules: 'a lint/format config file (".solhint.json" for Solidity, "eslint.config.js" for JS/TS, ".prettierrc" otherwise)',
  build_config: 'a build config ("foundry.toml" for Solidity, or a package.json with a "build" script)',
  dependency_check: 'a package.json whose dependency versions are pinned (no "*", "latest" or git/http versions)',
};
export const jobPrompt = (requirements: string, checks: string[]) => {
  const files = checks.filter((c) => CHECK_FILES[c]).map((c) => `- ${c}: include ${CHECK_FILES[c]} as its own "// FILE: path" file`);
  return `Job requirements:\n"""\n${requirements}\n"""${checks.length ? `\nThe result will be checked for: ${checks.join(', ')}.` : ''}${files.length ? `\nTo pass those checks the deliverable must contain these files (put the main code in its own "// FILE: path" file too):\n${files.join('\n')}` : ''}`;
};

/** One agent = one server: GET /health, POST /quote, POST /tasks (202), POST /a2a, POST /payouts-due. */
export async function runAgent(def: AgentDef) {
  const app = Fastify({ logger: { level: 'info' } });
  const me = () => loadState()[def.slug];

  app.addHook('preHandler', async (req, reply) => {
    if (req.url === '/health' || !config.backendSecret) return;
    if (req.headers['x-backend-secret'] !== config.backendSecret) return reply.code(401).send({ error: 'Bad or missing x-backend-secret' });
  });
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof z.ZodError) return reply.code(400).send({ error: 'Validation failed', issues: err.issues });
    return reply.code((err as { statusCode?: number }).statusCode ?? 500).send({ error: (err as Error).message });
  });

  app.get('/health', async () => ({ ok: true, name: def.name, slug: def.slug, registered: !!me() }));

  app.post('/quote', async (req) => {
    const { requirements } = z.object({ requirements: z.string().default('') }).passthrough().parse(req.body ?? {});
    if (!def.matches.test(requirements)) return { decline: true, reason: `${def.name} does not do this kind of work` };
    return { priceTinybar: def.priceTinybar, etaHours: def.etaHours };
  });

  app.post('/tasks', async (req, reply) => {
    const key = me()?.apiKey;
    if (!key) return reply.code(503).send({ error: 'Agent not registered: run the backend seed script' });
    const ctx = z.object({ agreementId: z.string().uuid(), requirements: z.string().min(1), checks: z.array(z.string()).default([]) }).passthrough().parse(req.body);
    void (async () => {
      try {
        let work = await withRetries(() => ask(def.system, jobPrompt(ctx.requirements, ctx.checks)), ctx.agreementId, req.log);
        work = await maybeReview(def, key, ctx.agreementId, ctx.requirements, work, req.log);
        for (let attempt = 1; attempt <= 3; attempt++) {
          try { await submitWork(key, ctx.agreementId, work); req.log.info({ agreementId: ctx.agreementId }, 'work submitted'); return; }
          catch (e) {
            const status = e instanceof BackendError ? e.status : undefined;
            req.log.error({ attempt, status, err: (e as Error).message }, 'submit failed');
            if (status && status < 500) return;
            await new Promise((r) => setTimeout(r, 3000 * attempt));
          }
        }
      } catch (e) {
        // Nothing fake is ever submitted: the job stays funded and the client can see there is no submission.
        req.log.error({ agreementId: ctx.agreementId, err: (e as Error).message }, 'task failed; nothing submitted');
      }
    })();
    return reply.code(202).send({ accepted: true, agreementId: ctx.agreementId });
  });

  // Another agent hired this one. It is paid over x402 by the hiring agent once the whole task is released.
  app.post('/a2a', async (req) => {
    const { input } = z.object({ input: z.unknown() }).passthrough().parse(req.body ?? {});
    const i = (input ?? {}) as Record<string, unknown>;
    return { agent: def.slug, review: await ask(def.system, `Task from another agent:\n"""\n${text(i.code ?? i.text ?? input)}\n"""`) };
  });

  // The backend tells the hiring agent which sub-agents it owes. Pay each over x402 (autonomous, capped per payment).
  app.post('/payouts-due', async (req, reply) => {
    const m = me();
    if (!m) return reply.code(503).send({ error: 'not registered' });
    const { legs } = z.object({ legs: z.array(z.object({ legId: z.number(), payUrl: z.string().url() })) }).passthrough().parse(req.body);
    void (async () => {
      const pay = payer(m.accountId, m.payoutKey, 100_000_000n); // at most 1 HBAR per payment
      for (const leg of legs) {
        try {
          const res = await pay(leg.payUrl);
          if (res.status === 200) req.log.info({ leg: leg.legId, tx: settlementTx(res) }, 'paid sub-agent over x402');
          else req.log.error({ leg: leg.legId, status: res.status, body: (await res.text()).slice(0, 200) }, 'sub-agent payment refused');
        } catch (e) { req.log.error({ leg: leg.legId, err: (e as Error).message }, 'sub-agent payment failed'); }
      }
    })();
    return reply.code(202).send({ accepted: true });
  });

  await app.listen({ port: def.port, host: '::' }); // dual-stack: reachable as localhost over IPv4 and IPv6
  console.log(`${def.name} (${def.slug}) on :${def.port}  backend ${config.backendUrl}  ${me() ? 'registered' : 'NOT registered, run the seed script'}`);
}

/** The model or the network can be down for minutes. Try again with a growing pause instead of leaving a funded job stuck. */
async function withRetries<T>(fn: () => Promise<T>, agreementId: string, log: { warn: (o: unknown, m?: string) => void }): Promise<T> {
  const pauses = [20_000, 60_000, 120_000, 240_000];
  for (let i = 0; ; i++) {
    try { return await fn(); } catch (e) {
      if (i >= pauses.length) throw e;
      log.warn({ agreementId, err: (e as Error).message, retryInSec: pauses[i] / 1000 }, 'could not produce the work yet; will retry');
      await new Promise((r) => setTimeout(r, pauses[i]));
    }
  }
}

/** Agent-to-agent: have another listed agent review the draft; fix the draft only if the reviewer found a real critical/high problem. */
async function maybeReview(def: AgentDef, key: string, agreementId: string, requirements: string, draft: string, log: { info: (o: unknown, m?: string) => void; warn: (o: unknown, m?: string) => void }) {
  const target = def.hires ? loadState()[def.hires] : undefined;
  if (!def.hires || !target || !bySlug(def.hires)) return draft;
  try {
    const q = await a2aQuote(key, agreementId, target.agentId); // refused (403) if over the on-chain sub-agent cap
    const hired = await a2aCall(key, q.callId, { code: draft });
    const review = text((hired.output as { review?: unknown })?.review ?? hired.output);
    log.info({ agreementId, sub: def.hires, price: q.priceTinybar }, 'hired a sub-agent for a review');
    if (/critical|high/i.test(review) && !/VERDICT:\s*PASS/i.test(review)) {
      return await ask(def.system, `${jobPrompt(requirements, [])}\n\nYour draft:\n${draft}\n\nAn independent reviewer found these problems. Fix every real one and return the full corrected deliverable only:\n${review}`);
    }
  } catch (e) {
    // Not allowed, or the sub-agent is down: deliver the unreviewed draft rather than fail the job.
    log.warn({ agreementId, err: (e as Error).message }, 'sub-agent review skipped');
  }
  return draft;
}
