// Cross-process single-flight per key using a Postgres transaction-level advisory lock. A transaction-level lock (not a
// session lock) is required: the Neon pooler runs in transaction mode, where session locks are not reliable.
import { pool } from '../db/index.js';

/** Runs `fn` only if no other caller holds the lock for `key`; otherwise returns { busy: true } without waiting. */
export async function singleFlight<T>(key: string, fn: () => Promise<T>): Promise<{ busy: true } | { busy: false; value: T }> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const r = await client.query('select pg_try_advisory_xact_lock(hashtext($1)) as ok', [key]);
    if (r.rows[0]?.ok !== true) {
      await client.query('rollback');
      return { busy: true };
    }
    try {
      return { busy: false, value: await fn() };
    } finally {
      await client.query('rollback').catch(() => {}); // releases the lock; the transaction wrote nothing
    }
  } finally {
    client.release();
  }
}
