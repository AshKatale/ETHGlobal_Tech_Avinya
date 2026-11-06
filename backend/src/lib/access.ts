// Who may see submission content and raw error strings (S-09). Everyone else gets metadata only.
import type { FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';

type Agreement = Pick<typeof schema.agreements.$inferSelect, 'clientUserId' | 'agentId'>;

/** Client, the agent's owner (session), or the agent itself (x-agent-key). Call optionalAuth first. */
export async function canViewPrivate(req: FastifyRequest, agreement: Agreement): Promise<boolean> {
  if (req.agent && req.agent.id === agreement.agentId) return true;
  if (!req.user) return false;
  if (req.user.id === agreement.clientUserId) return true;
  const [agent] = await db.select({ ownerUserId: schema.agents.ownerUserId }).from(schema.agents).where(eq(schema.agents.id, agreement.agentId)).limit(1);
  return agent?.ownerUserId === req.user.id;
}

type Submission = typeof schema.submissions.$inferSelect;
export const publicSubmission = (s: Submission | undefined | null) =>
  s ? { id: s.id, agreementId: s.agreementId, kind: s.kind, deliverableHash: s.deliverableHash, submittedAt: s.submittedAt, redacted: true } : null;

type Verdict = typeof schema.verdicts.$inferSelect;
/** Verdict result, nonce, signature and settle tx hash stay public (on-chain). settleError is a raw error string. */
export const publicVerdict = (v: Verdict | undefined | null) => (v ? { ...v, settleError: null } : null);

type Verification = typeof schema.verifications.$inferSelect;
type Item = { name?: unknown; passed?: unknown };
/** Result, timestamps and report root stay; error text, prose summary and per-item detail (may quote the work) are removed. */
export const publicVerification = (v: Verification | undefined | null) => {
  if (!v) return null;
  const items = Array.isArray(v.items)
    ? (v.items as Item[]).map((i) => ({ name: i.name, passed: i.passed, detail: '' }))
    : v.items;
  return { ...v, items, summary: null, error: v.error ? 'redacted' : null };
};

type Call = typeof schema.a2aCalls.$inferSelect;
const OUR_REASONS = /^(Callee agent is not listed|An agent cannot hire|Max depth of|Would exceed the|Budget exceeded|Payment failed$|Callee failed after payment)/;
/** Our own fixed reasons stay; anything else (older rows could hold upstream text) is dropped. */
export const publicBlockedReason = (r: string | null) => (r && OUR_REASONS.test(r) ? r : null);
export const publicCall = <T extends Call>(c: T): T => ({ ...c, blockedReason: publicBlockedReason(c.blockedReason) });
