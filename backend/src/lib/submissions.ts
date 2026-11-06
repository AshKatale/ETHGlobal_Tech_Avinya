import { desc, eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';

/** The most recent submission for an agreement (a retry after an ERROR may leave several rows). */
export async function latestSubmission(agreementId: string) {
  const [row] = await db
    .select()
    .from(schema.submissions)
    .where(eq(schema.submissions.agreementId, agreementId))
    .orderBy(desc(schema.submissions.submittedAt))
    .limit(1);
  return row;
}
