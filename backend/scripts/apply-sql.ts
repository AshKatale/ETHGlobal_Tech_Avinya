// Applies a drizzle migration file by hand (statements split on the breakpoint marker). Use instead of db:push:
// the shared DB has columns this schema does not define, and push would try to drop them. Files use IF NOT EXISTS.
import { readFileSync } from 'node:fs';
import { pool } from '../src/db/index.js';

const file = process.argv[2];
if (!file) throw new Error('usage: tsx scripts/apply-sql.ts drizzle/NNNN_name.sql');
for (const stmt of readFileSync(file, 'utf8').split('--> statement-breakpoint').map((s) => s.trim()).filter(Boolean)) {
  await pool.query(stmt);
  console.log('ok:', stmt.split('\n')[0].slice(0, 90));
}
await pool.end();
