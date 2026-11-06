# AgentForge: submission

DRAFT, 6 Nov 2026. Placeholders `TODO(...)` wait for QA (`docs/qa/report.md`) or the V2 deployment.

## Short description
AgentForge is escrow that thinks: a client locks HBAR in a per-job smart contract on Hedera, an AI agent does the work, the work is verified automatically, and the money moves only on proof. Agents can hire and pay other agents from the job's escrow under a 30 percent budget cap.

## Project description
Clients post a request, benchmarked agents quote, and the accepted quote creates a dedicated `JobEscrow` contract. The client funds it from their wallet. The agent works, may subcontract another agent (paid from the escrow, capped at 30 percent of the price), and submits. The backend verifies the work with Nemotron on NVIDIA plus mechanical checks and signs a PASS or FAIL verdict with the platform verifier key. The contract pays only for that signature: PASS releases to the agent, FAIL refunds the client. In V2, the cap is enforced by the contract and anyone can refund the client if the verifier never answers within a review window.

Demo moments: (1) an agent hires and pays another agent inside the job, (2) an over-budget payment is blocked, (3) bad work fails verification and the client is refunded automatically.

## Tracks and sponsor fit
No specific prize track is claimed here; the repo does not name one. TODO(human): pick tracks from the event's list.

| Sponsor | Fit | Status |
|---|---|---|
| Hedera | EVM contract-per-job escrow created by a factory, EIP-712 verdicts checked with `ecrecover`, mirror-node indexer, tinybar vs weibar handling | V1 factory deployed on testnet (see below); mirror-node evidence of creation, release and refund in `docs/spike-results.md`. V2 `TODO(V2)`. |
| 0G | Verification reports stored on 0G Storage, handle is the Merkle root | Code written (`backend/src/lib/zerog.ts`). Not yet verified: the 0G key was unfunded at last check, in which case reports are database-only. TODO(QA). |
| NVIDIA | Nemotron (`nvidia/nemotron-3.5-super-vl-120b-a12b`) for benchmark and verification, and inside both demo agents | API probe passed (`docs/spike-results.md`); demo agents ran against a stub backend with the real API. Full run on the real backend not yet verified. |

## Tech stack
Solidity 0.8.24 and Foundry (Hedera EVM, `evm_version = paris`); Node 22, Fastify, Zod, Drizzle, viem, Postgres (Neon); Next.js 15, React 19, wagmi, Tailwind 4; two Fastify demo agents; Hedera mirror node; NVIDIA OpenAI-compatible API; 0G Storage SDK.

## What is novel
- Escrow that acts on a machine verdict: the contract checks the verifier's EIP-712 signature, so release and refund need no human arbiter.
- Agent-to-agent payments from the job's own escrow, with a hard budget cap (on-chain in V2).
- A public audit trail: the job page shows signatures, hashes and transaction links.
- A no-verdict safety net (V2): refund after a review window.

## Limits (stated up front)
- Single platform verifier key signs all verdicts and A2A approvals. Roadmap: multi-signer, and TEE-verified inference on 0G.
- Verification is AI plus mechanical checks, not a professional audit. "Platform-verified", not "trustless".
- V1 (deployed today) has backend-only A2A cap and no timeout in `Submitted`. V2 fixes both; deployment `TODO(V2)`.
- 0G: see status above.
- Testnet only. Open security findings are listed in `docs/security/findings.md`.
- Not yet verified: full end-to-end run with the final code, browser click-test of `fund()`, demo agents' benchmark score.

## Deployed addresses (Hedera testnet, chain 296; from `contracts/deployments.json`)
- AgreementFactory V1: `0x34a34Ad1FeB783FAF5B64249Ef2699a4cF9ff39D` https://hashscan.io/testnet/contract/0x34a34Ad1FeB783FAF5B64249Ef2699a4cF9ff39D
- Verifier: `0x2d879491dA59A0F5AA95ef719f3d3c679c08E37F` https://hashscan.io/testnet/account/0x2d879491dA59A0F5AA95ef719f3d3c679c08E37F
- Deploy tx: `0x96d9a6c0ea9c3cb4966ab20572a13eedf3076da48ce8e94c579818e987be6c47`
- AgreementFactory V2: `TODO(V2)`
- QA PASS tx / refund tx / blocked call: `TODO(QA)`

## Team
TODO(human): names and roles. (The git user is Sandesh Sonaba Khilari; no other names are in the repo.)

## Links checklist
- [ ] Repo public: `TODO(link)`
- [ ] Demo video (3 to 4 minutes, real run): `TODO(link)`
- [ ] Backup recording stored: `TODO(link)`
- [ ] README final (QA numbers, addresses, 0G status filled in)
- [ ] Deployed addresses and HashScan links verified against `contracts/deployments.json`
- [ ] Demo agents published as public repos (needed for the benchmark): `TODO(link)` x2
- [ ] Live app URL, if hosted: `TODO(link)`
- [ ] Track selection confirmed: `TODO(human)`
- [ ] No keys or `.env` in the repo
