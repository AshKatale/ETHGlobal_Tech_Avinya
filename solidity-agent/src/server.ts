import Fastify from 'fastify';
import { ZodError, z } from 'zod';
import { design, designRequestSchema } from './design.js';
import { deployTask, designerAddress, DeployError } from './deploy.js';
import { contractSpecSchema } from './spec.js';
import { env } from './env.js';

export async function buildServer() {
  const app = Fastify({ logger: { level: 'info' } });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) return reply.code(400).send({ error: 'Validation failed', issues: err.issues });
    const status = (err as { statusCode?: number }).statusCode ?? (err instanceof DeployError ? 502 : 500);
    if (status >= 500) app.log.error(err);
    return reply.code(status).send({ error: (err as Error).message });
  });

  app.get('/health', async () => ({ ok: true, agent: 'solidity-agent', aiConfigured: Boolean(env.NVIDIA_API_KEY), designer: env.DESIGNER_PRIVATE_KEY ? designerAddress() : null }));

  // Design the terms for one task. No chain access, no side effects.
  app.post('/design', async (req) => {
    const body = designRequestSchema.parse(req.body);
    const d = await design(body);
    return { spec: d.spec, specHash: d.specHash, trust: d.trust, source: d.source };
  });

  // Deploy the task contract for an agreement. Spends the designer wallet's HBAR, so it needs the shared secret.
  app.post('/deploy', async (req, reply) => {
    if (!env.AGENT_SHARED_SECRET) return reply.code(503).send({ error: 'AGENT_SHARED_SECRET is not configured; /deploy is disabled' });
    if (req.headers['x-agent-secret'] !== env.AGENT_SHARED_SECRET) return reply.code(401).send({ error: 'Bad or missing x-agent-secret' });
    const body = z.object({
      agreementId: z.string().uuid(),
      client: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
      agent: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
      spec: contractSpecSchema,
    }).parse(req.body);
    const out = await deployTask({ agreementId: body.agreementId, client: body.client as `0x${string}`, agent: body.agent as `0x${string}`, spec: body.spec });
    return out;
  });

  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const app = await buildServer();
  await app.listen({ port: env.PORT, host: '0.0.0.0' });
}
