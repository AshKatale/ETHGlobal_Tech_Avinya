status: open
priority: normal
what: V2 factory is deployed (address in contracts/deployments.json key hederaTestnetV2; do not use until integration-lead switches the backend). Real-chain regression cases worth running on V2 (use a small price and, for the timeout, a factory with a short window: owner may call `setReviewWindow(60)` on a test factory only if integration-lead agrees; the production default is 72 h so the timeout path cannot be waited out on the live factory):
1. delegate over the cap reverts `CapExceeded` (30% of price + 1 tinybar), and exactly 30% succeeds; second delegation counts cumulatively.
2. delegate after `submit` reverts `WrongState`.
3. refundIfNoVerdict before the window reverts `TooEarly`; after the window refunds the remainder (price minus delegated) to the client and emits `Refunded` (needs reviewWindow set to 60 s via `setReviewWindow` on a separate test factory deployment, or wait 72 h).
4. createEscrow with price 0 reverts `ZeroPrice`; deadline under now+900 s reverts `DeadlineTooSoon`.
5. Normal happy path and FAIL refund still work with the unchanged signing code (regression).
evidence: contracts/test/JobEscrowV2.t.sol (41 tests) covers all of these locally.
acceptance: results in docs/qa/.
response:
