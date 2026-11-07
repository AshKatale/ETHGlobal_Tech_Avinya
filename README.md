# Attestra

**Hire benchmark-verified AI agents. Lock HBAR in a per-job smart contract. Pay only when the work passes verification.**

Built for ETHGlobal Mumbai. Everything runs on **Hedera testnet**. All payments are in **HBAR**.

> **Testnet only.** This is a hackathon MVP. The contracts are not audited, and the AI verification is not a professional
> security audit. Never use a funded or personal wallet with it.

---

## What it does

A marketplace where AI agents are listed, hired and paid on-chain.

- **Benchmark-gated listing.** A lister connects a GitHub repo (public, or private through GitHub OAuth). The backend
  reads the code, runs plain-code checks, and has an NVIDIA-hosted model review it. Score >= 80/100 lists the agent.
- **One contract per job.** When a client accepts a quote, a **Solidity designer agent** analyses the requirement and the
  provider's track record, designs bounded contract terms, and deploys a `TaskEscrow` for that job on Hedera.
- **HBAR escrow.** The client locks the price in the contract (from a wallet with `fund()`, or over x402).
  Money states in the database change only after the on-chain event is indexed.
- **Verified delivery.** When the agent submits, the work is checked against a checklist generated from the client's
  requirement, plus the code and security checks the client ticked. A platform key signs the verdict (EIP-712).
  PASS releases the HBAR to the agent. FAIL, or a missed deadline, refunds the client.
- **Agent-to-agent (A2A) payments.** The hired agent can hire a sub-agent inside the same job (max 2 hops). The
  sub-agent's price is added as a leg of the contract, capped as a share of the job price. After release, the hiring
  agent pays the sub-agent over **Hedera x402**, and the contract records the receipt. An unpaid debt is marked
  defaulted on-chain after a grace period and counts against that agent's trust score.

If an external service is down (NVIDIA, GitHub, the chain, 0G), the app shows an error and lets you retry. An outage
never produces a FAIL verdict, and nothing is faked.

---

## How a job flows

```
requested -> quoted -> agreed -> funded -> submitted -> verifying -> released | refunded
```

1. **Client posts a request**: requirements, budget in HBAR, deadline, and which checks to run
   (`build_config`, `lint_rules`, `secrets_scan`, `dependency_check`, `security_review`).
2. **Agents quote.** The backend asks listed agents (their `POST /quote`); listers can also quote by hand.
3. **Client previews the terms** the designer would set, then **accepts a quote**. The designer deploys the `TaskEscrow`.
4. **Client funds** the contract: `fund()` from MetaMask, or an x402 payment through the gateway.
5. The indexer sees the `Funded` event and sets the job to `funded`. The backend then tells the agent to start
   (`POST {agent}/tasks`). Agents behind NAT can poll `GET /agent/tasks` instead.
6. The agent may **hire a sub-agent** (`POST /a2a/quote`, then `POST /a2a/call`).
7. The agent **submits** the work (`POST /agreements/:id/submit`). Verification starts automatically.
8. The verifier key signs the verdict, and the relayer calls `release` or `refund`. The indexer sets `released` or
   `refunded`.
9. After release, the hiring agent pays each sub-agent over x402. The backend records the Hedera transaction id on the
   contract.

### Where things live

| Chain / service | Holds |
|---|---|
| **Hedera testnet** (chain id 296) | `TaskFactory`, one `TaskEscrow` per job, all HBAR, x402 payments |
| **Neon Postgres** | users, agents, requests, quotes, agreements, verifications, verdicts, sub-legs, chain events |
| **NVIDIA API** (OpenAI-compatible) | benchmark review, checklist generation, verification judgement, agent LLM calls |
| **0G Storage** (optional) | reports. Without a 0G key they stay in Postgres |
| **GitHub** | repo contents for benchmarks and verification |

### Hedera notes

- Amounts are **tinybar** in code and the database (`bigint` / `numeric(38,0)`). 1 HBAR = 100,000,000 tinybar.
- Inside Solidity `msg.value` is tinybar, but wallets and JSON-RPC send **weibar** (tinybar x 10^10). Never use
  `1 ether` in a contract.
- Paying an address that does not exist on Hedera yet auto-creates it and costs about 600k extra gas, so payout calls
  use a high gas limit.
- An x402 payment is an account-to-account transfer signed by the payer, so it cannot come out of a contract. That is
  why the hiring agent pays its sub-agent itself, and the contract only records the receipt.

---

## Repository layout

Separate projects, each with its own `package.json`. There is no monorepo tooling.

| Folder | What it is | Default port |
|---|---|---|
| `backend/` | Fastify + Zod API, Drizzle on Postgres, chain client (viem), mirror-node indexer, x402 gateway | 4000 (API), 4402 (gateway) |
| `contracts/` | Foundry project: `TaskEscrow`, `TaskFactory` (Solidity 0.8.24) | - |
| `solidity-agent/` | The designer agent: scores trust, designs the terms, deploys the task contract | 5001 |
| `live-agents/` | Five single-prompt NVIDIA agents, one server each (Solidity dev, auditor, test writer, docs writer, dApp dev) | 5101-5105 |
| `demo-agents/` | The Static Auditor agent (reviews code in any language) | 5002 |
| `frontend/` | Next.js 16 app, wagmi + viem, MetaMask on Hedera testnet | 3000 |
| `design/` | Static HTML prototype used as the UI reference | - |
| `docs/` | Architecture and build-plan docs (written mid-project; the code is the source of truth where they differ) | - |

---

## Quick start

### Prerequisites

- Node.js 22 or newer
- A **Neon** (or any PostgreSQL 16) database URL
- **Foundry**, only if you want to build or test the contracts: `curl -L https://foundry.paradigm.xyz | bash`, then `foundryup`
- An **NVIDIA API key** (OpenAI-compatible endpoint)
- Two **ECDSA** Hedera testnet accounts with testnet HBAR from the [Hedera faucet](https://portal.hedera.com/faucet): a
  *relayer* (pays gas) and a *verifier* (signs verdicts; needs no HBAR). Use hex-encoded private keys and testnet
  accounts only.
- MetaMask, for funding a job from the browser
- Optional: a GitHub OAuth app (private repos) and a funded 0G testnet key (report storage)

### 1. Backend

```bash
cd backend
npm i
cp .env.example .env      # then fill it in (see "Configuration")
npm run db:push           # creates the tables
npm run dev               # API on PORT (default 4000), x402 gateway on GATEWAY_PORT (default 4402)
```

Check it: `curl http://localhost:4000/health`

### 2. Solidity designer agent

```bash
cd solidity-agent
npm i
cp .env.example .env      # DESIGNER_PRIVATE_KEY, TASK_FACTORY_ADDRESS, AGENT_SHARED_SECRET, NVIDIA_API_KEY
npm run dev               # port 5001
```

`AGENT_SHARED_SECRET` must equal `SOLIDITY_AGENT_SECRET` in `backend/.env`. The designer wallet is the only address
allowed to deploy task contracts, and it needs HBAR for gas.

### 3. List agents and run them

```bash
# in backend/: lists the five live agents (creates payout accounts, API keys) - safe to re-run
npm run seed:agents

cd ../live-agents
npm i
cp .env.example .env      # BACKEND_URL, BACKEND_SECRET (must match backend/.env), NVIDIA_API_KEY
npm run all               # starts all five agents (5101-5105)
```

Optional extra agent: `cd demo-agents && npm i && cp .env.example .env && npm run auditor` (needs the `AGENT_KEY` that
`POST /agents` returned when the agent was created).

### 4. Frontend

```bash
cd frontend
npm i
cp .env.example .env.local   # NEXT_PUBLIC_API_URL, NEXT_PUBLIC_GATEWAY_URL, NEXT_PUBLIC_HEDERA_RPC
npm run dev                  # http://localhost:3000
```

If your backend runs on a port other than 4000, set `NEXT_PUBLIC_API_URL` to match.

### 5. Try the whole flow without the UI

With the backend, designer and live agents running and agents seeded:

```bash
cd backend
npm run live-flow       # post a job -> quotes -> accept -> fund over x402 -> work -> verify -> release -> sub-agent paid
npm run flow            # older end-to-end script using a local stub sub-agent
```

These spend a little testnet HBAR from the relayer account. Use `API_URL` and `GATEWAY_URL` to point at non-default ports.

---

## Configuration

Every service has a `.env.example`. Copy it to `.env` and fill it in. **Never commit `.env` or private keys.**

Main `backend/.env` values:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string (Neon needs `?sslmode=require`) |
| `PORT`, `CORS_ORIGIN`, `API_PUBLIC_URL` | API port, allowed browser origin, URL agents use to call back |
| `RELAYER_PRIVATE_KEY` | Testnet key that pays gas for escrow calls |
| `VERIFIER_PRIVATE_KEY` | Testnet key that signs verdicts and sub-leg approvals |
| `NVIDIA_API_KEY` (+ `NVIDIA_BASE_URL`, `NVIDIA_MODEL`) | AI for benchmark, verification and checklists |
| `SOLIDITY_AGENT_URL`, `SOLIDITY_AGENT_SECRET` | Where the designer agent lives, and the shared secret for `/deploy` |
| `BACKEND_SECRET` | Optional. Sent to agents as `x-backend-secret`; each agent must use the same value |
| `X402_FACILITATOR_URL`, `GATEWAY_PORT`, `GATEWAY_PUBLIC_URL` | x402 gateway (testnet facilitator by default) |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_CALLBACK_URL`, `FRONTEND_URL` | Optional GitHub OAuth for private repos |
| `GITHUB_TOKEN` | Optional. Raises GitHub's 60 requests/hour unauthenticated limit |
| `BACKEND_0G_PRIVATE_KEY` | Optional. Stores reports on 0G Storage; otherwise they stay in Postgres |
| `BENCHMARK_PASS_SCORE`, `BENCHMARK_CUSTOM_WEIGHT` | Pass mark (default 80) and the share of the score from plain-code checks (default 0.4) |
| `INDEXER_ENABLED` | Set to `false` to turn off the mirror-node indexer |

---

## Smart contracts

Solidity 0.8.24, Foundry, `evm_version = "paris"`. See [contracts/README.md](contracts/README.md).

- `TaskFactory`: only the designer can deploy; it enforces hard bounds on the dynamic terms.
- `TaskEscrow`: one contract per task. `fund` / `confirmFunding`, `submit`, `release`, `refund`, `refundAfterDeadline`,
  `addSubLeg`, `recordPayout`, `markDefault`. Verdicts and sub-leg approvals are EIP-712 messages signed by the verifier;
  the signature domain includes the contract address, so a signature cannot be replayed on another task. Nonces are
  single use.
- Deployed addresses: [contracts/deployments.json](contracts/deployments.json).

```bash
cd contracts
forge install foundry-rs/forge-std --no-git   # first time only
forge build
forge test
```

---

## Authentication

Sign in with a wallet: the backend issues a nonce, the wallet signs it, and `POST /auth/verify` returns a session token
(sent as `Authorization: Bearer <token>`). Accounts can also add an email and password (`POST /auth/signup`) as a second
factor. Agents authenticate to the backend with their own API key in the `x-agent-key` header (shown once when the
agent is created).

For API testing without a wallet UI: `cd backend && npm run token` prints a login token. A Postman collection is in
[backend/postman/AgentForge.postman_collection.json](backend/postman/AgentForge.postman_collection.json).

---

## API overview

| Area | Endpoints |
|---|---|
| Auth and account | `POST /auth/nonce`, `/auth/verify`, `/auth/signup`; `GET/PATCH /me`, `POST /me/password`, `GET /me/summary` |
| Agents | `POST /agents`, `GET /agents`, `GET /agents/mine`, `GET /agents/:id`, `POST /agents/:id/unlist` |
| Benchmark | `POST /agents/:id/benchmark`, `GET /agents/:id/benchmark/:runId`, `GET /agents/:id/benchmarks` |
| GitHub | `GET /github/connect`, `/github/callback`, `/github/status`, `/github/repos`; `DELETE /github/connection` |
| Requests and quotes | `POST /requests`, `GET /requests`, `GET /requests/:id`, `POST /requests/:id/request-quotes`, `POST /requests/:id/quotes` |
| Agreements | `POST /quotes/:id/terms` (preview), `POST /quotes/:id/accept`, `GET /agreements`, `GET /agreements/:id`, `/design`, `/funding`, `/payouts`, `POST /agreements/:id/escrow` and `/dispatch` (retries) |
| Delivery | `POST /agreements/:id/submit`, `POST /agreements/:id/verify`, `GET /agreements/:id/verification`, `POST /agreements/:id/settle` (retry) |
| Agent-to-agent | `POST /a2a/quote`, `POST /a2a/call`, `GET /agreements/:id/a2a` |
| Agent polling | `GET /agent/requests`, `GET /agent/tasks` |
| x402 gateway (port 4402) | `GET /x402/fund/:agreementId`, `GET /x402/settle/:agreementId/:legId` |

### Writing your own agent

An agent is an HTTP server that implements:

- `POST /quote` with `{ requirements, ... }`, returning `{ priceTinybar, etaHours }` or `{ decline: true }`
- `POST /tasks` with `{ agreementId, requirements, checks }`, returning `202`; later it calls the backend's
  `POST /agreements/:id/submit` with its `x-agent-key`
- `POST /a2a` (optional) to be hired by another agent

Text deliverables can carry several files using `// FILE: path` marker lines, so the structural checks can see
`foundry.toml`, `.solhint.json` and similar files. See [demo-agents/static-auditor/README.md](demo-agents/static-auditor/README.md)
and `live-agents/` for working examples.

---

## Frontend pages

Landing, marketplace, agent detail, list-an-agent wizard (with GitHub connect and the benchmark report), post a job,
request page (quotes and a contract-terms preview before accepting), job page (timeline, submission, verification
checklist, verdict, payout or refund, A2A calls, on-chain proof), dashboard and account.

---

## Tests and checks

```bash
cd backend       && npm test && npm run typecheck
cd solidity-agent && npm test && npm run typecheck
cd contracts      && forge test
cd frontend       && npm run typecheck
```

On Windows, if `vitest` fails with "Cannot find native binding", the lockfile was created on another OS. Run
`npm i --no-save @rolldown/binding-win32-x64-msvc@<installed rolldown version>`.

---

## Known limits

- **Testnet only.** The contracts have had no external audit.
- AI verification reads code. It does not compile, run or test it, and it can miss real bugs or flag ones that are not
  real. The UI says: "Automated verification is not a professional audit."
- GitHub access tokens are stored as plain text in Postgres in this MVP.
- Unauthenticated GitHub calls are limited to 60 per hour. Connect GitHub or set `GITHUB_TOKEN`.
- 0G Storage is optional. Without a funded key, reports stay in Postgres only.
- Seeded demo agents are marked as seeded and have no benchmark run.
- Docs in `docs/` and the `CLAUDE.md` / `AGENTS.md` files describe earlier plans in places (USDC, a monorepo, a
  spec-first process). Where they disagree with the code, trust the code.
