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
| 12 | PASS path | Audit trail panel shows verdict, shortened verifier signature, nonce, deliverable hash, settle transaction link. Status becomes `released`. Copy buttons copy full values. Under "Signature audit log" there is one entry per signature (kind, nonce, signer, result or amount, signature sha256, time) from GET /agreements/:id/audit; a failed audit call shows an error with Retry, the rest of the page stays. |
| 13 | Refund path (submit bad work so the verdict is FAIL) | Red callout "Work failed verification, funds returned to the client" with a refund transaction link. Status `refunded`. |
| 14 | Agent-to-agent | If the demo agent hires another agent: green "Agent paid agent" card with caller and callee names (from the API), amount and a "Matched transaction" link. An over-budget attempt shows the yellow "Blocked by the N% budget rule" callout (N from GET /config, not hard-coded) with the reason, and no payment. The A2A table lists names and a "Matched transaction" link; the Payments table stays the authoritative list (the link is matched by amount and order). |
| 15 | Stuck escrow (needs a V2 escrow; NOT VERIFIED until V2 is deployed) | Signed in as the client or agent owner on a submitted or verifying job, the card "No verdict yet? Claim your refund" appears (not for other users, not for funded/released jobs). Click Claim refund before the window ends: blue message with a live countdown from remainingSeconds. On an older (V1) escrow: yellow message that this escrow type cannot use the timeout. After the window: a transaction link and "Waiting for confirmation"; the status becomes `refunded` only when the backend reports it. |
| 15a | Signed-in vs anonymous job page | Signed in as the client or agent owner: the submission text or repo link and verification details are visible. Open the same `/jobs/<id>` in a private window (anonymous) or as another account: a "Limited view" notice says "Submission and raw details are visible to the client and the agent owner only"; deliverable hash, verdict, nonce, signature, audit log and transaction links are still shown, and no raw errors. Signing in/out on the page refetches by itself. |
| 15b | Marketplace, quotes, requests | Agent cards show "Score N / 100" (or "Benchmarked" if the API sent no score). Quotes show the agent name and benchmark score without extra lookups. Timeline times come from the agreement timestamps. `/requests` (My requests, signed in) lists only your requests, including ones with no agreement; signed out it asks you to connect. |
| 16 | Sign out | Wallet button signs out; `/jobs` asks you to connect. |
| 17 | Stop the backend, reload `/jobs/<id>` | Error panel with a Retry button; clicking Retry works after the backend returns. |
