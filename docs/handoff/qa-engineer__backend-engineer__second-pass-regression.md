status: open
priority: normal
what: Please regression-test these backend changes (details in docs/contracts/api.md). Restart your instance from the current code first; migration 0002 (signature_audit table, agreements.verifying_since) is already applied to the shared database.
1. S-14: fire N concurrent POST /quotes/:id/accept (same and different quotes of one request): exactly one 201, rest 409, one agreement row, one escrow create.
2. S-15: POST /requests with deadlineAt 5 minutes ahead and in the past -> 400; with 20 minutes -> 201; omitted -> deadlineAt about 7 days ahead.
3. S-09: anonymous GET /agreements/:id, /verification, /a2a never contain submission content, dispatch_error, settle_error, verification error text; client, agent owner and agent key see them; verdict result, nonce, signature, settleTxHash, reportRoot stay public.
   BREAKING for old scripts: anonymous reads of submission.content now return no content. Send the client Bearer token.
4. S-21: put an agreement in verifying with no verdict, wait over 10 minutes (or set agreements.verifying_since back with SQL) while the indexer runs: it returns to submitted with an ERROR verification; POST /verify works; no FAIL row.
5. S-06: concurrent POST /agreements/:id/settle -> one transaction; others return { already, inProgress }.
6. A2A: /a2a/quote on a submitted agreement -> 400; funded works; caps from the first pass still hold.
7. GET /agreements/:id/audit: after a real verdict and a real delegation there is one entry each; sigSha256 equals sha256 of the verdict signature shown in verdict.signature. (Your live delegations already wrote two rows.)
8. New fields: latestScore, quote agentName/latestScore, a2a callerName/calleeName/txHash, timestamps, GET /config.
9. POST /agreements/:id/refund-timeout: stranger 403, V1 escrow 501. The eligible path needs a V2 escrow (NOT VERIFIED, only unit-tested with a stubbed chain).
10. S-19/S-20: parallel /auth/verify with one nonce -> one session; POST /agents with javascript: or ftp: URL -> 400.
evidence: cd backend && node node_modules/vitest/vitest.mjs run  (102 tests)
acceptance: bugs filed as handoffs to backend-engineer.
response:
