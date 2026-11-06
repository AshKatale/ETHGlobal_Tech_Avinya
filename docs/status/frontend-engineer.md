updated: 2026-11-06 (second pass)
state: partly done; waiting on backend api.md for new fields
second pass:
- DONE: AuditPanel (verdict, sig, nonce, deliverable hash, report root or 0G note, escrow, settle tx, copy + HashScan), DemoMoments (agent paid agent, blocked callout, refund callout), frontend/.env.example, frontend/CLICKTEST.md. Proof: build, lint, 8 tests pass; 9 routes 200.
- NOT DONE (api.md has no latestScore, quote agentName, A2A names/txHash, /config, /audit, /refund-timeout yet): task 1 audit log entries, task 3 replacing workarounds, task 4 stuck-escrow control. DemoMoments already reads optional callerName/calleeName/txHash if present.

first pass:
done:
- Phase 1: Next.js 15.5.28 App Router + TS + Tailwind 4 in frontend/, chain 296 config, money.ts (+ tests), useWallet hook. Proof: `npm run build`, `npm run lint`, `npm test` (8 tests incl. "150000000" -> "1.5") all pass.
- Phase 2 pages against api.md and docs/design/screens.md: / (marketplace, seeded badge, capability filter), /agents/[id] (benchmark review), /connect, /requests/new, /requests/[id] (quotes, accept dialog, fund escrow), /jobs, /jobs/[agreementId] (timeline, submission, verification, verdict/settle retry, payments, A2A with blocked reasons, HashScan links), /agents/new (API key shown once, benchmark polling), /agents/[id]/benchmark/[runId].
- Dev server run: all 9 routes return 200 (curl). No browser click-test; no wallet, backend not reachable at :4000 (returned 404 on /health).
in progress: none
blocked on: nothing hard
needs from others:
- backend-engineer (gaps from screens.md, workarounds in place, no invented fields): Agent has no latestScore on list (card shows "Benchmarked" badge instead); Quote has no agent name/score (N+1 GET /agents/:id); A2aCall has no names or tx hash; `items` shape of benchmark/verification undocumented (read defensively as {name, passed, detail}); no per-status timestamps; A2A cap percent not in API (UI assumes 30).
- A funded deployment: escrowAddress and a running backend are needed to click-test fund().
next: QA click-through with MetaMask on Hedera testnet once backend, seed data and escrow deploy exist.
notes:
- Import `injected` from "wagmi", not "wagmi/connectors" (barrel breaks the Next build).
- fund() uses gas 400000 (explicit) and value toRpcValue(priceTinybar). ABI fragment `function fund() payable` matches contracts/abi/JobEscrow.json.
- Versions pinned >= 2 weeks old (next 15.5.28, react 19.1.10, wagmi 2.19.5, viem 2.57.10). Hand-built Tailwind components instead of shadcn (no CLI install); tokens from DESIGN_SYSTEM.md.
