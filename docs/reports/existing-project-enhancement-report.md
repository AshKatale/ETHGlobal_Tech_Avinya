# AgentForge: existing-project enhancement report

Status: **assessment and roadmap only. Nothing in this report has been implemented. Awaiting scope approval.**
Method: the `existing-project-enhancement` workflow (baseline, evidence-based assessment, prioritised roadmap, approval gate, then implement and verify).

## 1. Baseline

| Item | Value |
|---|---|
| Revision | `edea846` on `feat/project-builder` |
| Uncommitted | Team charter, 13 agent definitions (+ `.agents/` mirror), `.gitignore` change. All Wave A agent work is committed. |
| Size | backend about 3.1k lines of TypeScript, frontend about 2.0k, demo-agents about 0.7k, 2 Solidity contracts |
| `tsc --noEmit` (backend) | clean (ran by me) |
| Backend unit tests | 63 pass (ran by me, integration file excluded). The backend agent reports 77 including 14 integration tests that write to the shared database; I did not re-run those. |
| `forge test` | 13/13 pass (ran by me) |
| Frontend `build`, `lint`, 8 unit tests | pass, **agent-reported, not re-run by me** |
| Demo agents typecheck, stub-backend run | pass, **agent-reported, not re-run by me** |
| QA run (real chain, e2e) | in progress at the time of writing; no result yet |
| **Not measured** | performance and latency, accessibility ratios (hand-computed only), any browser click-test of wallet sign-in or `fund()`, any real end-to-end run after the Wave A changes |

## 2. Is "no ideation, no standards, no design, no plan" true?
Partly fixed already, partly still open.
- **Design:** exists now (`docs/design/`: system, five screens, build order).
- **Plan:** exists (`tasks/todo.md` has 46 tasks with owners and waves; charter section 10).
- **Standards:** a team charter, five proposed ADRs and a security register exist. **Missing:** one root quality gate that runs every check, a written dev-standards document, CI, and per-folder `.env.example` for frontend and demo-agents.
- **Ideation:** the product description is a feature list, not a pitch. There is no stated "why this wins", no three-moment demo story, and no README.

## 3. Findings that matter for winning

| # | Finding | Evidence | Impact | Severity / confidence |
|---|---|---|---|---|
| F1 | The headline trust claims rest on one backend key and a backend-only 30% cap | S-03, S-16, ADR-003 | A judge's first question; the demo's weakest point | High / High |
| F2 | An escrow stuck in `Submitted` can never be refunded | `JobEscrow.sol`, ADR-002, P1 | Funds lock if the verifier never signs | High / High |
| F3 | The golden path has never run end to end with the Wave A code and real agents | demo repos unpublished, QA pending | Biggest demo risk | High / High |
| F4 | No browser click-test of wallet sign-in or `fund()` | frontend report | The money step of the demo is unproven | High / High |
| F5 | A client can set a deadline in the past and refund right after funding | S-15 | Abuse of the escrow in a live demo | Medium / High |
| F6 | Unauthenticated reads expose submissions and the verdict signature | S-09 | Data exposure | Medium / High |
| F7 | A double accept creates two agreements for one request | S-14 | Broken state in a demo | Medium / High |
| F8 | A crash during verification leaves a job in `verifying` forever | S-21 | Demo stall | Medium / Medium |
| F9 | The shared Neon schema has columns this code does not define and old duplicate rows | backend report | Another codebase uses this database; a `db:push` could destroy data | Medium / High |
| F10 | 0G Storage does nothing today (key empty), so a sponsor integration is hollow | `.env`, researcher | Sponsor fit | Medium / High |
| F11 | No single quality gate, no README, no demo runbook | repo root | Reliability of the final hours and of the submission | Medium / High |

## 4. Roadmap

### Immediate blockers (cannot demo without these)
1. **You:** publish `demo-agents/solidity-builder` and `demo-agents/static-auditor` as public repos. (F3)
2. **You:** fund `BACKEND_0G_PRIVATE_KEY`; set `ALLOW_LOCAL_AGENTS=true` for the local run; copy `NVIDIA_API_KEY` into `demo-agents/.env`. (F3, F10)
3. Real PASS and FAIL runs with transaction hashes (QA, in progress). (F3)
4. A real browser click-test of sign-in and `fund()`. (F4)
5. Decide who owns the foreign Neon columns before anyone runs `db:push`. (F9)

### High-value improvements
| ID | Change | Benefit | Cost / risk | Acceptance |
|---|---|---|---|---|
| H1 | **Contract v2, deployed side by side:** on-chain 30% delegate cap, `refundIfNoVerdict()` after a review window, zero-address and `price > 0` checks. New factory address; the old one keeps working. | Turns the two weakest points into the pitch ("the cap is enforced by the contract, not by trust") | 2 to 5 hours; a new address to wire; fallback is to keep the old factory | forge tests for cap and timeout; a real over-cap `delegate` reverts on-chain; mirror-node evidence |
| H2 | **Public audit trail:** show the verifier signature, report hash, verdict nonce and tx hashes on the job page; add the signature audit log from ADR-003 | Cheap, and judges can verify claims themselves | Low | job page shows each artifact with a working link |
| H3 | **One-command demo:** `npm run demo` seeds, starts the agents and runs a scripted job, plus a recorded real run as backup | Removes live-demo flakiness | Low | script run twice in a row ends in the right states |
| H4 | **Narrative:** one-sentence pitch; three wow moments (agent hires agent; blocked over-budget payment; refund on bad work); README; judge Q&A | Judges score the story | Low | `README.md`, `docs/demo-script.md` |
| H5 | **Backend hardening pass:** S-09, S-14, S-15, S-21 (and S-06) | Removes demo-breaking edge cases | Low to medium | tests for each |
| H6 | **Verifiable verdicts through 0G Compute** (`verify_tee`), stored beside the NVIDIA result, shown as a badge. Optional second judge. | Strong sponsor fit and a real answer to "why trust an AI judge" | Needs a funded 0G account and an API key; the repo's own 0G skill marks the product mapping `[VERIFY]`; one more dependency | a verification stores a trace id and renders the badge; falls back cleanly when 0G is down |

### Safe low-risk cleanups
- Root `scripts/check.sh` as the single quality gate (typecheck, unit tests, forge, frontend build and lint).
- One dev-standards document; `.env.example` for `frontend/` and `demo-agents/`.
- Commit the team files; amend `CLAUDE.md` rule 3 and the stack line per ADR-001 and ADR-005 (needs your approval).

### Larger refactors needing their own plan
`chain_outbox`; a multi-signature verifier; agent reputation; the x402 rail; GitHub OAuth for private repos; per-callee callback secrets (S-23).

### Not recommended
Moving to pnpm and Turborepo (high risk, no judge value tonight); a Hedera Consensus Service audit topic (needs a native account id, more moving parts than it is worth); a third demo agent; any rewrite; redeploying "in place" (not possible, a new address is the only route).

## 5. Verification plan (applies after approval)
Re-run the baseline commands; the root gate; the QA e2e set against the new code; compare counts before and after. Each check is marked PASS, FAIL, BLOCKED or NOT RUN. High-risk changes (H1, H6) get an independent review by `security-reviewer`.

## 6. Rollback notes
H1 is additive: the old factory address stays in `.env`/`deployments.json`, so switching back is one environment variable. No existing table or column is dropped by anything in this roadmap.

## 7. Open items
All sections after this point (changes made, before and after results, exact test output) are **empty until a scope is approved and executed**.
