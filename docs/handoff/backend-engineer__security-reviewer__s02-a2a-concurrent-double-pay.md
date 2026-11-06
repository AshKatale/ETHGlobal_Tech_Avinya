status: done
priority: blocker
what: S-02 (critical): make /a2a/call claim atomically. UPDATE a2a_calls SET status='paying' WHERE id=? AND status='quoted' RETURNING before any send, count 'paying' in the budget, and do budget check plus claim under a per-agreement lock (advisory lock or FOR UPDATE). See docs/security/findings.md S-02.
evidence: backend/src/routes/a2a.ts:71 read status, :74-84 budget check, :95 send, :100 set paid. 10 concurrent calls with one callId all pass and send 10 delegates.
acceptance: Test firing N concurrent /a2a/call on one callId and on N quotes: total delegated stays within the cap, one payment per callId.
response: reserveA2aCall (lib/a2aReserve.ts): pg_advisory_xact_lock per agreement, budget check and quoted->paid in one transaction. Tests: 2 racing calls pay 1; 6 parallel pay 3; 10 on one callId pay once (backend.int.test.ts). Status is paid, not a separate paying state.
