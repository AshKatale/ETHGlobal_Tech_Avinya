import { readFileSync } from 'node:fs';
import { parse } from 'dotenv';
import { defineConfig } from 'vitest/config';

// Unit tests never need a database. Integration tests (*.int.test.ts) run against the shared Neon DB when
// backend/.env has a DATABASE_URL, tag their rows "[qa]" and delete them afterwards; otherwise they skip.
let realUrl = '';
try { realUrl = parse(readFileSync(new URL('./.env', import.meta.url)))['DATABASE_URL'] ?? ''; } catch { /* no .env */ }

export default defineConfig({
  test: {
    env: {
      DATABASE_URL: realUrl || 'postgres://test:test@localhost:5432/test',
      HAS_REAL_DB: realUrl ? '1' : '',
      INDEXER_ENABLED: 'false',
      ALLOW_LOCAL_AGENTS: 'false',
    },
    testTimeout: 30_000,
  },
});
