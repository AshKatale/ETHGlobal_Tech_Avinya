# AgentForge plan

Deadline Sat 7 Nov 2026, 09:00 IST. Spec: docs/agentforge_architecture_v2.md, docs/build_steps.md, charter section 10. Board: tasks/todo.md.

## Dependency graph
- Contract files unblock Wave B: T-01 (api.md) -> frontend T-27..T-30; T-02 (agent-protocol.md) -> T-13, T-14, T-18.
- Contracts: T-05 (forge runs) -> T-06 (delegate) -> T-07 (ABIs) -> T-08 (redeploy) -> T-15 (backend delegate + Delegated index), T-31 (fund UI), T-33 (settlement on chain).
- Backend fixes T-09..T-12 and T-16, T-24 have no dependencies; start now.
- Backend chain: T-12 (SSRF) -> T-14 (quote solicitation); T-13 (dispatch after funded) needs T-02.
- Agents: T-17 -> T-18, T-19 -> T-20 (needs T-15) -> T-21 (human publish) -> T-23 (benchmark >= 80).
- Frontend: T-26 -> T-27 -> T-29/T-30 -> T-31 -> T-32.
- QA T-39 needs T-23, T-32, T-33; T-40 after; docs T-41 after T-39.
- Human: T-22 (fund 0G key) now; T-21 after agents exist.
- Cuttable last: T-42 x402, T-43 extra checks, T-44 third agent, T-45 polish, T-46 GitHub OAuth.

## Waves
- A (now): T-01..T-05, T-09..T-12, T-16, T-17, T-22, T-24..T-26, T-34, T-35, T-37, T-38.
- B (after api.md and agent-protocol.md): T-06..T-08, T-13..T-15, T-18..T-21, T-23, T-27..T-33, T-36.
- C: T-39..T-46.

## Critical path to the golden path
T-05 -> T-06 -> T-07 -> T-08 -> T-15 -> T-20 -> T-23 -> T-39 -> T-41. In parallel and nearly as long: T-02 -> T-13 -> (funded triggers agent) and T-01 -> T-27 -> T-30 -> T-31 -> T-32 -> T-39. Forge install (T-05) is the single earliest unknown.

## Risks
| Risk | Owner |
|---|---|
| forge not installed or tests fail, delaying delegate/ABIs | contracts-engineer |
| Factory-creates-contract or weibar/tinybar unit surprise on Hashio | integration-researcher |
| NVIDIA JSON mode / chat_template_kwargs unsupported, breaks benchmark and verify | integration-researcher, then backend-engineer |
| 0G key unfunded; fallback is Postgres-only reports | human |
| Demo agents fail benchmark >= 80 or repos not public | demo-agents-engineer, human |
| Single relayer nonce stream collisions among agents on testnet | integration-lead (lock) |
| Indexer lag makes funding look stuck | backend-engineer |
| GitHub rate limit during benchmark | backend-engineer (token + tarball fallback exist) |
| Late frontend integration | frontend-engineer |
| Charter says `chain_outbox` exists but it does not | architect (ADR T-35), human |

## Open questions
1. chain_outbox: build it or accept the "no queue" deviation? (T-35, human decides; no task builds it without an accepted ADR.)
2. Submitted-state timeout: contract change or off-chain policy? (T-34 decides T-36.)
3. Who funds the 0G key and when? (T-22)
4. Which GitHub account/org publishes the demo agent repos? (T-21)
5. Does the existing `/agreements/:id/escrow` route plus accept already create the escrow, making it redundant? backend-engineer to confirm in api.md.
6. CLAUDE.md names docs/build_plan.md and SPEC files that do not exist; this board uses the v2 docs per the request. integration-lead to reconcile.
7. build_steps expects the dev mark-funded endpoint; I found none in routes. T-16 just asserts it is absent.
