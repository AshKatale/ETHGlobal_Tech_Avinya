updated: 2026-11-06 (Wave A)
state: blocked (human steps remain; code done)
done:
- demo-agents/solidity-builder (port 4101) and demo-agents/static-auditor (port 4102): Fastify + Zod + NVIDIA helper (nvidia/nemotron-3.5-super-vl-120b-a12b, chat_template_kwargs enable_thinking=false, JSON-only, lenient repair, one retry). `npm run typecheck` clean in all three packages.
- Built to docs/contracts/agent-protocol.md v1 and docs/contracts/api.md: /quote, /tasks (202, dedupe on agreementId, submit retry 3x on 5xx, 409 final), /a2a (dedupe on callId), optional x-backend-key check when AGENT_CALLBACK_SECRET is set.
- Proof against a local STUB backend (demo-agents/scripts/stub-backend.ts) with the real NVIDIA API: Builder wrote a SimpleVault contract, hired the Auditor (a2a quote allowed, call done, review folded in), a second hire (DEMO_OVERBUY=true) was blocked "Would exceed the 30% A2A budget", then it submitted. Stub state showed one `done` and one `blocked` call and one submission. Auditor /tasks also produced and submitted a review; /a2a bad body returns 400.
- scripts/register.ts ran against the stub (login, create both agents, keys written to env file, rerun skips).
- Benchmark readiness: ran backend/src/lib/customChecks.ts benchmarkChecks over both folders: 4/4 pass each (readme, entry, manifest, capability keywords).
in progress: nothing
blocked on: human (publish demo-agents/solidity-builder and demo-agents/static-auditor each as its own public GitHub repo; then set SOLIDITY_BUILDER_REPO / STATIC_AUDITOR_REPO and run the benchmark so they become `listed`)
blocked on: human (copy NVIDIA_API_KEY into the gitignored demo-agents/.env yourself; copy demo-agents/.env.example to start)
blocked on: backend-engineer (nothing yet calls POST /tasks after funding, nothing calls POST /quote; real a2a_calls paid/blocked rows need escrow + delegate working)
needs from others: none open
next: when backend dispatch exists and the agents are listed: run `cd demo-agents && npm run register`, start both agents, run a real job, confirm one paid and one blocked row in a2a_calls.
NOT VERIFIED: runs against the real backend; real `paid` status (needs chain); the AI half of the benchmark score (>= 80); x-backend-key flow; agent-key header on real backend.
Notes: demo-agents/.env.example holds empty values. Prices default to 10 HBAR (builder) and 2 HBAR (auditor, 20% of the job) so one hire passes and a second exceeds 30%. Builder finds the auditor via GET /agents?capability=static-audit unless STATIC_AUDITOR_AGENT_ID is set. Auditor must be `listed` for /a2a/quote to allow it.
