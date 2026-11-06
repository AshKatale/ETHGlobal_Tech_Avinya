updated: 2026-11-06 21:30 IST
state: done (Wave A work order)
done:
- baseline: tsc clean, vitest 15/15 before changes
- 1 api.md published and updated to the routes (docs/contracts/api.md)
- 2 agent dispatch on Funded (lib/agentClient.ts dispatchAgreement, indexer hook + sweep, POST /agreements/:id/dispatch retry, agreements.dispatched_at/dispatch_error); proof: backend/src/backend.int.test.ts 'agent dispatch' (5 tests)
- 3 quote solicitation on POST /requests (solicitQuotes, Zod digit-string price); proof: int test 'quote solicitation'
- 4 SSRF guard lib/ssrf.ts (http/https only, resolve + connect-time pinned lookup, private/loopback/link-local refused unless ALLOW_LOCAL_AGENTS=true, no redirects, timeout, size cap); proof: lib/ssrf.test.ts 33 tests
- 5 submit requires exactly funded, atomic claim, latest submission everywhere (lib/submissions.ts); proof: int tests
- 6 A2A race: lib/a2aReserve.ts advisory lock; proof: 2 racing calls pay 1, 6 parallel pay 3, 10 on one callId pay once
- 7 settle auth (client or agent owner); proof: int test stranger 403 / client 502 / owner 502 / anon 401 (502 = reached chain code, no escrow)
- 8 Delegated indexing (applyDelegated, unique index payments_a2a_tx); proof: int test
- 9 env: GITHUB_TOKEN (already), ALLOW_LOCAL_AGENTS, AGENT_CALLBACK_SECRET in env.ts and .env.example; migration drizzle/0001_empty_patriot.sql
- 10 seed: npm run seed; ran twice, second run created 0
- 11 cleanup: void sql, void http, Phase 3 comment removed; tsc --noUnusedLocals clean
- blocker handoffs S-01, S-02, S-04, S-05 addressed (see handoff responses)
in progress: none
blocked on: nothing
needs from others: frontend/demo-agents/qa read docs/handoff/*__backend-engineer__api-wave-a-changes.md
notes:
- DB: db:push was NOT used. The shared Neon schema has extra columns not in schema.ts (agreements.task_account_id, task_dispatch_status, task_dispatch_error, task_dispatched_at; payments.payer_account_id) from another branch; drizzle push wanted to drop/rename them. I applied the generated migration SQL by hand (ALTER ... IF NOT EXISTS). Decide who owns those columns.
- payments has pre-existing duplicate (tx_hash, release) rows, so the unique index is partial (kind = 'a2a' only).
- Demo agents on localhost need ALLOW_LOCAL_AGENTS=true in the backend environment (off in backend/.env).
- No real chain transaction was sent; .locks/chain not taken. 0G upload not attempted.
NOT VERIFIED: dispatch/quote against a live demo agent; /a2a/call end to end (needs chain); Delegated from a real mirror-node event; ADR-001/003/004 and S-18/S-23 not done.
next: qa golden-path run
