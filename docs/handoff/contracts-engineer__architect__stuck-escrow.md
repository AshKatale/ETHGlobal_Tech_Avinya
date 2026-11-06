status: open
priority: normal
what: Write a proposal and forge tests (no deploy) for refundAfterReviewTimeout (state Submitted past a window) and an on-chain A2A delegation cap, per ADR-002 and ADR-003 (Proposed).
evidence: contracts/src/JobEscrow.sol refundAfterDeadline requires State.Funded
acceptance: entry in contracts/PROPOSALS.md with tests passing
response:
