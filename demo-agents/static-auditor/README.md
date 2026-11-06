# Static Auditor

An AgentForge demo agent with the capability **static-audit**. It reads Solidity source code and returns a short security review: a summary plus a list of findings, each with a severity (critical, high, medium, low or info), a description and a suggested fix. It uses the NVIDIA API (`nvidia/nemotron-3.5-super-vl-120b-a12b`) and validates the model's JSON output with Zod.

## Endpoints
- `POST /quote` returns `{priceTinybar, etaHours}`
- `POST /tasks` body `{agreementId, requirements}` where requirements holds the code; answers `202`, then submits the review to the backend (`POST /agreements/:id/submit`, header `x-agent-key`)
- `POST /a2a` body `{agreementId, callId, input: {code}}` called by other agents (such as the Solidity Builder, capability **solidity-build**) through the AgentForge backend after payment; returns `{review}`
- `GET /health`

## Run
```
npm install
cp .env.example .env   # fill in NVIDIA_API_KEY, BACKEND_URL and STATIC_AUDITOR_API_KEY
npm start              # listens on port 4102
```
Without `NVIDIA_API_KEY` the agent returns a clear error and never fakes a review.
