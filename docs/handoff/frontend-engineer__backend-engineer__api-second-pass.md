status: open
priority: normal
what: Second backend pass. All changes are additive except the ones marked CHANGED. Full detail in docs/contracts/api.md.
NEW FIELDS
- GET /agents, /agents/mine, agent in /agents/:id: `latestScore` (numeric string or null).
- GET /requests/:id: each quote has `agentName`, `latestScore`.
- GET /agreements/:id/a2a: each call has `callerName`, `calleeName`, `txHash` (null until paid).
- GET /agreements/:id: `timestamps { fundedAt, submittedAt, settledAt }`, `a2aMaxPercent`, `viewerAccess` ("full" | "public").
- GET /config (public): `{ a2aMaxPercent, minDeadlineMinutes: 15, defaultDeadlineDays: 7, benchmarkPassScore, chainId }`.
- GET /requests?mine=true with the Bearer token returns only your requests.
- `items` in benchmark and verification are `{ name, passed, detail }` (documented).
NEW ROUTES
- GET /agreements/:id/audit (public): signature audit entries, verdict {result, nonce, signature, settleTxHash}, settleTxHash, reportRoot, deliverableHash. Good for a "proof" panel.
- POST /agreements/:id/refund-timeout (Bearer, client or agent owner): V2 escrows only. 409 + `remainingSeconds` when too early (show a countdown), 501 for a V1 escrow, 200 { txHash } when sent. Not testable until V2 is deployed.
CHANGED (please handle in the UI)
1. Submission content and raw errors are hidden unless you are the client, the agent's owner or the agent. Send the Bearer token on GET /agreements/:id, /verification and /a2a. When `viewerAccess` is "public", `submission.content` is absent (`submission.redacted === true`), `verification.error` is "redacted", and item `detail` is "". Show "visible to the client and the agent only".
2. POST /requests: `deadlineAt` must be >= 15 minutes ahead (400 otherwise); omitted means 7 days and is now stored. A date picker should enforce the minimum.
3. POST /quotes/:id/accept: a second concurrent accept returns 409 "Already decided".
4. POST /agreements/:id/settle may return `{ already: true, inProgress: true, txHash }` while another settle runs: show "settling", keep polling.
5. POST /agents: endpointUrl and repoUrl must be http(s); zero payout address is refused (400).
6. A2A is allowed only while status is `funded`.
7. A stuck `verifying` agreement returns to `submitted` after 10 minutes with an ERROR verification row; the existing retry button then works.
evidence: backend/src/pass2.int.test.ts (tests named S-14, S-15, S-09, S-21, S-06, signature audit, UI field additions, refund-timeout)
acceptance: screens use the new fields; fallbacks removed.
response:
