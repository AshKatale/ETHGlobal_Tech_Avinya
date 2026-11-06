# ADR-006: Contracts V2 (JobEscrowV2 / AgreementFactoryV2)
**Status:** Accepted   **Date:** 2026-11-06   **Deciders:** human
Accepted by the human on 2026-11-06. Supersedes ADR-002.

## Context
- S-16: no exit from `Submitted`. If the verifier is down or `release` keeps reverting, funds are locked forever (ADR-002 documented the risk and recommended no redeploy).
- S-03: `delegate` has no cap on chain and is allowed in `Submitted`; the 30% rule exists only in the backend, so a backend bug or leaked verifier/relayer pair can drain the escrow, or an agent about to FAIL can delegate the balance to a colluding sub-agent.
- S-15: the client chooses the deadline with no minimum, so it can fund and refund via `refundAfterDeadline` almost immediately.
- Contracts proposals P1 (timeout) and P5 (on-chain cap) in `contracts/PROPOSALS.md`. Forge baseline: 13 tests passed on V1. Deadline 09:00 IST Sat 7 Nov 2026.
The human decided to build V2 and deploy it beside V1.

## Decision
New files `JobEscrowV2.sol` and `AgreementFactoryV2.sol`; V1 files and the deployed V1 factory are untouched.
| Parameter | Value |
|---|---|
| `maxDelegatedBps` | default 3000; set by the factory owner; applies to FUTURE escrows only (copied into the escrow at creation); setter reverts above 10000 |
| `reviewWindow` | default 72 h; factory-settable for future escrows; bounded 1 minute to 30 days |
| `minDeadline` | default 900 s; `createEscrow` reverts if `deadline < block.timestamp + minDeadline` |
| Delegation cap check | `(delegated + amount) * 10000 <= price * maxDelegatedBps`, else revert |
| `delegate` allowed state | `Funded` only |
| `refundIfNoVerdict()` | anyone; requires state `Submitted` and `block.timestamp > submittedAt + reviewWindow`; refunds the remainder to the client |
| Creation checks | `verifier != address(0)` (also in factory constructor and `setVerifier`), `price > 0` |
| Interface | Unchanged function signatures, events and EIP-712 typed data (domain name/version, type hashes), so the backend needs no signing change. New items are additive (`refundIfNoVerdict`, `submittedAt`, `reviewWindow`, `maxDelegatedBps`, setters, new errors). [VERIFY: contracts-engineer confirms the domain name/version strings and type hashes are byte-identical to V1 and that V2 ABI is a superset]. |
The client-favouring trade-off of P1 (an agent loses if the platform is down longer than the window) is accepted; the window is long on purpose.

## Rollout and rollback
- Side by side: deploy V2 factory, record in `contracts/deployments.json` (contracts-engineer), export ABIs to `contracts/abi/`. Backend selects the factory via `FACTORY_ADDRESS` (integration-lead/human sets it; no key is printed).
- New escrows use whichever factory is configured. Escrows already created keep working on their own contract; the indexer follows per-escrow addresses and cursors, so no cursor reset is needed. [VERIFY: indexer only needs the escrow address, not the factory]
- Rollback: set `FACTORY_ADDRESS` back to the V1 factory and restart. V1 stays deployed and is the fallback; V2 escrows already open continue to settle normally.
- Before switching the demo: forge tests green, one full golden path (create, fund, submit, release) and one delegation over the cap (expect revert) on testnet. Hedera `block.timestamp` accuracy for hour-scale windows [VERIFY].

## Options considered
| Option | Complexity | Time | Risk to golden path | Demo impact |
|---|---|---|---|---|
| A. Stay on V1 (old ADR-002) | None | 0 | None | Funds can lock; no on-chain cap |
| B. V2 side by side, V1 fallback (chosen) | Medium | 3-5 h incl. tests | Low-medium, bounded by one-line rollback | Strong trust story |
| C. Replace V1 in place | Medium | same | High, no fallback | Same |

## Consequences
Easier: trustless exit from `Submitted`, on-chain 30% cap, no instant-deadline abuse, zero-verifier/zero-price footguns closed. Harder: two factories and ABIs to maintain; tests must cover both until V1 is retired; the backend and UI must tolerate escrows from either version. Revisit when: after the hackathon (retire V1) or on mainnet.

## Out of scope
- P3 separate nonce sets (use disjoint nonce ranges if needed); P2 operator submit (kept as agent or operator, fix the doc); verifier rotation or multi-sig (ADR-003); recovery of verifier for existing escrows; payout address validation (S-20).

## Action items
- contracts-engineer: implement V2 and forge tests (cap boundary, over cap, delegate in Submitted reverts, refundIfNoVerdict before/after window and wrong state, min deadline, zero verifier, zero price, parameter bounds); export ABIs; deploy only on human approval.
- backend-engineer: read `FACTORY_ADDRESS`; ABI superset check; map new custom errors to readable messages; enforce min deadline in routes too (S-15).
- docs-writer: describe the V2 timeout and cap honestly, "platform-verified, not trustless".
- integration-lead: set `FACTORY_ADDRESS`; keep rollback instruction in the runbook.

## Unverified assumptions
- Everything tagged [VERIFY] above; none has run on testnet.
