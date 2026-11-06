// Seed sample marketplace data so the UI is not empty. Safe to run twice: rows are matched by name/title and
// only created when missing. Everything is flagged isSeeded = true. Seeded agents have no endpoint, so the backend never calls them.
// Usage: npm run seed
import 'dotenv/config';
import { and, eq } from 'drizzle-orm';
import { db, pool, schema } from '../src/db/index.js';
import { sha256 } from '../src/lib/auth.js';

const SEED_ADDRESS = '0x000000000000000000000000000000005eed0001';
const HBAR = 100_000_000n; // 1 HBAR in tinybar

const AGENTS = [
  { name: 'DocuBot (sample)', description: 'Writes README files and API docs from a repository tree.', capabilities: ['docs', 'writing'], price: HBAR / 2n, score: '88.00' },
  { name: 'TestSmith (sample)', description: 'Generates unit tests for TypeScript and Solidity projects.', capabilities: ['testing', 'typescript', 'solidity'], price: HBAR, score: '84.50' },
  { name: 'LintSweep (sample)', description: 'Fixes lint errors and tightens tsconfig strictness.', capabilities: ['lint', 'typescript'], price: HBAR / 4n, score: '91.00' },
];

const REQUESTS = [
  { title: 'Write a README for my CLI tool (sample)', requirements: 'Document install, usage and three examples for a small Node.js CLI. Keep it under 200 lines.', budget: HBAR, checks: ['secrets_scan'] },
  { title: 'Add unit tests to a payments module (sample)', requirements: 'Cover rounding, zero amounts and overflow for a bigint money helper with vitest.', budget: 2n * HBAR, checks: ['build_config', 'lint_rules'] },
  { title: 'Fix lint errors across a Next.js app (sample)', requirements: 'Resolve all ESLint errors and enable strict TypeScript without changing behaviour.', budget: HBAR / 2n, checks: ['lint_rules', 'dependency_check'] },
];

async function main() {
  let [user] = await db.select().from(schema.users).where(eq(schema.users.address, SEED_ADDRESS)).limit(1);
  if (!user) [user] = await db.insert(schema.users).values({ address: SEED_ADDRESS, displayName: 'AgentForge sample data' }).returning();

  let createdAgents = 0, createdRequests = 0;
  for (const a of AGENTS) {
    const [existing] = await db.select({ id: schema.agents.id }).from(schema.agents)
      .where(and(eq(schema.agents.name, a.name), eq(schema.agents.isSeeded, true))).limit(1);
    if (existing) continue;
    const [agent] = await db.insert(schema.agents).values({
      ownerUserId: user.id, name: a.name, description: a.description, capabilities: a.capabilities,
      payoutAddress: SEED_ADDRESS, priceTinybar: a.price.toString(), status: 'listed', isSeeded: true,
      apiKeyHash: sha256(`seed-${a.name}-${Math.random()}`), // the key is discarded: seeded agents cannot act
    }).returning();
    const [run] = await db.insert(schema.benchmarkRuns).values({
      agentId: agent.id, repoUrl: 'https://github.com/example/sample-agent', status: 'passed',
      customScore: a.score, aiScore: a.score, score: a.score, reviewText: 'Sample data: this benchmark result was seeded, not produced by a real run.',
      items: [{ id: 'sample', label: 'Seeded sample result', passed: true }],
    }).returning();
    await db.update(schema.agents).set({ latestBenchmarkId: run.id }).where(eq(schema.agents.id, agent.id));
    createdAgents++;
  }
  for (const r of REQUESTS) {
    const [existing] = await db.select({ id: schema.requests.id }).from(schema.requests)
      .where(and(eq(schema.requests.title, r.title), eq(schema.requests.isSeeded, true))).limit(1);
    if (existing) continue;
    await db.insert(schema.requests).values({
      clientUserId: user.id, title: r.title, requirements: r.requirements, checksRequested: r.checks,
      budgetTinybar: r.budget.toString(), isSeeded: true,
    });
    createdRequests++;
  }
  console.log(`seed: created ${createdAgents} agents and ${createdRequests} requests (existing rows left untouched)`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => pool.end());
