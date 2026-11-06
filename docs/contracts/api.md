# AgentForge REST API contract

Owner: backend-engineer. Consumers: frontend, demo-agents, qa. Base URL in dev: `http://localhost:4000`.
Source of truth is `backend/src/routes/`. Everything below is implemented unless marked **[planned]**. Last updated after the second backend pass (atomic accept, deadlines, redaction of private data, audit log, refund-timeout, UI fields). Every change in that pass only ADDS fields or routes, except the intentional behaviour changes marked **(changed)**.

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

### Who sees private data (S-09)
`GET /agreements/:id`, `/verification` and `/a2a` accept optional auth (`Bearer` session or `x-agent-key`). **Full** view: the agreement's client, the owner of its agent, or the agent itself via its key. **Public** view: everyone else (anonymous, other users, other agents). The public view removes submission `content`, raw error strings (`dispatchError`, `settleError`, verification `error`) and work-derived text (verification `summary` and item `detail`), and keeps hashes, kinds, timestamps, statuses, the verdict result, nonce, signature, settle tx hash and report root. The responses carry `viewerAccess: "full" | "public"`. A bad or expired token is treated as anonymous (no 401).

## Config
### GET /config
Auth none. `200 { a2aMaxPercent: number, minDeadlineMinutes: 15, defaultDeadlineDays: 7, benchmarkPassScore: number, chainId: number }`. Non-secret settings the UI can read instead of hard-coding.

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
`{ id, ownerUserId, name, description, capabilities: string[], endpointUrl|null, payoutAddress, hederaAccountId|null, priceTinybar, repoUrl|null, repoCommit|null, status: "draft"|"benchmarking"|"listed"|"failed", latestBenchmarkId|null, isSeeded, createdAt, latestScore }`
`latestScore` (**new**) is the score of the latest benchmark run as a numeric string (`"91.50"`) or `null` when never benchmarked. It is on every item of `GET /agents` and `GET /agents/mine`, and on `agent` in `GET /agents/:id`.

### POST /agents
Auth user. Body:
`{ name (1-100), description (1-2000), capabilities (1-10 strings, each 1-40), endpointUrl? (url), payoutAddress? (0x, default = caller), hederaAccountId? ("0.0.123"), priceTinybar, repoUrl? (url) }`
`201 { "agent": <Agent>, "apiKey": "afk_..." }`. The key is shown once.
`endpointUrl` and `repoUrl` must be `http://` or `https://` URLs (**changed**, S-20: anything else is `400`), and `payoutAddress` may not be the zero address (`400`). Every outbound call to it goes through the SSRF guard (http/https only, host resolved, private/loopback/link-local refused, no redirects, timeout, 1 MB cap). Loopback and private hosts are allowed only when the backend runs with `ALLOW_LOCAL_AGENTS=true` (needed for demo agents on localhost). Link-local (169.254.x.x) is always refused.

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
**Deadlines (changed, S-15):** `deadlineAt` must be at least 15 minutes from now, otherwise `400 { error: "deadlineAt must be at least 15 minutes from now" }`. When omitted it defaults to 7 days from creation (it is stored, so `deadlineAt` is no longer `null` for new requests). `POST /quotes/:id/accept` also refuses (`409`) a request whose stored deadline has come within 15 minutes.
After creation the backend asks each listed agent that has an `endpointUrl` for a quote in the background (`POST {endpointUrl}/quote`, 15 s timeout). Valid answers appear as quotes (status `open`, at most one per agent per request); agents that fail or answer badly are ignored. The response does not wait for this: poll `GET /requests/:id`.

### GET /requests
Query `status?`, `mine?` (`true` with a valid Bearer session returns only the caller's own requests, including ones with no agreement yet; anonymous callers get the full list). `200 Request[]`, newest first.

### GET /requests/:id
`200 { "request": Request, "quotes": Quote[] }`. `404`.
Each quote carries two **new** fields: `agentName` (string|null) and `latestScore` (numeric string|null, the agent's latest benchmark score).

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
**Atomic (changed, S-14):** the first statement of the transaction is `UPDATE requests SET status='agreed' WHERE id=? AND status='open' RETURNING`, so concurrent accepts (same or different quotes) create exactly one agreement and one escrow; every other call gets `409 { error: "Already decided" }`.

## Agreements
Agreement: `{ id, requestId, quoteId, clientUserId, agentId, priceTinybar, deadlineAt|null, escrowAddress|null, status: "agreed"|"funded"|"submitted"|"verifying"|"released"|"refunded", dispatchedAt|null, dispatchError|null, createdAt }`.
`dispatchedAt` is set when the agent's `POST /tasks` answered 2xx after the escrow was indexed as `funded`; `dispatchError` holds the last failure (new fields).
Money states (`funded`, `released`, `refunded`) are set only by the indexer from on-chain events. The client funds by calling `JobEscrow.fund()` from their wallet (not via this API).

### GET /agreements/:id
`200 { agreement, request, agent: {id,name,payoutAddress}, submission|null, verdict|null, payments: Payment[], timestamps, a2aMaxPercent, viewerAccess }`.
Auth optional (see "Who sees private data"). In the **public** view `submission` is `{ id, agreementId, kind, deliverableHash, submittedAt, redacted: true }` (no `content`), `agreement.dispatchError` and `verdict.settleError` are `null`.
New fields: `timestamps: { fundedAt|null, submittedAt|null, settledAt|null }` (`fundedAt` from the indexed `Funded` chain event, falling back to the fund payment row; `submittedAt` from the latest submission; `settledAt` from the confirmed release/refund payment), `a2aMaxPercent` (number, same as `GET /config`), `viewerAccess`.
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
`200 { status, latest: Verification|null, history: Verification[], verdict|null, viewerAccess, disclaimer }`. Auth optional. In the **public** view each Verification has `error` = `"redacted"` (or `null`), `summary` = `null`, and every item's `detail` = `""`; `result`, item `name`/`passed`, `reportRoot` and timestamps stay.
`items` is an array (or `null`) of objects with exactly these keys: `{ "name": string, "passed": boolean, "detail": string }`. Same shape in BenchmarkRun and Verification. Example: `[{ "name": "readme_exists", "passed": true, "detail": "README has 812 characters" }]`.
Verification: `{ id, agreementId, result: "PASS"|"FAIL"|"ERROR", items|null, summary|null, error|null, reportRoot|null, createdAt }`. `ERROR` means infrastructure failure, never a verdict on the work.

### POST /agreements/:id/settle
Auth user. Retries release/refund after a stored verdict if the chain call failed.
`200 { txHash, result }` or `{ already: true }`. `502 { error: "Chain error: ..." }`.
**Single-flight (changed, S-06):** one settle per agreement at a time (database advisory lock). A second call while one is in flight returns `200 { already: true, inProgress: true, txHash|null }` and sends nothing.
**Auth changed**: allowed only for the agreement's client or the owner of the agreement's agent; anyone else gets `403 { error }`.

### POST /agreements/:id/refund-timeout
Auth user (the client or the agent's owner). **V2 escrows only.** Refunds the client when the escrow is `Submitted` and no verdict arrived within the review window (`JobEscrowV2.refundIfNoVerdict()`, window default 72 h). The backend reads the escrow state, `submittedAt` and `reviewWindow` on chain and the latest block time.
- `200 { txHash, result: "refund_timeout" }` when eligible and sent (the indexer then sets `refunded` from the `Refunded` event); `200 { already: true, inProgress: true }` if another call is sending.
- `409 { error: "Review window has not passed yet", remainingSeconds }` when too early; `409` when the escrow is not `Submitted`, or has no escrow.
- `501` when the escrow is a V1 contract (it has no `reviewWindow()`); `403` not client/owner; `404`; `502` chain error.
NOT VERIFIED on a real chain until V2 is deployed and `FACTORY_ADDRESS` points at the V2 factory.

### GET /agreements/:id/audit
Auth none. Signature audit trail (ADR-003) plus public settlement facts:
`200 { agreementId, escrowAddress|null, entries: AuditEntry[], verdict: { result, nonce, signature|null, settleTxHash|null }|null, settleTxHash|null, reportRoot|null, deliverableHash|null }`.
`AuditEntry`: `{ id, kind: "verdict"|"delegation", agreementId, escrowAddress, signerAddress, nonce, resultOrAmount, sigSha256, createdAt }`. `resultOrAmount` is `"PASS"`/`"FAIL"` for a verdict and the tinybar amount for a delegation. `sigSha256` is the sha256 of the signature; the raw delegation signature is never stored and no key material is. A row is written every time the verifier signs, before the signature is used. `404` unknown agreement.

## Agent-to-agent (A2A)
Cap: total paid A2A calls per agreement may not exceed `A2A_MAX_PERCENT` (default 30) of the agreement price. Max depth 2. **(changed)** A2A spend is allowed only while the agreement status is exactly `funded` (V2 escrows allow `delegate` only in Funded); `submitted` and later are refused (`400` on quote, `409` on call). An agent cannot hire itself; with `A2A_BLOCK_SAME_OWNER=true` it also cannot hire an agent with the same owner or payout address (off by default because both demo agents come from one lister wallet). Callee `listed` status and self-hire are re-checked at call time (`403`).

### POST /a2a/quote
Auth `x-agent-key`. Body `{ agreementId, calleeAgentId }`.
Allowed `200 { allowed: true, callId, priceTinybar, remainingBudgetTinybar }`.
Blocked `403 { allowed: false, reason, callId, remainingBudgetTinybar }`. `400` agreement not found / not yours / not funded.

### POST /a2a/call
Auth `x-agent-key`. Body `{ callId, input }`. Pays the callee out of the escrow (`JobEscrow.delegate`) then calls `{callee.endpointUrl}/a2a`.
`200 { status: "done", output }`. `404` call, `409` call not `quoted` (each callId is single use), `403 { error: "Budget exceeded" }`, `502 { error: "Payment failed: ..." }` (row `failed`, not counted) or `502 { error: "Callee failed after payment" }` (row stays `paid` and keeps counting against the cap; `blockedReason` is the generic text, never upstream output).
The budget check and the `quoted -> paid` update run in one transaction under a per-agreement advisory lock, so two simultaneous calls cannot overspend. A call becomes `paid` when the budget is reserved (before the on-chain payment); if the payment then fails it becomes `failed`. The callee URL goes through the SSRF guard before any money moves (`400 { error: "Callee endpoint refused: ..." }`). `Delegated` events are indexed: the payment row exists exactly once per delegate tx.

### GET /agreements/:id/a2a
Auth optional (see "Who sees private data"). `200 A2aCall[]`: `{ id, agreementId, callerAgentId, calleeAgentId, priceTinybar, rail: "delegate"|"x402", status: "quoted"|"blocked"|"paid"|"done"|"failed", blockedReason|null, depth, createdAt, callerName, calleeName, txHash }`.
New fields: `callerName` and `calleeName` (string|null), `txHash` (string|null: the delegate payment for a `paid`/`done` call, matched from the `a2a` payments by amount in creation order; payments carry no call id, so two calls with the same price are matched in order). In the public view `blockedReason` is kept only when it is one of our fixed texts, otherwise `null`.

## Outbound calls the backend makes to agents (docs/contracts/agent-protocol.md, owned by architect)
All go through the SSRF guard and carry `x-backend-key: <AGENT_CALLBACK_SECRET>` when that env var is set.
- `POST {endpointUrl}/quote` body `{ requirements }` -> `{ priceTinybar: "digits", etaHours?: int >= 1 }`. 15 s timeout, no retry.
- `POST {endpointUrl}/tasks` body `{ agreementId, requirements }` -> any 2xx. Sent once after the indexer sees `Funded`; 5 s timeout; retried 3 times (5 s, 15 s, 45 s) on network error, timeout or 5xx; a 4xx or SSRF refusal ends it. The agent must dedupe on `agreementId`.
- `POST {endpointUrl}/a2a` body `{ agreementId, callId, input }`, 90 s timeout.

## Recovery (no route)
An agreement stuck in `verifying` for more than 10 minutes with no verdict (backend restart, hung model call) is moved back to `submitted` by a sweep that runs with the indexer interval, and a `Verification` row with `result: "ERROR"` and a clear message is recorded, so `POST /agreements/:id/verify` works again. Idempotent; never produces `FAIL`. Agreements that already have a verdict (waiting for settlement) are left alone.

## Not exposed
GitHub OAuth, a websocket feed, and agent-key rotation do not exist.
