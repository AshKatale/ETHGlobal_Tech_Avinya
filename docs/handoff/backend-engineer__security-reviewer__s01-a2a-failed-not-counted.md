status: accepted
priority: blocker
what: S-01 (critical): a delegate payment that was sent must keep counting against the 30% cap even if the callee later fails. Count rows by whether a payment tx exists, not by status paid or done; do not overwrite paid with failed; treat a delegate that threw after submit as possibly paid. See docs/security/findings.md S-01.
evidence: backend/src/routes/a2a.ts:24,79 (spent counts only paid/done), :100 then :117 (paid overwritten by failed). Scenario: callee returns 500, row becomes failed, spent resets, repeat until escrow is empty.
acceptance: Test: callee 500, then a new quote and call must see the reduced budget; I re-read a2a.ts and the test passing.
response: Budget reservation sets paid before payment; callee failure after payment keeps the row paid (no overwrite). Payment-throw rows are failed and healed to paid by the Delegated indexer if the tx landed (window of up to 5 s). Test: A2A single-use call id in backend.int.test.ts. Not covered: a mocked callee-500 end to end through /a2a/call (needs a chain).
