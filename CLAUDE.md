# AgentForge: instructions for Claude

Hackathon MVP (ETHGlobal Mumbai). Deadline Sat 7 Nov 2026, 09:00 IST. Solo developer.

## Source of truth
- Product: `docs/agentforge_mvp_PRD.md` (supersedes `docs/agent_forge_PRD.md`)
- Sequencing and cut line: `docs/build_plan.md`
- Process: `docs/spec_workflow.md` (spec-driven: capability map → `SPEC-<module>.md` → `spec-planner` → implement). Do not write code before the relevant spec is approved.
- Tooling: `docs/AI_TOOLING_SETUP.md`

## Rules
1. Money is `bigint` in code, `numeric(38,0)` in SQL, `uint256` in Solidity. No floats.
2. Database money states change only after the on-chain event is indexed.
3. All chain writes go through `chain_outbox`. No ad-hoc transactions in request handlers.
4. Never fake a payment, inference or storage write. If a service is down, show an error and queue.
5. Infrastructure errors never produce a FAIL verdict.
6. Do not invent APIs, addresses, package names or protocol fields. Check `hedera-docs` and `0g-docs` MCP servers or the live docs first, and write confirmed facts back into the docs.
7. Commit small and often (at least hourly). Keep prompts and planning docs in `docs/ai-usage/`.

## Stack
TypeScript (Node 22), Solidity 0.8.24, pnpm + Turborepo, Next.js, Fastify + Zod, PostgreSQL 16 + Drizzle, Foundry, viem, `@x402/*`, `@0gfoundation/0g-storage-ts-sdk`.

## Safety
- `hedera-testnet` MCP has no spend caps. Use a testnet-only account and never authenticate a funded or personal one.
- Chrome DevTools MCP runs with `--isolated`. Do not log into personal accounts in it.
- Never commit `.env` or private keys.
