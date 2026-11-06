import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Unit tests never touch the database; env.ts just needs a value to parse.
    env: { DATABASE_URL: 'postgres://test:test@localhost:5432/test' },
  },
});
