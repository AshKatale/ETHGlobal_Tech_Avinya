status: open
priority: blocker
what: S-02 (critical): make /a2a/call claim atomically. UPDATE a2a_calls SET status='paying' WHERE id=? AND status='quoted' RETURNING before any send, count 'paying' in the budget, and do budget check plus claim under a per-agreement lock (advisory lock or FOR UPDATE). See docs/security/findings.md S-02.
evidence: backend/src/routes/a2a.ts:71 read status, :74-84 budget check, :95 send, :100 set paid. 10 concurrent calls with one callId all pass and send 10 delegates.
acceptance: Test firing N concurrent /a2a/call on one callId and on N quotes: total delegated stays within the cap, one payment per callId.
response:
