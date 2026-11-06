# Manual click-test (MetaMask, Hedera Testnet)

For a human. The wallet flows were build-verified only; nobody has driven them in a browser.

## Prerequisites
- Backend on http://localhost:4000 (`ALLOW_LOCAL_AGENTS=true` if using the demo agents), seeded with `npm run seed` in `backend/`.
- A deployed escrow factory configured in the backend, and a funded Hedera testnet account (use a testnet-only account).
- Frontend: `cp .env.example .env.local`, `npm install`, `npm run dev`, open http://localhost:3000.
- Browser with MetaMask.

## Checklist
| # | Step | Expected result |
|---|------|-----------------|
| 1 | Open `/` | Marketplace lists the seeded agents with a "Seeded demo data" badge. If the backend is down you see an error panel with Retry, not a blank page. |
| 2 | Open `/connect`, click Connect | MetaMask prompts to connect. After approval the address shows in the header. |
| 3 | Add network (if prompted) | MetaMask asks to add "Hedera Testnet": chain id 296, currency HBAR, RPC https://testnet.hashio.io/api, explorer https://hashscan.io/testnet. Approve and switch. |
| 4 | Sign in | MetaMask shows a signature request (no gas). After signing you are signed in; reload the page and you stay signed in. |
| 5 | `/agents/new`: list an agent (name, description, capability, price, repo URL) | The agent is created, an API key is shown once (copy it), and the benchmark status polls from running to passed or failed. |
| 6 | `/requests/new`: create a request with a budget | Request page opens; quotes appear within about 15 s from listed agents that have an endpoint. |
| 7 | Accept a quote | Agreement is created and an escrow contract address appears. If it shows an escrow error, use the retry. |
| 8 | Fund 1 HBAR (price of the quote, use a 1 HBAR quote) | MetaMask shows a `fund()` transaction with value 1 HBAR. Confirm. The page shows "Waiting for confirmation" and never "funded" locally. |
| 9 | Wait for the indexer | Within a minute status flips to `funded` by itself (the page polls). Timeline shows "Escrow funded" with a HashScan link that opens the transaction. |
| 10 | Open `/jobs/<id>` | Timeline, submission, verification, payments, A2A sections render. The text "Automated verification is not a professional audit." is visible. |
| 11 | Agent submits work, verification runs | Status goes submitted, verifying; then a PASS or FAIL with a checklist. An infrastructure problem shows "Verification could not run ... not a fail" with Retry, never FAIL. |
| 12 | PASS path | Audit trail panel shows verdict, shortened verifier signature, nonce, deliverable hash, settle transaction link. Status becomes `released`. Copy buttons copy full values. |
| 13 | Refund path (submit bad work so the verdict is FAIL) | Red callout "Work failed verification, funds returned to the client" with a refund transaction link. Status `refunded`. |
| 14 | Agent-to-agent | If the demo agent hires another agent: green "Agent paid agent" card with names, amount and tx link. An over-budget attempt shows the yellow "Blocked by the 30% budget rule" callout with the reason, and no payment. |
| 15 | Stuck escrow (only once the refund-timeout control is present) | On a submitted or verifying job as the client, "No verdict yet? Claim your refund" appears. Before the review window ends it says how much time remains. |
| 16 | Sign out | Wallet button signs out; `/jobs` asks you to connect. |
| 17 | Stop the backend, reload `/jobs/<id>` | Error panel with a Retry button; clicking Retry works after the backend returns. |
