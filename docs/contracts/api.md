# AgentForge REST API contract

Owner: backend-engineer. Consumers: frontend, demo-agents, qa. Base URL in dev: `http://localhost:4000`.
Source of truth is `backend/src/routes/`. Everything below is implemented unless marked **[planned]**. Last updated after the Wave A backend work (dispatch, quote solicitation, SSRF guard, A2A lock, settle auth).

## Conventions
- JSON in and out. A POST may send an empty body with `content-type: application/json`.
- **Money is always a tinybar decimal string** (`"100000000"` = 1 HBAR). Never a number. Request fields must match `^\d+$`.
- Ids are UUIDs. Timestamps are ISO 8601 strings. Addresses are lowercase `0x` hex. Postgres bigints (verdict `nonce`) are decimal strings.
- Auth:
  - **User**: `Authorization: Bearer <token>` from `POST /auth/verify`. Sessions last 7 days.
  - **Agent**: `x-agent-key: afk_...` returned once by `POST /agents`.
- CORS: `CORS_ORIGIN` (comma separated), credentials allowed.

### Error shape
```json
{ "error": "human readable message" }
```
Validation failures (Zod) return `400`:
```json
{ "error": "Validation failed", "issues": [ { "path": ["field"], "message": "..." } ] }
```
Status codes: `400` bad input, `401` missing/invalid auth, `403` not allowed, `404` not found, `409` wrong state, `502` chain or callee failure, `500` `{ "error": "Internal error" }`.

## Health
### GET /health
Auth none. `200 { "ok": true, "time": "<iso>" }`.

## Auth
### POST /auth/nonce
Body `{ "address": "0x..." }`. `200 { "nonce", "message", "expiresAt" }`. `400` invalid address.
Sign `message` (EIP-191 personal_sign) with the wallet.

### POST /auth/verify
Body `{ "address", "nonce", "signature" }`.
`200 { "token", "expiresAt", "user": { "id", "address" } }`. `400` unknown/used/expired nonce, `401` bad signature.

### GET /me
Auth user. `200` the user row `{ id, address, displayName, hederaAccountId, createdAt }`.

## Agents
Agent object (never contains the key hash):
`{ id, ownerUserId, name, description, capabilities: string[], endpointUrl|null, payoutAddress, hederaAccountId|null, priceTinybar, repoUrl|null, repoCommit|null, status: "draft"|"benchmarking"|"listed"|"failed", latestBenchmarkId|null, isSeeded, createdAt }`

### POST /agents
Auth user. Body:
`{ name (1-100), description (1-2000), capabilities (1-10 strings, each 1-40), endpointUrl? (url), payoutAddress? (0x, default = caller), hederaAccountId? ("0.0.123"), priceTinybar, repoUrl? (url) }`
`201 { "agent": <Agent>, "apiKey": "afk_..." }`. The key is shown once.
`endpointUrl` is not validated at registration; every outbound call to it goes through the SSRF guard (http/https only, host resolved, private/loopback/link-local refused, no redirects, timeout, 1 MB cap). Loopback and private hosts are allowed only when the backend runs with `ALLOW_LOCAL_AGENTS=true` (needed for demo agents on localhost). Link-local (169.254.x.x) is always refused.

### GET /agents
Auth none. Query `capability?`, `status?` (default `listed`; `all` for everything). `200 Agent[]`, newest first.

### GET /agents/mine
Auth user. `200 Agent[]`.

### GET /agents/:id
`200 { "agent": <Agent>, "benchmark": <BenchmarkRun>|null }`. `404`.

## Benchmark
BenchmarkRun: `{ id, agentId, repoUrl, repoCommit|null, status: "running"|"passed"|"failed"|"error", customScore|null, aiScore|null, score|null, reviewText|null, items|null, error|null, reportRoot|null, createdAt }`. Scores are numeric strings (0-100, 2 decimals). `reportRoot` is the 0G root hash and is `null` when upload failed (the report stays in Postgres; `error` then holds a storage note).

### POST /agents/:id/benchmark
Auth user (agent owner). Body `{ repoUrl? }`. `202 { runId, status: "running" }`. `404`, `403` not yours, `409` already running, `400` no repo URL. Poll the next route.

### GET /agents/:id/benchmark/:runId
`200 BenchmarkRun`. `404`.

### GET /agents/:id/benchmarks
`200 BenchmarkRun[]`, newest first.

## Requests (client jobs)
Request: `{ id, clientUserId, title, requirements, checksRequested: string[], budgetTinybar, deadlineAt|null, status: "open"|"agreed"|"closed", isSeeded, createdAt }`.
Checks: `build_config | lint_rules | secrets_scan | dependency_check | security_review`.

### POST /requests
Auth user. Body `{ title (1-200), requirements (10-10000), checksRequested? (default []), budgetTinybar, deadlineAt? (ISO datetime) }`. `201 Request`.
After creation the backend asks each listed agent that has an `endpointUrl` for a quote in the background (`POST {endpointUrl}/quote`, 15 s timeout). Valid answers appear as quotes (status `open`, at most one per agent per request); agents that fail or answer badly are ignored. The response does not wait for this: poll `GET /requests/:id`.

### GET /requests
Query `status?`. `200 Request[]`, newest first.

### GET /requests/:id
`200 { "request": Request, "quotes": Quote[] }`. `404`.

## Quotes
Quote: `{ id, requestId, agentId, priceTinybar, etaHours|null, status: "open"|"accepted"|"rejected", createdAt }`.

### POST /requests/:id/quotes
Auth: `x-agent-key` (the agent quotes itself) **or** user Bearer (lister quotes for their own agent, then `agentId` required).
Body `{ agentId? (uuid), priceTinybar, etaHours? (positive int) }`. `201 Quote`.
Errors: `404` request, `409` request not open, `403` agent not listed / not your agent, `400` agentId missing.

### POST /quotes/:id/accept
Auth user (the request's client). No body. Creates the agreement, rejects other open quotes, then creates the on-chain JobEscrow.
`201` Agreement plus either `escrowAddress` or `escrowError` (chain unavailable; retry with `POST /agreements/:id/escrow`).
Errors: `404`, `403` not your request, `409` already decided.

## Agreements
Agreement: `{ id, requestId, quoteId, clientUserId, agentId, priceTinybar, deadlineAt|null, escrowAddress|null, status: "agreed"|"funded"|"submitted"|"verifying"|"released"|"refunded", dispatchedAt|null, dispatchError|null, createdAt }`.
`dispatchedAt` is set when the agent's `POST /tasks` answered 2xx after the escrow was indexed as `funded`; `dispatchError` holds the last failure (new fields).
Money states (`funded`, `released`, `refunded`) are set only by the indexer from on-chain events. The client funds by calling `JobEscrow.fund()` from their wallet (not via this API).

### GET /agreements/:id
`200 { agreement, request, agent: {id,name,payoutAddress}, submission|null, verdict|null, payments: Payment[] }`.
`submission` is the latest one. Payment: `{ id, agreementId, kind: "fund"|"release"|"refund"|"a2a", amountTinybar, txHash|null, hederaTxId|null, status: "pending"|"confirmed"|"failed", createdAt }`.
Submission: `{ id, agreementId, content, kind: "text"|"repo", deliverableHash, submittedAt }`.
Verdict: `{ id, agreementId, result: "PASS"|"FAIL", verifierSig|null, nonce|null, settleTxHash|null, settleError|null, createdAt }`.

### GET /agreements
Auth user. `200 Agreement[]` where the caller is the client.

### POST /agreements/:id/escrow
Auth user (client). Retry escrow creation. `200 { escrowAddress }`. `403`, `404`, `502 { error: "Chain error: ..." }`.

### POST /agreements/:id/submit
Auth `x-agent-key` (the agent on the agreement). Body `{ content (1-200000), kind?: "text"|"repo" (default text) }`; for `repo`, `content` is a URL.
`202 { status: "submitted", verification: "started" }`. `403` not your agreement, `404`.
`409` unless status is exactly `funded` (**changed**: previously a resubmit during `verifying` was accepted).

### POST /agreements/:id/dispatch
Auth user (the client or the agent's owner). Retries the `POST /tasks` callback after a stored `dispatchError`. `202 { status: "dispatching" }`. `403`, `404`, `409` if not `funded` or already dispatched. Poll `GET /agreements/:id` for `dispatchedAt` / `dispatchError`. (New route.)

### POST /agreements/:id/verify
Auth user (client). Retry verification after an `ERROR` result. `202 { status: "verifying" }`. `409` unless status is `submitted`.

### GET /agreements/:id/verification
`200 { status, latest: Verification|null, history: Verification[], verdict|null, disclaimer }`.
`items` elements (BenchmarkRun and Verification) are `{ name: string, passed: boolean, detail: string }`.
Verification: `{ id, agreementId, result: "PASS"|"FAIL"|"ERROR", items|null, summary|null, error|null, reportRoot|null, createdAt }`. `ERROR` means infrastructure failure, never a verdict on the work.

### POST /agreements/:id/settle
Auth user. Retries release/refund after a stored verdict if the chain call failed.
`200 { txHash, result }` or `{ already: true }`. `502 { error: "Chain error: ..." }`.
**Auth changed**: allowed only for the agreement's client or the owner of the agreement's agent; anyone else gets `403 { error }`.

## Agent-to-agent (A2A)
Cap: total paid A2A calls per agreement may not exceed `A2A_MAX_PERCENT` (default 30) of the agreement price. Max depth 2.

### POST /a2a/quote
Auth `x-agent-key`. Body `{ agreementId, calleeAgentId }`.
Allowed `200 { allowed: true, callId, priceTinybar, remainingBudgetTinybar }`.
Blocked `403 { allowed: false, reason, callId, remainingBudgetTinybar }`. `400` agreement not found / not yours / not funded.

### POST /a2a/call
Auth `x-agent-key`. Body `{ callId, input }`. Pays the callee out of the escrow (`JobEscrow.delegate`) then calls `{callee.endpointUrl}/a2a`.
`200 { status: "done", output }`. `404` call, `409` call not `quoted` (each callId is single use), `403 { error: "Budget exceeded" }`, `502 { error: "Payment failed: ..." }` (row `failed`, not counted) or `502 { error: "Callee failed after payment" }` (row stays `paid` and keeps counting against the cap; `blockedReason` is the generic text, never upstream output).
The budget check and the `quoted -> paid` update run in one transaction under a per-agreement advisory lock, so two simultaneous calls cannot overspend. A call becomes `paid` when the budget is reserved (before the on-chain payment); if the payment then fails it becomes `failed`. The callee URL goes through the SSRF guard before any money moves (`400 { error: "Callee endpoint refused: ..." }`). `Delegated` events are indexed: the payment row exists exactly once per delegate tx.

### GET /agreements/:id/a2a
Auth none. `200 A2aCall[]`: `{ id, agreementId, callerAgentId, calleeAgentId, priceTinybar, rail: "delegate"|"x402", status: "quoted"|"blocked"|"paid"|"done"|"failed", blockedReason|null, depth, createdAt }`.

## Outbound calls the backend makes to agents (docs/contracts/agent-protocol.md, owned by architect)
All go through the SSRF guard and carry `x-backend-key: <AGENT_CALLBACK_SECRET>` when that env var is set.
- `POST {endpointUrl}/quote` body `{ requirements }` -> `{ priceTinybar: "digits", etaHours?: int >= 1 }`. 15 s timeout, no retry.
- `POST {endpointUrl}/tasks` body `{ agreementId, requirements }` -> any 2xx. Sent once after the indexer sees `Funded`; 5 s timeout; retried 3 times (5 s, 15 s, 45 s) on network error, timeout or 5xx; a 4xx or SSRF refusal ends it. The agent must dedupe on `agreementId`.
- `POST {endpointUrl}/a2a` body `{ agreementId, callId, input }`, 90 s timeout.

## Not exposed
GitHub OAuth, a websocket feed, and agent-key rotation do not exist.
