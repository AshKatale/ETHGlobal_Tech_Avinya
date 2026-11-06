import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, isNotNull } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { optionalAuth, requireAgent, requireUser, sha256 } from '../lib/auth.js';
import { canViewPrivate, publicVerdict, publicVerification } from '../lib/access.js';
import { canTransition, type AgreementStatus } from '../lib/stateMachine.js';
import { ensureSubmittedOnChain, refundTimeout, settle } from '../chain/ops.js';
import { fetchRepo } from '../lib/github.js';
import { verify } from '../lib/analyzer.js';
import { uploadJson } from '../lib/zerog.js';
import { latestSubmission } from '../lib/submissions.js';
import { dispatchAgreement } from '../lib/agentClient.js';

const idParam = z.object({ id: z.string().uuid() });

/** Runs verification for a submitted agreement. Infra errors store an ERROR result and allow a retry; they never FAIL the work. */
export async function runVerification(agreementId: string) {
  const [agreement] = await db.select().from(schema.agreements).where(eq(schema.agreements.id, agreementId)).limit(1);
  if (!agreement) return;
  if (!canTransition(agreement.status as AgreementStatus, 'verifying')) return;
  // Atomic claim so two simultaneous triggers (submit + retry) start one run. verifying_since feeds the recovery sweep (S-21).
  const claimed = await db
    .update(schema.agreements)
    .set({ status: 'verifying', verifyingSince: new Date() })
    .where(and(eq(schema.agreements.id, agreementId), eq(schema.agreements.status, agreement.status)))
    .returning({ id: schema.agreements.id });
  if (claimed.length === 0) return;

  try {
    const [request] = await db.select().from(schema.requests).where(eq(schema.requests.id, agreement.requestId)).limit(1);
    const submission = await latestSubmission(agreementId);
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
    // Only a funded agreement accepts work. Resubmitting while submitted or verifying is refused.
    if (agreement.status !== 'funded') {
      return reply.code(409).send({ error: `Cannot submit while status is ${agreement.status} (escrow must be funded)` });
    }
    if (body.kind === 'repo') {
      try { new URL(body.content); } catch { return reply.code(400).send({ error: 'content must be a repo URL when kind=repo' }); }
    }

    // Claim the funded -> submitted transition atomically so two simultaneous submits cannot both win.
    const claimed = await db.transaction(async (tx) => {
      const moved = await tx
        .update(schema.agreements)
        .set({ status: 'submitted' })
        .where(and(eq(schema.agreements.id, id), eq(schema.agreements.status, 'funded')))
        .returning({ id: schema.agreements.id });
      if (moved.length === 0) return false;
      await tx.insert(schema.submissions).values({
        agreementId: id,
        content: body.content,
        kind: body.kind,
        deliverableHash: sha256(body.content),
      });
      return true;
    });
    if (!claimed) return reply.code(409).send({ error: 'Cannot submit: agreement is no longer funded' });
    // Verification records the deliverable hash on-chain (ensureSubmittedOnChain) and then settles.
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

  app.get('/agreements/:id/verification', { preHandler: optionalAuth }, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const [agreement] = await db.select().from(schema.agreements).where(eq(schema.agreements.id, id)).limit(1);
    if (!agreement) return reply.code(404).send({ error: 'Agreement not found' });
    const runs = await db.select().from(schema.verifications).where(eq(schema.verifications.agreementId, id)).orderBy(desc(schema.verifications.createdAt));
    const [verdict] = await db.select().from(schema.verdicts).where(eq(schema.verdicts.agreementId, id)).limit(1);
    const full = await canViewPrivate(req, agreement); // S-09: raw errors and work-derived text only for participants
    return {
      status: agreement.status,
      latest: full ? (runs[0] ?? null) : publicVerification(runs[0]),
      history: full ? runs : runs.map((r) => publicVerification(r)),
      verdict: full ? (verdict ?? null) : publicVerdict(verdict),
      viewerAccess: full ? 'full' : 'public',
      disclaimer: 'Automated verification is not a professional audit.',
    };
  });

  // Public audit trail (ADR-003): every verifier signature for this agreement (sha256 of the signature only), plus the
  // public settlement facts. Nothing here is secret: the verdict signature, nonce and tx hash are on-chain.
  app.get('/agreements/:id/audit', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const [agreement] = await db.select().from(schema.agreements).where(eq(schema.agreements.id, id)).limit(1);
    if (!agreement) return reply.code(404).send({ error: 'Agreement not found' });
    const entries = await db.select().from(schema.signatureAudit).where(eq(schema.signatureAudit.agreementId, id)).orderBy(asc(schema.signatureAudit.createdAt));
    const [verdict] = await db.select().from(schema.verdicts).where(eq(schema.verdicts.agreementId, id)).limit(1);
    const [lastRun] = await db.select({ reportRoot: schema.verifications.reportRoot }).from(schema.verifications)
      .where(and(eq(schema.verifications.agreementId, id), isNotNull(schema.verifications.reportRoot)))
      .orderBy(desc(schema.verifications.createdAt)).limit(1);
    const submission = await latestSubmission(id);
    return {
      agreementId: id,
      escrowAddress: agreement.escrowAddress,
      entries,
      verdict: verdict ? { result: verdict.result, nonce: verdict.nonce, signature: verdict.verifierSig, settleTxHash: verdict.settleTxHash } : null,
      settleTxHash: verdict?.settleTxHash ?? null,
      reportRoot: lastRun?.reportRoot ?? null,
      deliverableHash: submission?.deliverableHash ?? null,
    };
  });

  // Retry settlement (release/refund) if the chain failed after the verdict was stored.
  app.post('/agreements/:id/settle', { preHandler: requireUser }, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const [agreement] = await db.select().from(schema.agreements).where(eq(schema.agreements.id, id)).limit(1);
    if (!agreement) return reply.code(404).send({ error: 'Agreement not found' });
    // Only the client or the owner of the agreement's agent may trigger settlement.
    let allowed = agreement.clientUserId === req.user!.id;
    if (!allowed) {
      const [agent] = await db.select({ ownerUserId: schema.agents.ownerUserId }).from(schema.agents).where(eq(schema.agents.id, agreement.agentId)).limit(1);
      allowed = agent?.ownerUserId === req.user!.id;
    }
    if (!allowed) return reply.code(403).send({ error: 'Only the client or the agent owner can settle this agreement' });
    try {
      return await settle(id);
    } catch (e) {
      return reply.code(502).send({ error: `Chain error: ${(e as Error).message}` });
    }
  });

  // V2 escrows only: refund the client when no verdict arrived within the review window (refundIfNoVerdict).
  app.post('/agreements/:id/refund-timeout', { preHandler: requireUser }, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const [agreement] = await db.select().from(schema.agreements).where(eq(schema.agreements.id, id)).limit(1);
    if (!agreement) return reply.code(404).send({ error: 'Agreement not found' });
    let allowed = agreement.clientUserId === req.user!.id;
    if (!allowed) {
      const [agent] = await db.select({ ownerUserId: schema.agents.ownerUserId }).from(schema.agents).where(eq(schema.agents.id, agreement.agentId)).limit(1);
      allowed = agent?.ownerUserId === req.user!.id;
    }
    if (!allowed) return reply.code(403).send({ error: 'Only the client or the agent owner can use this' });
    if (!agreement.escrowAddress) return reply.code(409).send({ error: 'Agreement has no escrow' });
    try {
      const r = await refundTimeout(id);
      switch (r.kind) {
        case 'sent': return { txHash: r.txHash, result: 'refund_timeout' };
        case 'v1': return reply.code(501).send({ error: 'This escrow is a V1 contract: it has no review timeout (refundIfNoVerdict exists only on V2 escrows)' });
        case 'too_early': return reply.code(409).send({ error: 'Review window has not passed yet', remainingSeconds: r.remainingSeconds });
        case 'wrong_state': return reply.code(409).send({ error: `Escrow is in state ${r.state}; the timeout refund needs Submitted` });
        case 'in_progress': return { already: true, inProgress: true };
      }
    } catch (e) {
      return reply.code(502).send({ error: `Chain error: ${(e as Error).message}` });
    }
  });

  // Retry the POST /tasks callback to the agent (after a stored dispatch_error). Client or the agent's owner.
  app.post('/agreements/:id/dispatch', { preHandler: requireUser }, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const [agreement] = await db.select().from(schema.agreements).where(eq(schema.agreements.id, id)).limit(1);
    if (!agreement) return reply.code(404).send({ error: 'Agreement not found' });
    let allowed = agreement.clientUserId === req.user!.id;
    if (!allowed) {
      const [agent] = await db.select({ ownerUserId: schema.agents.ownerUserId }).from(schema.agents).where(eq(schema.agents.id, agreement.agentId)).limit(1);
      allowed = agent?.ownerUserId === req.user!.id;
    }
    if (!allowed) return reply.code(403).send({ error: 'Not your agreement' });
    if (agreement.status !== 'funded') return reply.code(409).send({ error: `Status is ${agreement.status}; only a funded agreement is dispatched` });
    if (agreement.dispatchedAt) return reply.code(409).send({ error: 'Already dispatched' });
    void dispatchAgreement(id);
    return reply.code(202).send({ status: 'dispatching' });
  });
}
