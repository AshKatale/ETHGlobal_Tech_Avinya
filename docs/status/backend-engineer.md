updated: 2026-11-06 22:10 IST
state: done (second pass)
done:
- baseline before pass 2: tsc clean, vitest 77/77 (8 files). After: tsc clean, vitest 102/102 (13 files).
- 1 S-14 atomic accept; proof: pass2.int.test.ts 10 concurrent accepts -> one 201, nine 409, one agreement, one create-escrow call (chain stubbed)
- 2 S-15 deadlines: 15 min minimum (400), 7 day default stored, accept re-checks; proof: lib/deadline.test.ts, int test
- 3 S-09 redaction with optionalAuth; lib/access.ts; proof: unit tests and int test (anonymous, stranger, garbage token, other agent's key get no content; client, owner, agent key do)
- 4 S-21 recovery sweep (lib/recovery.ts, runs in indexOnce); atomic verification claim; proof: int test (stuck, fresh, settling, legacy rows; idempotent; no FAIL)
- 5 S-06 single-flight settle via transaction advisory lock (lib/singleFlight.ts; session locks do not work on the Neon pooler, first attempt sent 8 txs); proof: 8 concurrent settles -> 1 release
- 6 A2A only when funded; proof: unit and int tests
- 7 signature_audit table, written inside signVerdict/signDelegation before the signature is returned, GET /agreements/:id/audit; proof: int test with the real verifier key (local signing, no tx). QA's live delegations already wrote 2 rows.
- 8 UI fields: latestScore, quote agentName/latestScore, a2a callerName/calleeName/txHash, timestamps, a2aMaxPercent, GET /config, requests?mine=true
- 9 refund-timeout route + V2 ABI entries; proof: unit eligibility tests and stubbed-chain route test
- 10 S-17 (self-hire by id always; same owner/payout only with A2A_BLOCK_SAME_OWNER=true, default off because both demo agents share one lister wallet and the demo would break), S-19 atomic nonce claim + expired nonce purge (login message format unchanged), S-20 http(s) URLs and no zero payout
migrations: drizzle/0002_freezing_gertrude_yorkes.sql (signature_audit + agreements.verifying_since + index), applied by hand with IF NOT EXISTS via scripts/apply-sql.ts. db:push not used. FACTORY_ADDRESS and .env untouched.
notes:
- DB pool max raised 5 -> 10 (single-flight holds a connection per in-flight settle).
- S-19 login message domain/expiry text NOT changed (would break the frontend signing flow); S-20 contract-address check on payout NOT done; S-22 and S-23 untouched.
- GET /agreements/:id/a2a txHash is matched by amount in order (payments have no call id).
NOT VERIFIED: refund-timeout on a real V2 escrow (V2 not deployed; deployments.json has no hederaTestnetV2); readRefundTimeoutInfo V1 detection (ZeroData/Reverted error names) against a real V1 escrow; stuck-verifying sweep with a real 10 minute wait (tested with backdated rows); advisory lock across two backend processes.
needs from others: frontend reads docs/handoff/frontend-engineer__backend-engineer__api-second-pass.md; qa reads qa-engineer__backend-engineer__second-pass-regression.md
next: integration-lead decides on A2A_BLOCK_SAME_OWNER and the V2 FACTORY_ADDRESS switch
