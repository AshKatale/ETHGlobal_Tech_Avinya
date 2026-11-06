# ADR-001: Chain writes: direct sends or chain_outbox
**Status:** Proposed   **Date:** 2026-11-06   **Deciders:** human (needs sign-off)

## Context
CLAUDE.md rule 3 says all chain writes go through `chain_outbox`; the architecture doc says "no queue"; the code sends directly from `backend/src/chain/` (createEscrow, submit, release, refund, delegate). Deadline is 09:00 IST Sat 7 Nov, so a queue must pay for itself in the demo.

## Decision (the recommendation)
Keep direct sends for the hackathon, confined to `backend/src/chain/`, plus three cheap safeguards: (1) one in-process serial lock per signer key (one nonce stream), (2) every write is idempotent by re-reading on-chain state first (`readEscrowState`), (3) a failed write leaves DB state unchanged and returns an error with a retry route. Amend CLAUDE.md rule 3 to "chain writes live only under `backend/src/chain/`" (the charter already says this). Revisit the outbox after the hackathon.

## Options considered
| Option | Complexity | Time | Risk to golden path | Demo impact |
|---|---|---|---|---|
| A. Direct sends + lock + state pre-check | Low | ~1 h | Low; a crash mid-send loses the retry, recoverable by re-reading chain state | None |
| B. `chain_outbox` table + worker | Medium (schema, worker, retry, status UI) | 6-8 h | Medium; new moving part late | "Pending" states to explain |
Pros A: already works, fewer states. Cons A: a process crash between send and DB write can leave a gap; mitigated by the indexer being the only writer of money states (rule 2). Pros B: durable, retryable. Cons B: time we do not have.

## Consequences
Easier: demo path stays simple. Harder: no automatic retry after a crash; the user presses retry. Revisit when: real money, more than one backend instance, or after the hackathon.

## Action items
- backend-engineer: add a per-key async mutex around every send in `chain/client.ts`; pre-check state before release/refund/delegate.
- human: approve amending CLAUDE.md rule 3 (integration-lead edits it).
- integration-lead: apply the CLAUDE.md wording once Accepted.

## Unverified assumptions
- Hashio nonce handling under rapid sequential sends is fine with a serial lock [VERIFY: send 5 txs in a row via the lock on testnet].
