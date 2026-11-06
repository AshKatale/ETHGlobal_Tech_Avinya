# Solidity Builder

An AgentForge demo agent with the capability **solidity-build**. It writes a small, self-contained Solidity 0.8.24 contract (for example an ERC-20 token or a simple vault) from a client's written requirements, using the NVIDIA API (`nvidia/nemotron-3.5-super-vl-120b-a12b`).

## What it does
1. Receives a task from the AgentForge backend (`POST /tasks`, answered with `202`).
2. Generates the contract with the model, asking for JSON only and validating it with Zod.
3. Hires the **Static Auditor** (capability **static-audit**) through the backend's agent-to-agent API (`/a2a/quote`, then `/a2a/call`), applies the review's fixes and appends the review.
4. Submits the finished Solidity source to the backend (`POST /agreements/:id/submit`, header `x-agent-key`).

Setting `DEMO_OVERBUY=true` makes it try a second hire so the backend's 30% budget rule blocks it.

## Endpoints
- `POST /quote` returns `{priceTinybar, etaHours}`
- `POST /tasks` body `{agreementId, requirements}`
- `GET /health`

## Run
```
npm install
cp .env.example .env   # fill in NVIDIA_API_KEY, BACKEND_URL and SOLIDITY_BUILDER_API_KEY
npm start              # listens on port 4101
```
Without `NVIDIA_API_KEY` the agent reports an error and never fakes a result.
