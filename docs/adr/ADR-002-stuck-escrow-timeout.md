# ADR-002: Escrow stuck in Submitted
**Status:** Proposed   **Date:** 2026-11-06   **Deciders:** human (needs sign-off)

## Context
In the deployed `JobEscrow`, `refundAfterDeadline()` requires state `Funded`. Once the agent calls `submit`, state is `Submitted` and only a verifier-signed `release` or `refund` can move funds. If the verifier key is unavailable, the backend is down, or verification keeps erroring (infra errors never FAIL, rule 5), the client's money is locked forever. Deployed factory: `contracts/deployments.json` (chain 296). Redeploying means a new factory and re-wiring the backend.

## Decision (the recommendation)
For the demo: do not redeploy. Mitigate operationally: the backend always has a manual `verify` retry and the verifier key is held by the operator; document the risk in the submission as a known limitation. Post-hackathon (v2 contract): add `refundAfterReviewTimeout()` allowing anyone to refund the client when `state == Submitted && block.timestamp > submittedAt + REVIEW_WINDOW` (suggest 72 h; with an agent-protecting variant: if the agent also holds a verifier PASS it wins). If the contracts-engineer already has a redeploy planned for another reason, fold this in.

## Options considered
| Option | Complexity | Time | Risk to golden path | Demo impact |
|---|---|---|---|---|
| A. Leave as is, document | None | 0 | None | A judge may ask; answer is prepared |
| B. Fix contract, redeploy factory, rewire backend, rerun tests | Medium | 3-5 h incl. forge tests (forge not yet run in this repo) | Medium; address changes, indexer cursors reset | None visible |
| C. Add a backend-only timeout that auto-signs a refund | Low | 1 h | Low, but it is the same trusted key | Weak: not trustless |
Pros B: trustless exit. Cons B: late change to money code with untested toolchain.

## Consequences
Easier: demo is stable. Harder: the trust story depends on the verifier for the funds-in-review window. Revisit when: right after the hackathon, or if contracts-engineer finishes forge tests early with spare time (then take B, timeout of minutes for the demo is not needed).

## Action items
- contracts-engineer: write the proposal and tests for `refundAfterReviewTimeout` in `contracts/PROPOSALS.md`; do not deploy without human approval.
- docs-writer: list the limitation honestly in `docs/submission.md`.
- backend-engineer: ensure a visible retry for ERROR verification (already exists at `/agreements/:id/verify`).

## Unverified assumptions
- Behaviour of `block.timestamp` on Hedera relative to consensus time is close enough for hour-scale windows [VERIFY: docs search plus one testnet read].
