import type { FastifyInstance } from 'fastify';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { requireAgent, requireUser, sha256 } from '../lib/auth.js';
import { canTransition, type AgreementStatus } from '../lib/stateMachine.js';
import { ensureSubmittedOnChain, settle } from '../chain/ops.js';
import { fetchRepo } from '../lib/github.js';
import { verify } from '../lib/analyzer.js';
import { uploadJson } from '../lib/zerog.js';

const idParam = z.object({ id: z.string().uuid() });

/** Runs verification for a submitted agreement. Infra errors store an ERROR result and allow a retry; they never FAIL the work. */
export async function runVerification(agreementId: string) {
  const [agreement] = await db.select().from(schema.agreements).where(eq(schema.agreements.id, agreementId)).limit(1);
  if (!agreement) return;
  if (!canTransition(agreement.status as AgreementStatus, 'verifying')) return;
  await db.update(schema.agreements).set({ status: 'verifying' }).where(eq(schema.agreements.id, agreementId));

  try {
    const [request] = await db.select().from(schema.requests).where(eq(schema.requests.id, agreement.requestId)).limit(1);
    const [submission] = await db.select().from(schema.submissions).where(eq(schema.submissions.agreementId, agreementId)).limit(1);
    if (!submission) throw new Error('No submission found');
    // Record the deliverable hash on-chain first; release/refund need the escrow in the Submitted state.
    await ensureSubmittedOnChain(agreementId);

    const files = submission.kind === 'repo' ? (await fetchRepo(submission.content)).files : { 'submission.txt': submission.content };
    const result = await verify({ requirements: request.requirements, checks: request.checksRequested, files });

    let reportRoot: string | null = null;
    try {
      reportRoot = await uploadJson({ agreementId, deliverableHash: submission.deliverableHash, ...result });
    } catch {
      /* report stays in Postgres only; surfaced via verifications.items */
    }

    const verdictResult = result.passed ? 'PASS' : 'FAIL';
    await db.insert(schema.verifications).values({
      agreementId,
      result: verdictResult,
      items: result.items,
      summary: result.summary,
      reportRoot,
    });
    await db.insert(schema.verdicts).values({ agreementId, result: verdictResult }).onConflictDoNothing();
    // Sign the verdict and send release/refund. If the chain fails the verdict is kept and POST /agreements/:id/settle retries.
    try { await settle(agreementId); } catch { /* error is stored on the verdict (settle_error) */ }
  } catch (e) {
    await db.insert(schema.verifications).values({ agreementId, result: 'ERROR', error: (e as Error).message });
    // Back to 'submitted' so the retry button works.
    await db.update(schema.agreements).set({ status: 'submitted' }).where(eq(schema.agreements.id, agreementId));
  }
}

export async function jobRoutes(app: FastifyInstance) {
  // The agent says the work is done.
  app.post('/agreements/:id/submit', { preHandler: requireAgent }, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const body = z
      .object({ content: z.string().min(1).max(200_000), kind: z.enum(['text', 'repo']).default('text') })
      .parse(req.body);

    const [agreement] = await db.select().from(schema.agreements).where(eq(schema.agreements.id, id)).limit(1);
    if (!agreement) return reply.code(404).send({ error: 'Agreement not found' });
    if (agreement.agentId !== req.agent!.id) return reply.code(403).send({ error: 'Not your agreement' });
    if (!canTransition(agreement.status as AgreementStatus, 'submitted')) {
      return reply.code(409).send({ error: `Cannot submit while status is ${agreement.status} (escrow must be funded)` });
    }
    if (body.kind === 'repo') {
      try { new URL(body.content); } catch { return reply.code(400).send({ error: 'content must be a repo URL when kind=repo' }); }
    }

    await db.insert(schema.submissions).values({
      agreementId: id,
      content: body.content,
      kind: body.kind,
      deliverableHash: sha256(body.content),
    });
    await db.update(schema.agreements).set({ status: 'submitted' }).where(eq(schema.agreements.id, id));
    // Phase 3: also call JobEscrow.submit(deliverableHash) through the relayer.
    void runVerification(id);
    return reply.code(202).send({ status: 'submitted', verification: 'started' });
  });

  // Client retries after an ERROR result.
  app.post('/agreements/:id/verify', { preHandler: requireUser }, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const [agreement] = await db.select().from(schema.agreements).where(eq(schema.agreements.id, id)).limit(1);
    if (!agreement) return reply.code(404).send({ error: 'Agreement not found' });
    if (agreement.clientUserId !== req.user!.id) return reply.code(403).send({ error: 'Not your agreement' });
    if (agreement.status !== 'submitted') return reply.code(409).send({ error: `Status is ${agreement.status}` });
    void runVerification(id);
    return reply.code(202).send({ status: 'verifying' });
  });

  app.get('/agreements/:id/verification', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const [agreement] = await db.select().from(schema.agreements).where(eq(schema.agreements.id, id)).limit(1);
    if (!agreement) return reply.code(404).send({ error: 'Agreement not found' });
    const runs = await db.select().from(schema.verifications).where(eq(schema.verifications.agreementId, id)).orderBy(desc(schema.verifications.createdAt));
    const [verdict] = await db.select().from(schema.verdicts).where(eq(schema.verdicts.agreementId, id)).limit(1);
    return {
      status: agreement.status,
      latest: runs[0] ?? null,
      history: runs,
      verdict: verdict ?? null,
      disclaimer: 'Automated verification is not a professional audit.',
    };
  });

  // Retry settlement (release/refund) if the chain failed after the verdict was stored.
  app.post('/agreements/:id/settle', { preHandler: requireUser }, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const [agreement] = await db.select().from(schema.agreements).where(eq(schema.agreements.id, id)).limit(1);
    if (!agreement) return reply.code(404).send({ error: 'Agreement not found' });
    try {
      return await settle(id);
    } catch (e) {
      return reply.code(502).send({ error: `Chain error: ${(e as Error).message}` });
    }
  });
}
