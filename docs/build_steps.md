# AgentForge: Step-by-Step Build Plan

Companion to `docs/agentforge_architecture_v2.md` (read it first; this file only says what to build and in what order).
Each step ends with **Done when**: a concrete check. Do not start the next step until it passes.
Deadline: Sat 7 Nov 2026, 09:00 IST. Under a day left, so the order below favours a working demo early.

Folders: `backend/`, `frontend/`, `contracts/`, `demo-agents/`.

---

## Step 0: Quick checks (1-2 hours, do first)

These decide whether the plan holds. Record results in `docs/spike-results.md`.

0.1 Create two ECDSA testnet accounts in the Hedera Portal (one client, one lister) and get testnet HBAR. Add Hedera testnet to MetaMask (chainId 296, `https://testnet.hashio.io/api`).
0.2 Get a 0G faucet wallet funded (`https://faucet.0g.ai`, limited per day, so do it now).
0.3 Call the NVIDIA API once with the `openai` package (`baseURL https://integrate.api.nvidia.com/v1`, model `nvidia/nemotron-3.5-super-vl-120b-a12b`). Check: plain answer works, a JSON-only answer parses, and `chat_template_kwargs` is accepted.
0.4 One 0G Storage upload and download with `MemData`.
0.5 Deploy a trivial payable contract to Hashio with `forge create`. Call it from a script with a weibar value and confirm `address(this).balance` is in tinybar.

**Done when:** all five work, or you have written down which one failed and the fallback (escrow vault instead of factory; skip 0G storage and store reports in Postgres only).

---

## Phase 1: Core Backend (`backend/`)

Fastify + Zod + PostgreSQL 16 + Drizzle, TypeScript, Node 22.

1.1 **Project setup.** `npm init`, TypeScript, Fastify, Zod, Drizzle, `pg`, `viem`, `openai`, `dotenv`. `.env` and `.env.example` per section 14 of the architecture doc. Add `GET /health`.
**Done when:** `GET /health` returns 200 and the server reads `.env`.

1.2 **Database.** Docker or local Postgres 16. Write the Drizzle schema from section 10 of the architecture doc and run the first migration.
**Done when:** all tables exist; you can insert and read a row with a `numeric(38,0)` value as a `bigint`.

1.3 **Money helper.** `src/money.ts`: `toRpcValue(tinybar: bigint): bigint` (`* 10n**10n`), `hbarToTinybar(string): bigint` (decimal string to bigint, no floats), `tinybarToHbar(bigint): string`. Unit tests.
**Done when:** `hbarToTinybar("1.5") === 150000000n` and the tests pass.

1.4 **Auth.** `POST /auth/nonce`, `POST /auth/verify` (verify the signature with `viem.verifyMessage`, create a session), `GET /me`, session middleware.
**Done when:** a script signs a nonce with a test key and gets a session; `/me` returns the address.

1.5 **Agents API.** `POST /agents`, `GET /agents`, `GET /agents/:id`. New agents start as `draft`. On creation, generate an `agent_api_key` (random string, stored hashed) and return it once; agents use it as `x-agent-key` when calling the backend.
**Done when:** you can create and list agents via curl.

1.6 **Requests, quotes, agreements.** Endpoints from section 12 of the architecture doc, plus a small state machine (`requested → quoted → agreed → funded → submitted → verifying → released | refunded`). Reject invalid transitions. `funded`, `released`, `refunded` are only set by the indexer (step 3.9), never by an API call. For now add a dev-only `POST /dev/agreements/:id/mark-funded` to unblock testing; remove it in step 3.9.
**Done when:** a script runs request → quote → accept → mark-funded with correct statuses.

1.7 **GitHub repo fetch.** `fetchRepo(url)`: parse `owner/repo`, download the public repo archive from GitHub (confirm the exact API URL against GitHub's docs, I have not verified it here), record the commit SHA, drop binaries and `node_modules`, cap the total size at ~100 KB of text, return `Record<path, content>` plus the file tree.
**Done when:** `fetchRepo` on a small public repo returns files and a SHA.

1.8 **NVIDIA client.** `src/nvidia.ts` with one function `askJson(system, user, zodSchema)`: calls the model, asks for JSON only, parses with Zod, retries once on parse failure. Low temperature. Throws a clear error if the key is missing or the call fails.
**Done when:** `askJson` returns a parsed object for a test prompt.

1.9 **Analyzer.** Implement the `Analyzer` interface from the architecture doc.
- `benchmark(...)`: run the custom code checks (README present, entry point exists, manifest parses, capability keywords appear in the code) and one NVIDIA call that returns `{score 0-100, review, items[]}`. `score = 0.4 * custom + 0.6 * ai`.
- `verify(...)`: NVIDIA call 1 turns the requirement text into a checklist; call 2 (or the same call) judges the submission against each item; custom code does the mechanical checks the client ticked (`secrets_scan` regex, `dependency_check`, `build_config`). Result is `PASS` only if every ticked check passes and the checklist passes.
- If NVIDIA errors, return an `ERROR` result; never `FAIL`.
**Done when:** running `benchmark` on a real repo prints a score and a review; running `verify` on a tiny repo and a requirement prints a checklist with pass/fail per item.

1.10 **0G Storage wrapper.** `src/zerog.ts`: `uploadJson(obj) → rootHash`, `downloadJson(rootHash)`. Use the code in section 9 of the architecture doc.
**Done when:** upload then download returns the same object.

1.11 **Benchmark endpoint.** `POST /agents/:id/benchmark`: fetch repo → `Analyzer.benchmark` → store `benchmark_runs` → upload report to 0G (if that fails, store the report in Postgres and leave `report_root` null) → set agent `listed` if score ≥ 80, else `failed`. Run it as a background job and let the client poll `GET /agents/:id/benchmark/:runId`.
**Done when:** a repo that scores ≥ 80 ends with the agent `listed`; a weak repo ends `failed` with a visible review.

1.12 **Submission and verification endpoints.** `POST /agreements/:id/submit` (requires `x-agent-key` of the assigned agent) saves the submission and sets `submitted`. `POST /agreements/:id/verify` (triggered automatically after submit) runs `Analyzer.verify`, stores `verifications`, uploads the report. Produce the verdict: `PASS` / `FAIL`, or `ERROR` (leaves the agreement in `verifying` and allows a retry button).
**Done when:** a mocked agreement goes submit → verify → verdict, with the checklist visible in `GET /agreements/:id/verification`.

1.13 **A2A endpoints.** `POST /a2a/quote` and `POST /a2a/call` (require `x-agent-key`). Rules: callee must be `listed`; caller's total A2A spend for the agreement ≤ 30% of the price (use bigint math); depth ≤ 2. Over the limit → store `blocked` with a reason and return 403. The actual payment is wired in step 3.8; until then the endpoint records `paid` only as a dev stub.
**Done when:** curl shows one allowed call and one blocked call recorded in `a2a_calls`.

**Phase 1 finished when:** the whole job flow runs against the API with chain steps stubbed, and a repo can be benchmarked and listed.

---

## Phase 2: Agent Building (`demo-agents/`)

Two small Node + TypeScript services that act as real agents. They are the demo's cast and the test subjects for the benchmark, so each lives in its own public GitHub repo (or a public folder-repo) with a decent README.

Agent protocol (keep it this small):
- `POST /quote` body `{requirements}` → `{priceTinybar, etaHours}`
- `POST /tasks` body `{agreementId, requirements}` → respond `202` immediately, then do the work in the background and call `POST {BACKEND}/agreements/:id/submit` with `x-agent-key`.

2.1 **Agent base template.** Fastify server with the two endpoints, config for the backend URL and `x-agent-key`, and a tiny helper to call the backend.
**Done when:** the template starts, answers `/quote`, accepts `/tasks`, and posts a submission back to the backend.

2.2 **Agent 1: "Solidity Builder".** On `/tasks`, uses the NVIDIA API to write a small Solidity contract (e.g. an ERC-20 or a simple vault) from the requirement and returns the code as the submission (a gist, a file saved to 0G Storage, or inline text; inline is simplest). Its README clearly lists its capability (`solidity-build`) so the benchmark can match it.
**Done when:** a task produces a plausible contract and the submission shows up in the backend.

2.3 **Agent 2: "Static Auditor".** On `/tasks`, takes code in the request and uses the NVIDIA API to return a short security review (list of findings with severity). Capability tag `static-audit`.
**Done when:** given a contract, it returns a structured review.

2.4 **A2A behaviour in Agent 1.** Before submitting, Agent 1 calls `POST /a2a/quote` for the `static-audit` capability, then `POST /a2a/call` with its code, gets the review back, applies the fixes (or appends the review), and then submits. Add one demo mode where it tries to buy too much so the backend blocks it (the "blocked payment" demo).
**Done when:** one job shows an allowed A2A call and one blocked call in `a2a_calls`.

2.5 **Onboard both agents.** Push both repos to GitHub, list each through the API/UI, and tune the READMEs and code until each benchmark score is ≥ 80. Save the two agents' payout addresses (use your lister wallet) and keys in `demo-agents/.env`.
**Done when:** both agents show as `listed` with a visible benchmark report.

2.6 **Seed data.** Script that creates a few extra listed agents and sample requests, each flagged `is_seeded` so the UI can badge them as seeded.
**Done when:** the marketplace has 4-5 agents, with the two real ones clearly distinct.

**Phase 2 finished when:** you can run an end-to-end job (still with chain steps stubbed) where Agent 1 hires Agent 2 and the verification checklist renders.

---

## Phase 3: Smart Contracts, Payments, Blockchain (`contracts/` + backend wiring)

Can start in parallel with Phase 1 (steps 3.1-3.4 do not depend on the backend).

3.1 **Foundry project.** `forge init`, Solidity 0.8.24. Add the OpenZeppelin ECDSA/EIP712 helpers if you want signature checks (`forge install`).
**Done when:** `forge build` passes.

3.2 **`JobEscrow`.** Implement the functions in section 5 of the architecture doc:
- `fund()` payable, client only, requires `msg.value == price` (tinybar).
- `submit(deliverableHash)`, agent only.
- `release(sig)` and `refund(sig)`: verify an EIP-712 signature from `verifier` over `{agreementId, result, nonce}`; each nonce usable once; pay with `call{value:}`.
- `refundAfterDeadline()`.
- Events listed in the architecture doc.
- Use `uint256 constant HBAR = 1e8;`. Never `1 ether`.
**Done when:** Foundry tests cover fund → submit → release, fund → refund, deadline refund, wrong-sender and wrong-amount reverts, and replayed signature reverts.

3.3 **`AgreementFactory`.** `createEscrow(...)` deploys a `JobEscrow` and emits `EscrowCreated`. Only the backend relayer address may call it.
**Done when:** a test creates two escrows with different agreement ids and funds both independently.

3.4 **`delegate()` for A2A.** Add `delegate(subAgent, amount, policySig)` to `JobEscrow`: callable when `Funded` or `Submitted`; verifies a backend-signed EIP-712 message `{agreementId, subAgent, amount, nonce}`; pays out; reduces the remaining balance; emits `Delegated`. The final `release` pays `balance` (what is left) to the agent.
**Done when:** a test delegates part of the price to a sub-agent and the agent gets the remainder on release.

3.5 **Deploy to Hedera testnet.** Script that deploys `AgreementFactory` via Hashio and writes the address to `contracts/deployments.json`. Export the ABIs to JSON for `backend/` and `frontend/`. Confirm that a contract can create a contract on Hedera; if it cannot, switch to the single `EscrowVault` fallback (same functions keyed by `agreementId`) and note it in `docs/spike-results.md`.
**Done when:** factory address is on testnet, and one `createEscrow` transaction succeeds and emits the event.

3.6 **Backend chain client.** `backend/src/chain.ts` with viem: public client and relayer wallet client on chain 296 (define the chain with RPC `https://testnet.hashio.io/api`, native currency HBAR). Functions: `createEscrow`, `release`, `refund`, `delegate`, and `signVerdict` / `signDelegation` (EIP-712 with the verifier key). Amounts in, tinybar `bigint`; use `toRpcValue` only for a `value` field.
**Done when:** a script creates an escrow from the backend and reads back the escrow address from the event.

3.7 **Wire escrow creation and settlement.** On quote acceptance call `createEscrow` and save `escrow_address` (read from the `EscrowCreated` log). After a PASS verdict call `release`; after a FAIL call `refund`. A chain failure leaves the agreement in its current state and shows an error with a retry option.
**Done when:** acceptance returns an escrow address; a verdict triggers a release or refund transaction.

3.8 **Wire A2A payment (Rail 1).** When `/a2a/call` passes the budget rule, the backend signs the delegation and calls `JobEscrow.delegate(...)`; store the tx hash in `payments`. Mark the call `paid` only after the indexer sees `Delegated`.
**Done when:** the demo A2A call moves real HBAR from the escrow to Agent 2's payout address.

3.9 **Indexer.** A loop polling the mirror node `GET /api/v1/contracts/{escrow}/results/logs` with `order=asc`, a timestamp range under 7 days, and `links.next` paging. Keep `chain_cursor`. Decode logs with viem `decodeEventLog` and update `agreements`, `payments`, `a2a_calls` for `Funded`, `Submitted`, `Released`, `Refunded`, `Delegated`. Remove the dev `mark-funded` endpoint.
**Done when:** funding from MetaMask flips the agreement to `funded` within a few poll cycles with no manual step.

3.10 **(Stretch) x402 rail.** Only after everything else works. Read the Hedera x402 pages and the `@x402/*` package first (the header names and HBAR `amount` unit are unconfirmed), test `GET https://api.testnet.blocky402.com/supported`, then add a pay-per-call endpoint to Agent 2.
**Done when:** one x402 payment settles on testnet. Skip if short on time.

**Phase 3 finished when:** a real HBAR escrow is created, funded from MetaMask, and released or refunded by a backend-signed verdict, with the indexer reflecting every step.

---

## Phase 4: Frontend (`frontend/`)

Next.js (App Router), TypeScript, Tailwind, wagmi + viem. Start the layout and static pages in parallel with Phase 1; wire the money flows after Phase 3.

4.1 **Setup.** Next.js app, wagmi config with a custom chain: id 296, name Hedera Testnet, native currency HBAR, RPC `https://testnet.hashio.io/api`, explorer `https://hashscan.io/testnet`. An env var for the backend URL. API client with typed responses (copy the few types you need).
**Done when:** the app runs and can call `GET /health` on the backend.

4.2 **Wallet connect and login.** A `useWallet()` hook around wagmi. "Connect wallet" button (MetaMask injected connector), switch/add network, sign the nonce, call `/auth/verify`, store the session. Show address and a sign-out button.
**Done when:** you can log in with MetaMask on Hedera testnet.

4.3 **Marketplace.** Agent list with search by capability, "seeded" badge, benchmark score. Agent detail page showing price, capabilities, repo link, and the benchmark review text.
**Done when:** the two real agents appear with their scores and reviews.

4.4 **List-an-agent flow.** Form (name, description, capabilities, price in HBAR, endpoint URL, payout address prefilled with the wallet address), repo URL field, a "Run benchmark" button, a progress state while polling, and the report view (score, items, review, listed/failed).
**Done when:** you can list a new agent from the UI and watch it pass or fail.

4.5 **Create request and quotes.** Request form (title, requirements, tick the checks to run, budget in HBAR, deadline). Request page lists quotes (agents can be invited to quote through their `/quote` endpoint, or the backend asks listed agents on request creation). Accept button.
**Done when:** a request produces quotes and accepting one creates an agreement.

4.6 **Fund escrow.** On the agreement page, a "Fund escrow" button: reads `escrow_address` and price from the API, sends `fund()` through wagmi/viem with `value = toRpcValue(priceTinybar)`, shows "waiting for confirmation" until the backend reports `funded` (do not mark funded locally).
**Done when:** funding from MetaMask moves the page to `funded` through the indexer.

4.7 **Job page.** A timeline of the states, the agent's submission, the verification checklist (item, pass/fail, detail), the verdict, the payout or refund, the A2A call list (who paid whom, how much, blocked calls with the reason). Show the line "Automated verification is not a professional audit." Optional small "view on HashScan" links using stored tx ids.
**Done when:** one full job is readable top to bottom from this page alone.

4.8 **Amount display.** One helper formats tinybar strings as HBAR (e.g. `150000000` → `1.5 HBAR`) and parses form inputs back to tinybar strings without floats. Use it everywhere.
**Done when:** no screen shows a raw tinybar or weibar number.

4.9 **Polish for demo.** Loading and error states for every call (NVIDIA error with retry, chain error with retry), empty states, a clean landing page with the one-sentence pitch, seeded badges.
**Done when:** a first-time viewer can follow the flow without explanation.

**Phase 4 finished when:** the demo path works only through the UI.

---

## Final integration and demo (last 2-3 hours)

F.1 Run the full path with fresh accounts: lister lists Agent 1 and Agent 2 (benchmarks pass) → client creates a request → quote → accept → escrow created → fund from MetaMask → Agent 1 works, hires Agent 2 (paid via `delegate`), one blocked call → submit → checks run → PASS → HBAR released to the lister wallet. Run one FAIL path ending in a refund.
F.2 Fix only what breaks the demo. Freeze features.
F.3 Write the demo script (3-4 minutes) and record the video. Submit at least an hour before the deadline.

## If time runs short, cut in this order
x402 rail → GitHub OAuth → extra checks (dependency, security review) → 0G Storage for reports (keep them in Postgres) → third demo agent → HashScan links → polish. Never cut: wallet login, HBAR escrow fund/release/refund, benchmark-gated listing, verification verdict, and the A2A delegate call with one blocked case.

## Suggested parallel split if you have helpers or run agents in parallel
- Track A: Phase 1 (backend) then Phase 2 (agents).
- Track B: Phase 3.1-3.5 (contracts), then 3.6-3.9 once the backend skeleton exists.
- Track C: Phase 4.1-4.4 (frontend shell), then 4.5-4.9 once the chain flow works.
