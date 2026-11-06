import Fastify from 'fastify';
import { z } from 'zod';
import { config } from './lib/config.js';
import { log } from './lib/log.js';
import { requireBackendKey, submitWithRetry } from './lib/guard.js';
import { buildContract, reviseContract } from './build.js';
import { hireAuditor } from './hire.js';

process.env.AGENT_NAME = 'solidity-builder';
const app = Fastify({ logger: false });

const reviewToText = (review: unknown) => (typeof review === 'string' ? review : JSON.stringify(review, null, 2));

app.get('/health', async () => ({ ok: true, capability: 'solidity-build' }));

// Protocol (inferred from docs/build_steps.md Phase 2; confirm against docs/contracts/agent-protocol.md).
app.post('/quote', { preHandler: requireBackendKey }, async () => ({ priceTinybar: config.priceTinybar, etaHours: config.etaHours }));

async function runTask(agreementId: string, requirements: string) {
  let built = await buildContract(requirements);
  log('info', 'contract written', { agreementId, contractName: built.contractName, bytes: built.solidity.length });

  let note = '';
  const hire = await hireAuditor(agreementId, built.solidity, requirements);
  if (hire.status === 'done') {
    const reviewText = reviewToText(hire.review);
    try {
      built = await reviseContract(built.solidity, reviewText, requirements);
      note = `// Reviewed by Static Auditor (hired via AgentForge A2A); fixes applied.\n/*\n${reviewText}\n*/\n`;
    } catch (e) {
      // Fall back to appending the review unchanged; do not fail the job over a revision error.
      log('warn', 'revision failed; appending review', { error: (e as Error).message });
      note = `// Reviewed by Static Auditor; fixes NOT applied.\n/*\n${reviewText}\n*/\n`;
    }
  } else {
    note = `// Static Auditor review unavailable (${hire.status}: ${hire.reason}).\n`;
  }

  // Demo: try to buy more than the 30% A2A budget allows so the backend blocks the second hire.
  if (config.demoOverbuy) {
    const again = await hireAuditor(agreementId, built.solidity, requirements);
    log('info', 'overbuy attempt', { result: again.status, reason: again.status === 'done' ? undefined : again.reason });
    if (again.status === 'blocked') note += `// Second hire blocked by the backend: ${again.reason}\n`;
  }

  await submitWithRetry(agreementId, `${built.solidity}\n\n${note}`);
  log('info', 'submitted', { agreementId });
}

const seen = new Set<string>(); // dedupe: the backend may deliver /tasks twice

app.post('/tasks', { preHandler: requireBackendKey }, async (req, reply) => {
  const body = z.object({ agreementId: z.string(), requirements: z.union([z.string(), z.record(z.string(), z.unknown())]) }).safeParse(req.body);
  if (!body.success) return reply.code(400).send({ error: 'Expected {agreementId, requirements}' });
  const { agreementId, requirements } = body.data;
  if (seen.has(agreementId)) return reply.code(202).send({ accepted: true });
  seen.add(agreementId);
  const text = typeof requirements === 'string' ? requirements : JSON.stringify(requirements);
  void runTask(agreementId, text).catch((e) => { seen.delete(agreementId); log('error', 'task failed', { agreementId, error: (e as Error).message }); });
  return reply.code(202).send({ accepted: true });
});

app.listen({ port: config.port, host: '0.0.0.0' }).then(() => log('info', 'listening', { port: config.port, overbuy: config.demoOverbuy }));
