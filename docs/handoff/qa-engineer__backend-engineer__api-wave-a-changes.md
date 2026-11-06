status: open
priority: normal
what: docs/contracts/api.md is published and matches the routes. Wave A changes you should know about:
- New fields on Agreement: dispatchedAt, dispatchError. New route POST /agreements/:id/dispatch (retry the /tasks callback).
- POST /requests now triggers background POST {endpointUrl}/quote on listed agents (body {requirements}); quotes appear on GET /requests/:id.
- Indexer calls POST {endpointUrl}/tasks (body {agreementId, requirements}) once after the indexed Funded event; agents must dedupe on agreementId and accept an optional x-backend-key header (env AGENT_CALLBACK_SECRET, empty by default).
- POST /agreements/:id/submit now returns 409 unless status is exactly funded (a second submit is refused).
- POST /agreements/:id/settle returns 403 unless the caller is the client or the agent's owner.
- Backend refuses loopback/private agent endpoints unless started with ALLOW_LOCAL_AGENTS=true. For local demo agents on 4101/4102 the backend must run with ALLOW_LOCAL_AGENTS=true (ask me or set it in your own backend env; it is false in the default .env).
- POST /a2a/call: callee URL SSRF-checked before payment; two simultaneous calls cannot overspend the 30% cap.
- Seed data: run "npm run seed" in backend/ (3 listed sample agents, 3 sample requests, all isSeeded).
evidence: docs/contracts/api.md; backend/src/backend.int.test.ts
acceptance: your code uses the shapes in api.md; tell me about any mismatch
response:
