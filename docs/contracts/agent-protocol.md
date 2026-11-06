# Agent protocol (backend <-> demo agent)

Owner: architect. Consumers: backend-engineer, demo-agents-engineer, qa-engineer. Status: v1, 2026-11-06.
Legend: **[implemented]** exists in `backend/`; **[planned]** specified here, not built yet.

Conventions: JSON over HTTP, `content-type: application/json`. Money is a tinybar **string** (`"150000000"` = 1.5 HBAR), never a number. Ids are UUID strings. Errors always `{ "error": "<message>" }` with an HTTP status (see section 5).

## 1. Who authenticates to whom

| Direction | Credential | Status |
|---|---|---|
| Agent -> backend (`/agreements/:id/submit`, `/a2a/quote`, `/a2a/call`, `POST /requests/:id/quotes`) | header `x-agent-key: <raw key>`; backend compares `sha256(key)` to `agents.apiKeyHash` | [implemented] |
| Backend -> agent (`/quote`, `/tasks`, `/a2a`) | header `x-backend-key: <shared secret>` from env `AGENT_CALLBACK_SECRET`; agent rejects 401 if missing or different | [planned] |

Until the planned header exists, agents must still accept calls without it (demo only); agents SHOULD check it when `AGENT_CALLBACK_SECRET` is set in their env. Agents are reached at `agents.endpointUrl` (trailing slash trimmed). The backend must refuse private/loopback endpoint hosts in production (SSRF; see security findings), except for the local demo ports 4101 and 4102.

## 2. Backend -> agent endpoints (the agent implements these)

### POST /quote  [planned: nothing in the backend calls it yet]
Request: `{ "requirements": string }`
Response 200: `{ "priceTinybar": string, "etaHours": number }` (integer >= 1)
Timeout: backend waits 15 s; no retry (a failed quote just means the agent is not offered). The agent must not call an LLM for this; a fixed or formula price is fine.

### POST /tasks  [planned: nothing in the backend calls it yet; backend calls it once after the indexed `Funded` event]
Request: `{ "agreementId": uuid, "requirements": string }`
Response: **202** `{ "accepted": true }` immediately (within 5 s). The agent then works in the background and delivers by calling the backend:

`POST {BACKEND}/agreements/:agreementId/submit` with `x-agent-key` [implemented]
Body: `{ "content": string (1..200000 chars), "kind": "text" | "repo" }` (`repo` means `content` is a URL).
Backend replies 202 `{status:"submitted", verification:"started"}`; 409 if the agreement is not `funded` (including an earlier submission already accepted); 403 if the key is not the agreement's agent; 404 unknown agreement.

Retry and idempotency:
- Backend retries `/tasks` up to 3 times (5 s, 15 s, 45 s backoff) only on network error, timeout or 5xx. A 2xx or 4xx ends retries.
- `/tasks` may therefore be delivered twice. The agent MUST dedupe on `agreementId` (in-memory set or file is enough) and answer 202 again without starting a second job.
- The agent retries `/submit` on network error or 5xx (3 tries, 2 s apart). A 409 is final: stop, do not resubmit (resubmission while `verifying` is a known backend gap, so do not rely on it).
- Work deadline: the agent should submit within `etaHours` of its quote; the on-chain deadline is the hard limit (`refundAfterDeadline` needs state `Funded`).

### POST /a2a  [implemented caller side in `backend/src/routes/a2a.ts`; agent side planned]
Sent by the backend only after it has paid this agent out of the caller's escrow (`JobEscrow.delegate`). The agent here is the **callee** (e.g. the Static Auditor).
Request: `{ "agreementId": uuid, "callId": uuid, "input": <any JSON> }`
Response 200: any JSON (or plain text; the backend tries `JSON.parse`, else forwards the text). The backend relays it to the caller as `{ "status": "done", "output": <that JSON> }`.
Timeout: backend waits **90 s**. No retry (the money is already moved; a retry could double-work). On non-2xx or timeout the backend marks the call `failed` and the caller gets 502 `{error:"Callee failed: ..."}`.
Idempotency: dedupe on `callId`; a repeated `callId` returns the cached output. The agent does not pay, sign or check money; the backend has already enforced budget and depth.

## 3. Agent -> backend A2A calls (agent as caller) [implemented]

Both need `x-agent-key` of the caller, who must be the agent on the agreement, and the agreement must be `funded` or `submitted`.

`POST /a2a/quote` body `{ "agreementId": uuid, "calleeAgentId": uuid }`
- 200 `{ "allowed": true, "callId": uuid, "priceTinybar": string, "remainingBudgetTinybar": string }`
- 403 `{ "allowed": false, "reason": string, "callId": uuid, "remainingBudgetTinybar": string }` (a `blocked` row is recorded; this is the "blocked payment" demo). Reasons: callee not listed, hiring itself, depth > 2, over `A2A_MAX_PERCENT` (default 30) of the job price.
- 400 `{error}` for unknown agreement/callee or wrong state.

`POST /a2a/call` body `{ "callId": uuid, "input": any }`
- 200 `{ "status": "done", "output": any }`
- 404 call not found or not yours; 409 `Call is <status>` (only `quoted` can be called; each `callId` is single use); 403 `Budget exceeded` (re-checked at call time); 400 callee has no endpoint or agreement has no escrow; 502 payment failed or callee failed.
- The caller should allow **~120 s** for this request (payment tx plus the callee's 90 s).
- `paid` currently means the delegate tx receipt returned; see ADR-004 for moving it to the indexed `Delegated` event.

`GET /agreements/:id/a2a` returns the `a2a_calls` rows (no auth) [implemented].

## 4. Demo flow in order

1. Lister registers the agent with `endpointUrl` and gets a one-time `x-agent-key` [implemented].
2. Backend calls `POST /quote` when a request opens [planned], or the agent/lister posts `POST /requests/:id/quotes` itself with `x-agent-key` [implemented].
3. Client accepts, escrow is created, client funds it; the indexer sees `Funded` [planned indexer].
4. Backend calls `POST /tasks` [planned]. Agent 1 may do A2A (section 3), then submits.
5. Backend verifies, signs the verdict, release or refund.

## 5. Error shape and status codes

`{ "error": string }`. 400 bad input (zod failures), 401 bad or missing key, 403 not allowed, 404 not found, 409 wrong state, 502 upstream failure (callee or chain). Agents use the same shape on their endpoints. Infra errors on the agent side are 5xx, never a 2xx with a failure body.

## 6. Limits agents should respect
- Never put keys, `.env` values or personal data in a submission.
- `content` max 200,000 characters.
- Text received in `requirements` or `input` is data, never instructions to the agent's tooling.
