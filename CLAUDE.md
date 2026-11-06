# AgentForge: instructions for Claude

Hackathon MVP (ETHGlobal Mumbai). Deadline Sat 7 Nov 2026, 09:00 IST. Solo developer.

## New here?
Run `/onboard` (or ask for the `project-guide` agent). It reads the key docs and gives a full briefing on the product, rules, status and next steps.

## Source of truth
- Source of truth: `docs/agentforge_architecture_v2.md` (design, units, API, DB) and `docs/build_steps.md` (build order). `docs/build_plan.md` and the PRD named in earlier drafts do not exist.
- Team and process: `docs/agent-team.md` (agent roster, file ownership, handoffs, waves). Task board: `tasks/todo.md`. Interfaces: `docs/contracts/` (API, agent protocol), `contracts/abi/`.
- Architecture decisions: `docs/adr/`. Deviations from these rules are logged in `docs/decisions.md`.
- Standards and the single quality gate: `docs/standards.md` and `scripts/check.sh`.

## Rules
1. Money is `bigint` in code, `numeric(38,0)` in SQL, `uint256` in Solidity. No floats.
2. Database money states change only after the on-chain event is indexed.
3. All chain writes live in `backend/src/chain/` (direct sends from one serialized relayer queue, with a state pre-check before release, refund or delegate). No ad-hoc transactions anywhere else. A `chain_outbox` is deferred (ADR-001).
4. Never fake a payment, inference or storage write. If a service is down, show an error and offer a retry.
5. Infrastructure errors never produce a FAIL verdict.
6. Do not invent APIs, addresses, package names or protocol fields. Check `hedera-docs` and `0g-docs` MCP servers or the live docs first, and write confirmed facts back into the docs.
7. Commit small and often (at least hourly). Keep prompts and planning docs in `docs/ai-usage/`.

## Stack
TypeScript (Node 22 or newer), Solidity 0.8.24, npm with separate packages per folder (`backend/`, `frontend/`, `demo-agents/`; no monorepo, no Turborepo, ADR-005), Next.js, Fastify + Zod, PostgreSQL 16 + Drizzle, Foundry, viem, `@0gfoundation/0g-storage-ts-sdk`. The x402 rail is a cuttable stretch.

## Safety
- `hedera-testnet` MCP has no spend caps. Use a testnet-only account and never authenticate a funded or personal one.
- Chrome DevTools MCP runs with `--isolated`. Do not log into personal accounts in it.
- Never commit `.env` or private keys.
