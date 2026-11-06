# AgentForge: Solo Build Plan (Hackathon MVP)

**Source of truth:** `docs/agentforge_mvp_PRD.md`. This file only sequences the work. Where the two disagree, the PRD wins unless listed under "Deviations".
**Deadline:** Sat 7 Nov 2026, 09:00 IST. **Team:** 1 person. **Datastore:** PostgreSQL 16 (Drizzle).
**Rule:** one working end-to-end job beats many half-built features. Never cut the golden path.

## Golden path (never cut)
Sign in → request → quote → sign terms → fund `EscrowVault` (Hedera USDC) → agent submits → 0G-generated tests run → two verifier signatures → verdict recorded on 0G → vault releases USDC → HashScan and chainscan links on screen.

## Solo adjustments to the PRD (deviations)
| PRD says | Solo plan | Why |
|---|---|---|
| Postgres + Redis + BullMQ | Postgres only. `chain_outbox` and verification jobs are polled from Postgres (`FOR UPDATE SKIP LOCKED`) | One less service to run and debug |
| Separate services (verifier, relayer, indexer, sandbox-runner) | Verifier A/B and relayer are separate processes (PRD requires it). Indexer and sandbox launcher live inside `apps/api` | Two keys must stay separate; everything else can merge |
| Three demo agents | Two: `solidity-builder` and `static-auditor`. `research-agent` only if time remains | Time |
| Benchmark gate (FR-009) | One pre-registered agent with a stored report, labelled on screen | PRD already allows this |
| Next.js app and Fastify API | Keep both, but the web UI is minimal: 4 pages | Time |

## Phase 0: De-risking spike (T+0 to T+2h). Write results to `docs/spike-results.md`
Run in this order. Each has a pass test and a fallback; decide fallbacks at T+2h.

| # | Spike | Pass | Fallback |
|---|---|---|---|
| S1 | Create an ECDSA-aliased Hedera account, associate USDC `0.0.429274`, get testnet USDC (find Circle faucet), complete the hollow account with a first signed tx | Mirror node `/accounts/{id}/tokens?token.id=0.0.429274` shows a balance; account signs an EVM tx | Self-minted HTS token labelled "mUSDC" |
| S2 | Throwaway contract on Hashio: `associateToken` (0x167) from constructor and from a function; ERC-20 facade `transferFrom` / `approve` success and failure behaviour | Contract holds USDC; a forced failure is visible as a revert or return value | Separate `initAssociate()` call; `require` on every return value |
| S3 | One paid x402 call with `@x402/core` + `@x402/hedera` against one facilitator (x402.org, then launa, then blocky402) | 402 → signed retry → 200, settlement tx on HashScan; record the real header names and settlement key | Mirror-verified "pay then call", labelled x402-style |
| S4 | 0G Storage upload and download with `@0gfoundation/0g-storage-ts-sdk` | Root hash round-trips | Local file + sha256, hash posted to HCS |
| S5 | 0G Compute Router call (`https://router-api.0g.ai/v1`, `X-0G-Provider-Trust-Mode: verified`, `verify_tee: true`) | 200 plus `x_0g_trace.request_id` | Labelled stand-in model; show request ID honestly |
| S6 | Deploy a trivial contract to 0G Galileo with `evm_version="cancun"`; claim faucet 0G early | Chainscan link exists | None needed (blocker if it fails) |

Claim 0G faucet tokens immediately (0.1 per wallet per day) and again each day.

## Phase 1: Foundations (T+2h to T+4h)
- pnpm + Turborepo monorepo from the PRD file structure, trimmed to what is used.
- `docker-compose.yml` for Postgres; Drizzle schema (slim subset from the PRD) and migrations.
- `packages/shared` (Zod, money utils in `bigint`), `packages/eip712`, `packages/hedera`, `packages/zerog`.
- `.env.example`, `gitleaks` pre-commit, GitHub Actions for lint, typecheck, test.
- **Commit hourly from here.**

## Phase 2: Contracts (T+4h to T+9h)
1. `EscrowVault` (Hedera): `fund`, `recordVerdict` (two signatures, replay-proof), `approveEarly`, `release`, `refund`, `claim`, `pause` (blocks only `fund`). Foundry tests for every revert path plus the balance invariant.
2. Deploy to Hedera testnet; confirm USDC association; run fund → verdict → release with test signatures.
3. `AgreementRegistry` on 0G (agreement, submission, verdict, settlement records; same two-signature check, chain ID 16602). `AgentRegistry` only if time remains.
- Done when: release lands USDC in a payout account on testnet and the 0G verdict record shows on chainscan.

## Phase 3: Backend core (T+9h to T+14h)
1. Wallet sign-in (nonce, mirror-node key check), agents registry (seed + one real), request, matching, price engine (integers), quote, EIP-712 terms, funding intent. Object-level auth tests.
2. `chain_outbox` worker (relayer), mirror-node indexer that moves state to `funded` / `released` only after the event is indexed.
3. Agent SDK minimal: A2A handler, x402 paywall, paid client, spending-policy check. `static-auditor` sells a call; `solidity-builder` buys it (settled + blocked).
- Done when: client funds from a script and `solidity-builder` pays `static-auditor` with a HashScan link.

## Phase 4: Verification (T+14h to T+19h)
1. Submission freeze (commit SHA, manifest hash).
2. 0G inference for test generation; schema-validate; hash suite before running; discard empty-baseline passes.
3. Docker runner: `forge test`, `slither`, `gitleaks`; `--network none`, read-only, non-root.
4. Score, evidence pack to 0G Storage, Verifier A and B (two processes, two keys, two EIP-712 domains), relayer posts to 0G and Hedera.
- Done when: a verdict with two signatures releases USDC automatically.

## Phase 5: UI (T+19h to T+23h)
Four pages only: Marketplace, New Request and Quote, Fund, Agreement and Verification (timeline, A2A spend list, score sheet, verdict panel with links). Seeded data badged. "Automated verification is not a professional audit" shown.

## Phase 6: Submission (T+23h to deadline minus 1h)
README (setup, architecture diagram, payment flow, real-vs-stubbed table, deployed addresses, settled Hedera tx IDs), `docs/ai-usage/`, a ≤5 min video following the PRD demo script, links checked in a private window, repo public with no `.env` and no leftover `client/` or `server/`.

## Checkpoints and cut order
Set T0 to the actual start. Convert to IST and adjust.

| Checkpoint | Must be true | If behind, cut |
|---|---|---|
| T+2h | Spikes decided | Take fallbacks |
| T+9h | Vault live on testnet | `AgentRegistry`, HCS audit |
| T+14h | Client funds; A2A payment settled | Spending-policy UI, third agent |
| T+19h | Verification releases USDC | Slither (keep Foundry + gitleaks), benchmark, leaderboard live data (use seeded) |
| T+22h | **Feature freeze** | Anything unfinished is labelled "not shown live" |
| Deadline − 2h | Final recording done | Use earlier recorded run |
| Deadline − 1h | Submit | n/a |

Cut order: HCS audit, benchmark, leaderboard, `AgentRegistry`, third agent, spending-policy UI, slither.
**Keep:** escrow, two-verifier verdict, 0G inference with request IDs, 0G record, one settled x402 payment plus one blocked.

## Sleep and risk
- Take one 90-minute sleep block after Phase 3. Solo fatigue is the largest risk.
- Biggest technical risks: S1/S2 (USDC and HTS behaviour), x402 header ambiguity, 0G faucet limits, Hashio rate limits (poll the mirror node instead).
- Keep a recorded full run as a demo fallback once the golden path works.

## PRD corrections to write back
1. 0G Storage package is `@0gfoundation/0g-storage-ts-sdk`.
2. 0G inference evidence is `x_0g_trace.request_id` plus `ZG-Res-Key`; no signed receipt object is documented. "Private Computer" = Compute Router is unconfirmed.
3. x402 header and settlement key names are unconfirmed (`X-Payment` vs `PAYMENT-SIGNATURE`; `transaction` vs `transactionId`). Record what S3 shows.
4. Testnet USDC `0.0.429274` is confirmed on Circle's page; how to obtain it is not.
5. Accounts need an ECDSA alias; faucet accounts are hollow until a first signed tx.
6. Mirror-node log filters need a timestamp range of 7 days or less.
