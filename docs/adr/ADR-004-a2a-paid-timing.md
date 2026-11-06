# ADR-004: A2A paid timing
**Status:** Proposed   **Date:** 2026-11-06   **Deciders:** human (needs sign-off)

## Context
`/a2a/call` currently marks the call `paid` as soon as `delegateOnChain` returns (`backend/src/routes/a2a.ts`), then calls the callee. Rule 2 says money states change only after the on-chain event is indexed; the indexer is still not handling `Delegated` events (charter gap). The callee runs for up to 90 s, so waiting is affordable.

## Decision (the recommendation)
Receipt-confirmed for the demo, indexed `Delegated` as the source of truth for the DB. Concretely: `/a2a/call` waits for the transaction receipt with `status == success` (not merely a hash) before calling the callee; the call row stays `paid-pending` semantically via the existing `paid` value and the `payments` row is inserted `confirmed` only from the indexer's `Delegated` event (the inline `payments` insert is removed or inserted as `pending`). Calling the callee must not wait for the indexer (poll lag would add 10-30 s to the demo).

## Options considered
| Option | Complexity | Time | Risk to golden path | Demo impact |
|---|---|---|---|---|
| A. Keep: hash returned = paid | None | 0 | Low but a reverted tx could still trigger the callee unpaid (violates rule 4) | Looks fine until it fails |
| B. Receipt success, then call; indexer finalises `payments` | Low-medium | 1-2 h with the indexer | Low | Fast |
| C. Wait for indexed `Delegated` before calling | Medium | 2 h | Medium (poll lag, mirror delays) | Slow, long pause on stage |
Pros B: never calls the callee without a successful tx, no demo lag.

## Consequences
Easier: no free work for a reverted delegation. Harder: two states to reconcile (`a2a_calls.paid` vs `payments`). Revisit when: the callee does expensive irreversible work, then use C.

## Action items
- backend-engineer: await receipt with success check in `delegateOnChain`; decode `Delegated` in `chain/indexer.ts`; write `payments` rows from the indexer; make the budget check also count in-flight calls (serialise per agreement) to close the 30% race.
- demo-agents-engineer: none (agents see only `/a2a`).
- qa-engineer: add a test for a reverted delegation (callee must not be called).

## Unverified assumptions
- `waitForTransactionReceipt` against Hashio returns reliably within ~10 s [VERIFY: run one delegation on testnet and time it].
- Hashio may return a receipt for a reverted contract call as `status: reverted` and not throw [VERIFY on testnet].
