import Fastify from 'fastify';
import { z } from 'zod';
import { BackendError, submitWork } from './backend.js';
import { config } from './config.js';

export type TaskContext = { agreementId: string; requirements: string; checks: string[]; priceTinybar?: string };
export type Deliverable = { content: string; kind?: 'text' | 'repo' };

export type AgentSpec = {
  name: string;
  capability: string;
  port: number;
  /** Price this agent asks for a job. Tinybar as a whole-number string. */
  quote: (requirements: string) => Promise<{ priceTinybar: string; etaHours: number }> | { priceTinybar: string; etaHours: number };
  /** Do the work for a job. Throw if it cannot; nothing is submitted then. */
  handleTask: (ctx: TaskContext) => Promise<Deliverable>;
  /** Optional: answer an agent-to-agent call. The hiring agent pays this agent over x402 after the whole task is released. */
  handleA2a?: (input: unknown) => Promise<unknown>;
};

const quoteBody = z.object({ requirements: z.string().default('') }).passthrough();
const taskBody = z.object({
  agreementId: z.string().uuid(),
  requirements: z.string().min(1),
  checks: z.array(z.string()).default([]),
  priceTinybar: z.string().optional(),
}).passthrough();
const a2aBody = z.object({ input: z.unknown() }).passthrough();

/** Standard agent server: GET /health, POST /quote, POST /tasks (202, async), POST /a2a. */
export async function createAgent(spec: AgentSpec) {
  const app = Fastify({ logger: { level: 'info' } });

  // If BACKEND_SECRET is set, only the backend may call the work endpoints.
  app.addHook('preHandler', async (req, reply) => {
    if (req.url === '/health' || !config.backendSecret) return;
    if (req.headers['x-backend-secret'] !== config.backendSecret) return reply.code(401).send({ error: 'Bad or missing x-backend-secret' });
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof z.ZodError) return reply.code(400).send({ error: 'Validation failed', issues: err.issues });
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    return reply.code(status).send({ error: (err as Error).message });
  });

  app.get('/health', async () => ({ ok: true, name: spec.name, capability: spec.capability }));

  app.post('/quote', async (req) => {
    const { requirements } = quoteBody.parse(req.body ?? {});
    return spec.quote(requirements);
  });

  app.post('/tasks', async (req, reply) => {
    const ctx = taskBody.parse(req.body);
    // Answer immediately; the work runs in the background and is submitted to the backend when done.
    void runTask(spec, ctx, app.log);
    return reply.code(202).send({ accepted: true, agreementId: ctx.agreementId });
  });

  app.post('/a2a', async (req, reply) => {
    if (!spec.handleA2a) return reply.code(404).send({ error: 'This agent does not take agent-to-agent calls' });
    const { input } = a2aBody.parse(req.body ?? {});
    return spec.handleA2a(input);
  });

  await app.listen({ port: spec.port, host: '0.0.0.0' });
  return app;
}

type Logger = { info: (o: unknown, m?: string) => void; error: (o: unknown, m?: string) => void };

async function runTask(spec: AgentSpec, ctx: TaskContext, log: Logger) {
  let work: Deliverable;
  try {
    work = await spec.handleTask(ctx);
    if (!work.content.trim()) throw new Error('empty deliverable');
  } catch (e) {
    // Do not submit anything fake. The job stays funded and the client can see there is no submission.
    log.error({ agreementId: ctx.agreementId, err: (e as Error).message }, 'task failed; nothing submitted');
    return;
  }
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await submitWork(ctx.agreementId, work.content, work.kind ?? 'text');
      log.info({ agreementId: ctx.agreementId }, 'work submitted');
      return;
    } catch (e) {
      const status = e instanceof BackendError ? e.status : undefined;
      log.error({ agreementId: ctx.agreementId, attempt, status, err: (e as Error).message }, 'submit failed');
      if (status && status < 500) return; // a 4xx will not fix itself on retry
    }
  }
}
