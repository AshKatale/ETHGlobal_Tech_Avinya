# AgentForge demo script (3 min 45 s)

DRAFT. Placeholders in `<angle brackets>` or `TODO(...)` wait for QA or the V2 deployment. Nothing here has been rehearsed against the final build: not yet verified.

Pitch line: "Escrow that thinks. HBAR is locked in a per-job contract, an AI agent does the work, the work is checked automatically, and money moves only on proof."

## Wallets and URLs
- Client wallet: `<client wallet, funded with testnet HBAR>` (MetaMask, Hedera testnet, chain 296)
- Frontend: http://localhost:3000 (or `<deployed URL>`)
- Backend: http://localhost:4000/health
- Agents: Solidity Builder :4101, Static Auditor :4102 (both listed in the marketplace)
- HashScan: https://hashscan.io/testnet
- Pre-created jobs for the fallback: `<job A id (PASS)>`, `<job B id (blocked call)>`, `<job C id (FAIL/refund)>` (from the QA run)

## Pre-flight checklist (do 30 minutes before)
- [ ] `curl localhost:4000/health` OK; backend started with `ALLOW_LOCAL_AGENTS=true`
- [ ] Both demo agents up (`/health` on 4101 and 4102) with `NVIDIA_API_KEY` set; both show as `listed` in the marketplace
- [ ] Client wallet has enough testnet HBAR for one job plus gas; MetaMask on chain 296; a second wallet or the agent owner view ready only if needed
- [ ] Relayer and verifier accounts funded (check HashScan); no one else holds `.locks/chain`
- [ ] Indexer is running and caught up (a recent test job shows `funded` within seconds)
- [ ] NVIDIA API reachable (one test verification)
- [ ] V2 factory address configured in the backend: `TODO(V2)`; if V2 is not deployed, drop moments about the on-chain cap and the review-window refund and say V1 limits aloud (see README, Honest limits)
- [ ] 0G key funded? If not, do not claim 0G storage; say reports are database-only
- [ ] Tabs open, in order: marketplace, a finished PASS job page, a finished refund job page, HashScan factory page, README
- [ ] Browser zoom 125 percent, notifications off, screen recording running
- [ ] Backup recording file open in a player (see plan below)

## Timeline

| Time | On screen | Say | Wallet / URL | If it breaks |
|---|---|---|---|---|
| 0:00 to 0:20 | Marketplace with the two agents and their benchmark badges | "Hiring an AI agent today means paying first and hoping. AgentForge is escrow that thinks: money is locked in a contract, and only moves when the work is proven." | `/` | Show the README pitch and the architecture diagram instead. |
| 0:20 to 0:50 | Connect wallet, post a request for a small ERC-20 token contract, accept the Solidity Builder quote | "I sign in with my wallet, post a job, and accept a quote. The backend creates a fresh escrow contract just for this job." | Client wallet; `/connect`, `/requests/new`, `/requests/<id>` | Open the pre-created job A and say "this is the same step from an earlier run". |
| 0:50 to 1:15 | Fund escrow: MetaMask confirm, job page shows `Funded` with the escrow address and fund tx link | "I lock the price in HBAR from my own wallet. The page flips to Funded only when the chain event is indexed, not when I click." | Client wallet; `/jobs/<agreementId>` | If MetaMask stalls, open job A at its Funded step and the HashScan fund tx `<QA fund tx hash>`. |
| 1:15 to 2:00 | A2A card: Builder hires Static Auditor, call shows `paid` then `done`; payment row with tx link | "Moment one. The agent subcontracts. Builder hires Static Auditor and pays it from the job's escrow, not from my wallet. The contract signs off each payment and, in V2, refuses to let the total pass 30 percent of the price." | `/jobs/<agreementId>` A2A card; HashScan `<QA delegate tx hash>` | Open job A; if A2A did not run live say "the call takes up to 90 seconds; here is the finished one". |
| 2:00 to 2:20 | Same card: second hire shown as `blocked` with the reason "Would exceed the 30% A2A budget" | "Moment two. The agent tries to hire again. That would pass the cap, so it is blocked, and no money moves." (Run with `DEMO_OVERBUY=true`.) | A2A card, job B `<job B id>` | Show job B directly. Do not claim an on-chain `CapExceeded` revert unless `<QA CapExceeded evidence>` exists. |
| 2:20 to 2:50 | Submission and verification checklist: items passed, verdict PASS, verifier signature and hash fields | "The agent submits. Nemotron on NVIDIA plus mechanical checks review it against my requirements. The platform verifier signs the verdict. This is AI plus checks, not a professional audit." | `/jobs/<agreementId>` | Show job A's finished verification. If NVIDIA is down: "an infrastructure error is never a FAIL; it shows a retry". |
| 2:50 to 3:10 | Status `Released`; HashScan release tx; point at the verifier address | "The contract checks that signature itself and releases the HBAR to the agent. Anyone can verify this on HashScan." | HashScan `<QA PASS tx hash>`; verifier `0x2d879491dA59A0F5AA95ef719f3d3c679c08E37F` | Use the V1 release tx from `docs/spike-results.md` (earlier test run) and say so. |
| 3:10 to 3:35 | Job C: bad work submitted, verdict FAIL, status `Refunded`, refund tx | "Moment three. Here the agent delivered work that fails the requirements. The verdict is FAIL and the contract refunds me automatically." | Job C `<job C id>`; HashScan `<QA refund tx hash>` | Use the V1 refund tx from `docs/spike-results.md` (earlier test run) and say so. |
| 3:35 to 3:45 | README honest limits and the V2 line | "Honest limits: one platform verifier key today; roadmap is multi-signer and TEE-verified inference on 0G. If the verifier never answers, V2 lets anyone refund me after a review window." | README | If V2 is not deployed, say "V2 is written and tested, not yet deployed" only if that is still true. |

Total 3 min 45 s. Cut order if running long: the sign-in step (use an already signed-in session), then the moment-three setup.

## Rules for the presenter
- Do not say "trustless". Say "platform-verified, checkable on-chain".
- Do not mention 0G storage unless a real upload was seen (`TODO(QA)`).
- Do not show the on-chain cap as live until V2 is deployed and `hederaTestnetV2` is in `contracts/deployments.json`.
- If an agent call is slow, narrate the architecture rather than waiting in silence.

## Backup recording plan
1. After QA completes a real run of all three moments, screen-record it at 1080p with narration track off; keep job ids and tx hashes visible. Name it `backup-real-run-<date>.mp4`.
2. Record twice: a full one-take and a cut with the timings above. Store both locally and in `<cloud link>`.
3. The recording must be of a real run, not mocked. Label it as a recording in the demo ("this is a recording of an earlier real run") if used.
4. If the live demo fails at any step, switch to the recording at the same step, not the start.
5. Upload the demo video link to the submission: `TODO(link)`.
