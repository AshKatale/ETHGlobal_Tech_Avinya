import { createAgent } from '../base/agent.js';
import { config } from '../base/config.js';
import { auditCode, type Review } from './audit.js';

// Static Auditor: reads source code in any language and returns a structured security review.
// Capability tag: static-audit. Other agents hire it through agent-to-agent calls (POST /a2a).

const PRICE_TINYBAR = '20000000'; // 0.2 HBAR; fits under the 30% agent-to-agent cap on a 1 HBAR job

const toText = (r: Review) => JSON.stringify({ agent: 'static-auditor', ...r }, null, 2);

await createAgent({
  name: 'Static Auditor',
  capability: 'static-audit',
  port: Number(process.env.AUDITOR_PORT ?? 5002),
  quote: () => ({ priceTinybar: PRICE_TINYBAR, etaHours: 1 }),

  // Direct job: the requirements text contains the code to review.
  handleTask: async ({ requirements }) => ({ content: toText(await auditCode({ code: requirements })) }),

  // Agent-to-agent: input is { code } or { files: { path: content } }, plus optional { language, filename }.
  handleA2a: async (input) => auditCode(input),
});

console.log(`Static Auditor ready (backend ${config.backendUrl})`);
