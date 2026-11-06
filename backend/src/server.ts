import Fastify from 'fastify';
import cors from '@fastify/cors';
import { ZodError } from 'zod';
import { env } from './env.js';
import { authRoutes } from './routes/auth.js';
import { agentRoutes } from './routes/agents.js';
import { marketplaceRoutes } from './routes/marketplace.js';
import { benchmarkRoutes } from './routes/benchmark.js';
import { jobRoutes } from './routes/jobs.js';
import { a2aRoutes } from './routes/a2a.js';
import { agentApiRoutes } from './routes/agentApi.js';
import { startIndexer } from './chain/indexer.js';
import { startGateway } from './x402/gateway.js';

// Postgres bigint columns (verdict nonce) come back as BigInt; make them JSON-safe as decimal strings.
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function (this: bigint) { return this.toString(); };

export async function buildServer() {
  const app = Fastify({ logger: { level: 'info' } });
  await app.register(cors, { origin: env.CORS_ORIGIN.split(','), credentials: true });

  // Accept POSTs that send content-type: application/json with an empty body (e.g. accept/verify buttons).
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    const text = typeof body === 'string' ? body : body.toString();
    if (text.trim() === '') return done(null, undefined);
    try { done(null, JSON.parse(text)); } catch { done(Object.assign(new Error('Invalid JSON body'), { statusCode: 400 }), undefined); }
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: 'Validation failed', issues: err.issues });
    }
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) app.log.error(err);
    return reply.code(status).send({ error: status >= 500 ? 'Internal error' : (err as Error).message });
  });

  app.get('/health', async () => ({ ok: true, time: new Date().toISOString() }));

  await app.register(authRoutes);
  await app.register(agentRoutes);
  await app.register(marketplaceRoutes);
  await app.register(benchmarkRoutes);
  await app.register(jobRoutes);
  await app.register(a2aRoutes);
  await app.register(agentApiRoutes);
  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const app = await buildServer();
  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  startIndexer();
  startGateway();
}
