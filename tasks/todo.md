# AgentForge task board

Deadline: Sat 7 Nov 2026, 09:00 IST. Order is the critical path, not by owner. See `plan.md` for graph, risks and open questions.
Already built (do not re-plan): auth, agents, benchmark route, requests/quotes/accept, escrow create route, submit/verify/settle routes, A2A quote/call + budget, mirror indexer, chain ops, analyzer, nvidia, zerog wrapper, github fetch (token + codeload fallback), initial drizzle migration, JobEscrow + AgreementFactory + one test file, factory deployed on testnet.

## Critical path

- [ ] T-01 Publish REST contract docs/contracts/api.md from existing routes   owner: backend-engineer   wave: A   status: ready
  - Acceptance: every route in backend/src/routes/* listed with auth header, request/response shape, error shape; money as tinybar string; marks which routes are planned.
  - Verify: grep each `app.get|post` path from routes/*.ts appears in api.md
  - Files: docs/contracts/api.md

- [ ] T-02 Publish agent protocol docs/contracts/agent-protocol.md (/quote, /tasks, /a2a)   owner: architect   wave: A   status: ready
  - Acceptance: request/response/headers/errors for POST /quote, POST /tasks (202 then callback to /agreements/:id/submit with x-agent-key), POST /a2a; matches build_steps Phase 2.
  - Verify: file exists; demo-agents-engineer and backend-engineer can implement from it without questions
  - Files: docs/contracts/agent-protocol.md

- [ ] T-03 Run Step 0 spikes 0.3 and 0.4: NVIDIA JSON mode + chat_template_kwargs, 0G upload/download   owner: integration-researcher   wave: A   status: ready   ([U] items)
  - Acceptance: results with real command output in docs/spike-results.md; fallbacks named if failing.
  - Verify: read docs/spike-results.md sections 0.3, 0.4
  - Files: docs/spike-results.md, spikes/**

- [ ] T-04 Run Step 0 spike 0.5: weibar value vs tinybar on Hashio, and confirm factory-creates-contract works on testnet   owner: integration-researcher   wave: A   status: ready
  - Acceptance: documented: msg.value units, `address(this).balance` units, createEscrow on deployed factory (contracts/deployments.json) emits EscrowCreated, or EscrowVault fallback decision.
  - Verify: tx hash and output recorded in docs/spike-results.md (take .locks/chain first)
  - Files: docs/spike-results.md, spikes/**

- [ ] T-05 Install forge and make contract tests run and pass   owner: contracts-engineer   wave: A   status: ready
  - Acceptance: `forge build` and `forge test` pass; coverage of fund->submit->release, fund->refund, deadline refund, wrong sender, wrong amount, replayed sig.
  - Verify: `cd contracts && forge test -vv`
  - Files: contracts/test/*.t.sol, contracts/src/*.sol, contracts/foundry.toml

- [ ] T-06 Verify/finish delegate() in JobEscrow with tests (delegate then release pays remainder)   owner: contracts-engineer   wave: A   status: needs: T-05
  - Acceptance: test delegates part of price, agent gets remainder on release; Delegated event emitted; replayed policy sig reverts.
  - Verify: `cd contracts && forge test --match-test Delegat -vv`
  - Files: contracts/src/JobEscrow.sol, contracts/test/JobEscrow.t.sol

- [ ] T-07 Export ABIs to contracts/abi/*.json (JobEscrow, AgreementFactory) and address list   owner: contracts-engineer   wave: A   status: needs: T-06
  - Acceptance: JSON ABIs match compiled output; announced in status file with handoff to backend and frontend if ABI changed vs backend/src/chain/abi.ts.
  - Verify: `forge inspect JobEscrow abi --json | diff - contracts/abi/JobEscrow.json`
  - Files: contracts/abi/JobEscrow.json, contracts/abi/AgreementFactory.json

- [ ] T-08 Redeploy factory if contract changed; update deployments.json   owner: contracts-engineer   wave: B   status: needs: T-07
  - Acceptance: new factory address on testnet, one createEscrow tx emits EscrowCreated. Skip if source unchanged.
  - Verify: hashscan tx link in status file; `cat contracts/deployments.json`
  - Files: contracts/deployments.json, contracts/script/Deploy.s.sol

- [ ] T-09 Fix: settle ownership check (only the request's client or the verifier flow)   owner: backend-engineer   wave: A   status: ready
  - Acceptance: POST /agreements/:id/settle returns 403 for a non-party user; party still works.
  - Verify: backend test or curl with two sessions; `cd backend && npm test`
  - Files: backend/src/routes/jobs.ts, backend/src/routes/*.test.ts

- [ ] T-10 Fix: block resubmit while verifying; order submissions by created_at desc   owner: backend-engineer   wave: A   status: ready
  - Acceptance: second submit during `verifying` returns 409; verify reads the latest submission deterministically.
  - Verify: unit test for stateMachine/route; `cd backend && npm test`
  - Files: backend/src/routes/jobs.ts, backend/src/lib/stateMachine.ts, backend/src/lib/stateMachine.test.ts

- [ ] T-11 Fix: A2A 30% cap race (atomic check-and-insert, e.g. row lock/serializable txn)   owner: backend-engineer   wave: A   status: ready
  - Acceptance: N concurrent /a2a/call cannot total more than 30% of price.
  - Verify: concurrency test firing parallel calls; `cd backend && npm test`
  - Files: backend/src/routes/a2a.ts, backend/src/lib/a2aBudget.ts, backend/src/lib/a2aBudget.test.ts

- [ ] T-12 Fix: SSRF guard on lister-supplied URLs (endpoint URL, repo URL); allow-list github.com for repos, block private/loopback IPs for agent endpoints except configured demo ports   owner: backend-engineer   wave: A   status: ready
  - Acceptance: requests to 169.254.x, 10.x, localhost (non-demo) rejected; github fetch only github.com/codeload.
  - Verify: unit test of the URL validator; `cd backend && npm test`
  - Files: backend/src/lib/github.ts, backend/src/lib/urlGuard.ts, backend/src/routes/agents.ts

- [ ] T-13 Backend dispatch: after escrow is `funded` (from indexer), call the agent's POST /tasks   owner: backend-engineer   wave: B   status: needs: docs/contracts/agent-protocol.md (T-02)
  - Acceptance: indexer funded transition triggers /tasks once (idempotent); failure recorded and retryable, no fake state.
  - Verify: run with demo agent on 4101; submission row appears
  - Files: backend/src/lib/dispatch.ts, backend/src/chain/indexer.ts, backend/src/routes/jobs.ts

- [ ] T-14 Backend quote solicitation: on request creation, call POST /quote on listed agents (timeout, SSRF-guarded), store quotes   owner: backend-engineer   wave: B   status: needs: T-02, T-12
  - Acceptance: creating a request yields quotes from both demo agents within timeout; slow agent does not block.
  - Verify: curl POST /requests then GET /requests/:id shows quotes
  - Files: backend/src/lib/solicit.ts, backend/src/routes/marketplace.ts

- [ ] T-15 Index Delegated events -> a2a_calls paid + payments row; call JobEscrow.delegate from /a2a/call after budget check   owner: backend-engineer   wave: B   status: needs: T-07
  - Acceptance: allowed A2A call moves HBAR on chain; row marked `paid` only after indexed Delegated; blocked call stays 403.
  - Verify: testnet run (take .locks/chain); `GET /agreements/:id/a2a` shows paid + blocked
  - Files: backend/src/chain/indexer.ts, backend/src/chain/ops.ts, backend/src/routes/a2a.ts

- [ ] T-16 Remove any dev mark-funded endpoint; funded/released/refunded only from indexer   owner: backend-engineer   wave: B   status: ready
  - Acceptance: no route sets those states; grep clean.
  - Verify: `grep -rn "mark-funded" backend/src` is empty
  - Files: backend/src/routes/*.ts, backend/src/lib/stateMachine.ts

- [ ] T-17 Demo agent base template (Fastify, /quote, /tasks 202 + callback, backend helper, port 4101/4102)   owner: demo-agents-engineer   wave: A   status: ready
  - Acceptance: starts, answers /quote, accepts /tasks and posts a submission with x-agent-key to a stub backend.
  - Verify: `cd demo-agents && npm run dev` then curl /quote
  - Files: demo-agents/base/**, demo-agents/package.json

- [ ] T-18 Agent 1 "Solidity Builder" (capability solidity-build, NVIDIA codegen, README for benchmark)   owner: demo-agents-engineer   wave: B   status: needs: T-17, docs/contracts/agent-protocol.md
  - Acceptance: a task produces a plausible Solidity contract and submits inline.
  - Verify: curl /tasks on port 4101; submission arrives at backend
  - Files: demo-agents/solidity-builder/**

- [ ] T-19 Agent 2 "Static Auditor" (capability static-audit, structured findings)   owner: demo-agents-engineer   wave: B   status: needs: T-17
  - Acceptance: given contract code returns findings with severity.
  - Verify: curl /a2a or /tasks on port 4102 with sample contract
  - Files: demo-agents/static-auditor/**

- [ ] T-20 Agent 1 A2A behaviour: allowed hire of Agent 2 plus a "greedy" demo mode that is blocked   owner: demo-agents-engineer   wave: B   status: needs: T-18, T-19, T-15
  - Acceptance: one job shows one paid and one blocked entry in a2a_calls.
  - Verify: GET /agreements/:id/a2a
  - Files: demo-agents/solidity-builder/src/**

- [ ] T-21 Publish both demo agents as public GitHub repos   owner: human   wave: B   status: needs: T-18, T-19
  - Acceptance: public URLs with README listing capability; reported to integration-lead.
  - Verify: open URLs logged out
  - Files: (none in repo)

- [ ] T-22 Fund BACKEND_0G_PRIVATE_KEY from faucet.0g.ai   owner: human   wave: A   status: ready
  - Acceptance: key has Galileo balance; 0G upload works (T-03).
  - Verify: researcher upload spike succeeds
  - Files: (none; never print the key)

- [ ] T-23 Onboard and tune both agents until benchmark >= 80, listed   owner: demo-agents-engineer   wave: B   status: needs: T-21
  - Acceptance: both agents `listed` with visible report.
  - Verify: `curl $BACKEND/agents` shows status listed, score >= 80
  - Files: demo-agents/*/README.md, demo-agents/*/src/**

- [ ] T-24 Seed script (3 extra listed agents + sample requests, is_seeded)   owner: backend-engineer   wave: B   status: ready
  - Acceptance: marketplace shows 4-5 agents, seeded badge flag set, re-runnable.
  - Verify: `cd backend && npm run seed && curl /agents`
  - Files: backend/scripts/seed.ts, backend/package.json

## Frontend (parallel, Wave A scaffold then B)

- [ ] T-25 Design system and screen notes (landing, marketplace, list-agent, request, job page, fund)   owner: ui-designer   wave: A   status: ready
  - Acceptance: DESIGN_SYSTEM.md plus per-screen notes covering loading/error/retry states and the disclaimer line.
  - Verify: files exist under docs/design/
  - Files: docs/design/**

- [ ] T-26 Frontend setup: Next.js, Tailwind, wagmi custom chain 296, API client, amount helper (tinybar<->HBAR, no floats)   owner: frontend-engineer   wave: A   status: ready
  - Acceptance: app runs on 3000, calls /health, `150000000` -> `1.5 HBAR` and back.
  - Verify: `cd frontend && npm run build` and helper unit test
  - Files: frontend/**

- [ ] T-27 Wallet connect + SIWE-style login (nonce, sign, /auth/verify, session)   owner: frontend-engineer   wave: B   status: needs: T-01
  - Acceptance: MetaMask on chain 296 logs in, /me returns address, sign-out works.
  - Verify: manual in browser
  - Files: frontend/src/**

- [ ] T-28 Marketplace + agent detail with benchmark review   owner: frontend-engineer   wave: B   status: needs: T-01, T-25
  - Acceptance: agents with score, seeded badge, capability search, review text.
  - Verify: manual against running backend
  - Files: frontend/src/**

- [ ] T-29 List-an-agent flow with benchmark polling and report   owner: frontend-engineer   wave: B   status: needs: T-27
  - Acceptance: submit form, run benchmark, see progress, listed/failed with review.
  - Verify: manual list of one repo
  - Files: frontend/src/**

- [ ] T-30 Create request, quote list, accept   owner: frontend-engineer   wave: B   status: needs: T-27, T-14
  - Acceptance: request produces quotes, accept creates agreement with escrow address.
  - Verify: manual
  - Files: frontend/src/**

- [ ] T-31 Fund escrow via wagmi (value = toRpcValue), wait for backend `funded`   owner: frontend-engineer   wave: B   status: needs: T-30, T-07
  - Acceptance: MetaMask fund moves page to funded through the indexer only; never marks funded locally.
  - Verify: manual testnet fund (HBAR)
  - Files: frontend/src/**

- [ ] T-32 Job page: timeline, submission, checklist, verdict, payout/refund, A2A list incl. blocked reason, disclaimer   owner: frontend-engineer   wave: B   status: needs: T-31
  - Acceptance: a full job is readable from this page alone; shows "Automated verification is not a professional audit."
  - Verify: manual
  - Files: frontend/src/**

## Verification, security, QA, docs

- [ ] T-33 Verify retry on ERROR verdict (stays `verifying`, retry works, infra errors never FAIL); verdict -> release/refund via chain   owner: backend-engineer   wave: B   status: needs: T-08
  - Acceptance: forced NVIDIA failure yields ERROR and a retry; PASS triggers release, FAIL triggers refund; chain failure leaves state unchanged with retry.
  - Verify: tests plus testnet run with FAIL fixture
  - Files: backend/src/routes/jobs.ts, backend/src/lib/analyzer.ts, backend/src/chain/ops.ts

- [ ] T-34 ADR: escrow stuck in Submitted timeout   owner: architect   wave: A   status: ready
  - Acceptance: decision recorded; proposal handed to contracts-engineer via handoff if contract change wanted.
  - Verify: docs/adr/ file
  - Files: docs/adr/**

- [ ] T-35 ADR: chain_outbox vs no queue (human decides)   owner: architect   wave: A   status: ready
  - Acceptance: ADR states recommendation and the cost; flagged for human decision in status file.
  - Verify: docs/adr/ file
  - Files: docs/adr/**

- [ ] T-36 Contract change for Submitted timeout (if ADR T-34 accepted)   owner: contracts-engineer   wave: B   status: needs: T-34
  - Acceptance: refund/release path after timeout with tests; ABI re-exported (T-07 re-run).
  - Verify: `cd contracts && forge test`
  - Files: contracts/src/JobEscrow.sol, contracts/test/JobEscrow.t.sol

- [ ] T-37 Security review: money, auth, SSRF, signature replay, prompt injection from repos; findings file   owner: security-reviewer   wave: A   status: ready
  - Acceptance: docs/security/findings.md with severity and file:line; re-review after fixes T-09..T-12.
  - Verify: read findings.md
  - Files: docs/security/**

- [ ] T-38 Draft README, demo script (3-4 min), submission text from status files   owner: docs-writer   wave: A   status: ready
  - Acceptance: drafts exist; final pass after QA.
  - Verify: files exist; no claim without a status-file proof
  - Files: README.md, docs/demo-script.md, docs/submission.md

- [ ] T-39 QA golden path run: list both agents -> request -> quote -> accept -> fund -> A2A (paid + blocked) -> PASS -> release   owner: qa-engineer   wave: C   status: needs: T-23, T-32, T-33
  - Acceptance: run recorded with tx hashes in docs/qa/; bugs filed as handoffs.
  - Verify: docs/qa/golden-path.md
  - Files: e2e/**, docs/qa/**

- [ ] T-40 QA failure and adversarial runs: FAIL -> refund, ERROR retry, resubmit, settle by stranger, SSRF URL, overspend race   owner: qa-engineer   wave: C   status: needs: T-39
  - Acceptance: each case has expected vs actual.
  - Verify: docs/qa/adversarial.md
  - Files: e2e/**, docs/qa/**

- [ ] T-41 Finalize README, demo script, submission; record-ready   owner: docs-writer   wave: C   status: needs: T-39
  - Acceptance: reflects the verified run; submit at least 1 hour before 09:00 IST.
  - Verify: links and commands in README run
  - Files: README.md, docs/demo-script.md, docs/submission.md

## Cuttable (last, in cut order)

- [ ] T-42 x402 rail: verify header names/amount unit ([U]) then Agent 2 pay-per-call endpoint   owner: integration-researcher   wave: C   status: needs: T-41   (cuttable)
  - Acceptance: researcher result on /supported and header names in spike-results.md. Implementation would be a new task for demo-agents-engineer only if confirmed.
  - Verify: `curl https://api.testnet.blocky402.com/supported` output recorded
  - Files: docs/spike-results.md

- [ ] T-43 Dependency and security-review extra checks in analyzer   owner: backend-engineer   wave: C   status: needs: T-33   (cuttable)
  - Acceptance: dependency_check and security_review checks tick-able and reported.
  - Verify: `cd backend && npm test`
  - Files: backend/src/lib/customChecks.ts, backend/src/lib/analyzer.ts

- [ ] T-44 Third demo agent   owner: demo-agents-engineer   wave: C   status: needs: T-23   (cuttable)
  - Acceptance: third listed agent with score >= 80.
  - Verify: GET /agents
  - Files: demo-agents/third-agent/**

- [ ] T-45 Frontend polish: landing pitch, empty states, HashScan links   owner: frontend-engineer   wave: C   status: needs: T-32   (cuttable)
  - Acceptance: first-time viewer can follow the flow.
  - Verify: manual walkthrough
  - Files: frontend/src/**

- [ ] T-46 GitHub OAuth connect for private repos (env vars exist; verify GitHub docs first)   owner: backend-engineer   wave: C   status: needs: T-41   (cuttable)
  - Acceptance: /auth/github start+callback stores token for the user; public repo path unaffected.
  - Verify: manual OAuth round trip
  - Files: backend/src/routes/auth.ts, backend/src/lib/github.ts, backend/src/env.ts
