// S-21: an agreement stuck in 'verifying' (backend crashed or restarted mid-run, or the model call hung) is moved back to
// 'submitted' with an ERROR verification row so the client's retry works. Never produces FAIL (rule 5). Idempotent.
import { sql } from 'drizzle-orm';
import { db as defaultDb, schema } from '../db/index.js';

export const STUCK_VERIFY_MS = 10 * 60 * 1000;
export const STUCK_MESSAGE = 'Verification did not finish within 10 minutes (the backend restarted or a service timed out). Reset to submitted; retry verification.';

export async function recoverStuckVerifying(olderThanMs = STUCK_VERIFY_MS, database: typeof defaultDb = defaultDb): Promise<string[]> {
  const cutoff = new Date(Date.now() - olderThanMs);
  return database.transaction(async (tx) => {
    // A verdict means verification finished and only settlement is pending: those stay 'verifying' (the indexer moves them).
    // Rows without verifying_since (set by older code) fall back to the newest submission time.
    const res = await tx.execute(sql`
      UPDATE agreements SET status = 'submitted', verifying_since = NULL
      WHERE status = 'verifying'
        AND NOT EXISTS (SELECT 1 FROM verdicts v WHERE v.agreement_id = agreements.id)
        AND COALESCE(verifying_since, (SELECT max(s.submitted_at) FROM submissions s WHERE s.agreement_id = agreements.id), created_at) < ${cutoff}
      RETURNING id`);
    const ids = (res.rows as { id: string }[]).map((r) => r.id);
    for (const id of ids) {
      await tx.insert(schema.verifications).values({ agreementId: id, result: 'ERROR', error: STUCK_MESSAGE });
    }
    return ids;
  });
}
