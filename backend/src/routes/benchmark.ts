import type { FastifyInstance } from 'fastify';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { requireUser } from '../lib/auth.js';
import { env } from '../env.js';
import { fetchRepo } from '../lib/github.js';
import { benchmark } from '../lib/analyzer.js';
import { uploadJson } from '../lib/zerog.js';

async function runBenchmark(runId: string, agentId: string) {
  const [agent] = await db.select().from(schema.agents).where(eq(schema.agents.id, agentId)).limit(1);
  try {
    const repo = await fetchRepo(agent.repoUrl!);
    await db.update(schema.benchmarkRuns).set({ repoCommit: repo.commit }).where(eq(schema.benchmarkRuns.id, runId));

    const result = await benchmark({
      capabilities: agent.capabilities,
      description: agent.description,
      files: repo.files,
      tree: repo.tree,
    });
    const passed = result.score >= env.BENCHMARK_PASS_SCORE;

    // Store the report on 0G. If storage is down, keep the report in Postgres and leave report_root empty.
    let reportRoot: string | null = null;
    let storageNote: string | null = null;
    try {
      reportRoot = await uploadJson({ agentId, repo: repo.url, commit: repo.commit, ...result });
    } catch (e) {
      storageNote = `0G Storage upload failed: ${(e as Error).message}`;
    }

    await db
      .update(schema.benchmarkRuns)
      .set({
        status: passed ? 'passed' : 'failed',
        customScore: String(result.customScore),
        aiScore: String(result.aiScore),
        score: String(result.score),
        reviewText: result.review,
        items: result.items,
        reportRoot,
        error: storageNote,
      })
      .where(eq(schema.benchmarkRuns.id, runId));
    await db
      .update(schema.agents)
      .set({ status: passed ? 'listed' : 'failed', repoCommit: repo.commit, latestBenchmarkId: runId })
      .where(eq(schema.agents.id, agentId));
  } catch (e) {
    // Infrastructure problems (GitHub, NVIDIA) are an error, not a failed benchmark.
    await db
      .update(schema.benchmarkRuns)
      .set({ status: 'error', error: (e as Error).message })
      .where(eq(schema.benchmarkRuns.id, runId));
    await db.update(schema.agents).set({ status: 'draft', latestBenchmarkId: runId }).where(eq(schema.agents.id, agentId));
  }
}

export async function benchmarkRoutes(app: FastifyInstance) {
  app.post('/agents/:id/benchmark', { preHandler: requireUser }, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ repoUrl: z.string().url().optional() }).parse(req.body ?? {});

    const [agent] = await db.select().from(schema.agents).where(eq(schema.agents.id, id)).limit(1);
    if (!agent) return reply.code(404).send({ error: 'Agent not found' });
    if (agent.ownerUserId !== req.user!.id) return reply.code(403).send({ error: 'Not your agent' });
    if (agent.status === 'benchmarking') return reply.code(409).send({ error: 'Benchmark already running' });

    const repoUrl = body.repoUrl ?? agent.repoUrl;
    if (!repoUrl) return reply.code(400).send({ error: 'Set a GitHub repo URL first' });

    await db.update(schema.agents).set({ repoUrl, status: 'benchmarking' }).where(eq(schema.agents.id, id));
    const [run] = await db.insert(schema.benchmarkRuns).values({ agentId: id, repoUrl }).returning();
    void runBenchmark(run.id, id); // background; client polls GET /agents/:id/benchmark/:runId
    return reply.code(202).send({ runId: run.id, status: 'running' });
  });

  app.get('/agents/:id/benchmark/:runId', async (req, reply) => {
    const { id, runId } = z.object({ id: z.string().uuid(), runId: z.string().uuid() }).parse(req.params);
    const [run] = await db.select().from(schema.benchmarkRuns).where(eq(schema.benchmarkRuns.id, runId)).limit(1);
    if (!run || run.agentId !== id) return reply.code(404).send({ error: 'Run not found' });
    return run;
  });

  app.get('/agents/:id/benchmarks', async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return db.select().from(schema.benchmarkRuns).where(eq(schema.benchmarkRuns.agentId, id)).orderBy(desc(schema.benchmarkRuns.createdAt));
  });
}
