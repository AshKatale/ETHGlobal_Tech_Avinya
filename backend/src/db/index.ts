import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { env } from '../env.js';
import * as schema from './schema.js';

// Neon connection string (sslmode=require) works with the standard pg driver.
export const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 5, keepAlive: true });
// A dropped connection (Wi-Fi change, sleep, Neon restart) emits 'error' on the pool; unhandled, it crashes the whole server.
// The pool discards the broken client and opens a new one on the next query, so logging is enough.
pool.on('error', (e) => console.error('[db] idle connection error:', e.message));
export const db = drizzle(pool, { schema });
export { schema };
