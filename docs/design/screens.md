# AgentForge screen specs

Owner: ui-designer. Consumer: frontend-engineer. Read `DESIGN_SYSTEM.md` first (tokens, shared components). API fields come from `docs/contracts/api.md` (read 2026-11-06). Where a field is not there it is marked **missing from api.md**; the handoff is `docs/handoff/backend-engineer__ui-designer__screen-fields.md`, and each screen has a fallback that works today.

## Global rules (apply to every screen)
- Money: always `<Hbar value={tinybarString}/>`. Never print raw tinybar or weibar. No `Number()`.
- Every on-chain action row shows `<HashScanLink/>` once a hash exists; before that it shows `<ChainStatus state="pending"/>`.
- `isSeeded: true` shows `<SeededBadge/>` next to the item title.
- Infrastructure error (HTTP 5xx, 502, network failure, `ERROR` verification, benchmark `error`) shows `<ErrorPanel/>` with Retry. It never uses FAIL wording or colour. `409` shows the server `error` text in an inline Alert; `401` clears the session and opens the sign-in step.
- Page-level loading uses `<PageSkeleton/>`. Lists poll no faster than every 3 s and only while a state is in flight; stop on a terminal state.
- Screens that judge work show `<AuditNotice/>`.
- Auth: token from `POST /auth/verify` is held in memory plus `localStorage` (key `af_token`); send as `Authorization: Bearer`. Public pages (marketplace, agent detail) work signed out.

## Routes
| Route | Screen |
|---|---|
| `/` | 1 Marketplace |
| `/agents/[id]` | 1 Agent detail |
| `/connect` (also a dialog from the nav chip) | 2 Connect and sign in |
| `/requests/new` | 3 Create request |
| `/requests/[id]` | 3 Quotes, accept, fund |
| `/jobs/[agreementId]` | 4 Job page |
| `/agents/new` | 5 List an agent |
| `/agents/[id]/benchmark/[runId]` | 5 Benchmark report (also embedded on detail) |

Nav "My requests" = `/jobs` list using `GET /agreements` (a plain list: request title, `<Hbar>`, status badge, link to job). Empty: "No jobs yet. Create a request." Keep it to a table; it is not one of the five screens.

---

## Screen 1: Marketplace and agent detail

### 1a. Marketplace (`/`)
Layout: header strip (title "Hire a benchmarked AI agent", one line saying funds are held in escrow in HBAR), a capability filter row (`Select` or badge buttons), then a responsive grid of agent cards (1 col phone, 2 col `md`, 3 col `lg`).

Card elements and fields (from `GET /agents?capability=`, default status `listed`):
- `name`, `description` (clamp 2 lines), `capabilities[]` as badges (max 4, "+n"), `priceTinybar` as `<Hbar>` with label "Base price".
- `isSeeded` -> `<SeededBadge/>`.
- Benchmark score: **missing from api.md** on the list (only `latestBenchmarkId`). Fallback: show "Benchmarked" badge with ShieldCheck for `status === "listed"` and fetch the score on the detail page only. Preferred (handoff): add `latestScore` (numeric string) to Agent in `GET /agents`.
- Whole card is one link to `/agents/[id]` (visible focus ring on the card).

States:
- Loading: 6 skeleton cards.
- Empty: `<EmptyState>` "No agents match. Clear filter" (button) or, with no filter, "No agents are listed yet" with a "List an agent" link.
- Error: `<ErrorPanel>` "Could not load agents", Retry refetches.
- Success: grid.

Accessibility: grid is a `<ul>`; filter has a label "Filter by capability"; result count in an `aria-live` region.
Chain links: none.

### 1b. Agent detail (`/agents/[id]`) from `GET /agents/:id` -> `{agent, benchmark}`
Layout: two columns from `md` (left: identity, price, capabilities, review; right: sticky "Hire this agent" card). One column on phone with the hire card first after the title.

Fields:
- `agent.name`, `description`, `capabilities[]`, `priceTinybar` (`<Hbar>`), `isSeeded`, `status` badge (`listed` success, `benchmarking` info, `failed` danger, `draft` neutral), `repoUrl` (external link, text "Repository"), `repoCommit` (mono, first 7 chars, "Benchmarked at commit"), `payoutAddress` (mono, copy button, `<HashScanLink kind="account"/>`), `hederaAccountId` if present.
- Benchmark card: `benchmark.score` large "84 / 100" with a `Progress`; below it `customScore` ("Code checks, 40%") and `aiScore` ("AI review, 60%"); `benchmark.items[]` as a checklist (name, passed icon plus text "Passed"/"Failed", detail) `[VERIFY item shape {name, passed, detail} - api.md says only "items"]`; `benchmark.reviewText` in a `surface-2` block (render as plain text, not HTML); `createdAt`; `reportRoot` shown as "Report stored on 0G" with the root hash in mono and copy button (no HashScan link: it is a 0G hash, not a Hedera one). `reportRoot: null` with `error` set -> info Alert "Report stored in our database only. 0G upload failed."
- Hire card: price, button "Create a request for this agent" -> `/requests/new?agent=<id>` (the agent id is only a preselected hint; quotes still come from agents).
- `<AuditNotice/>`.

States:
- Loading: `<PageSkeleton/>`.
- 404: EmptyState "Agent not found" with link to marketplace.
- Error: `<ErrorPanel/>` Retry.
- `benchmark: null`: card says "Not benchmarked yet". If viewer owns the agent (agent.ownerUserId equals `GET /me` id) show a "Run benchmark" link to Screen 5.
- `benchmark.status` = `running`: spinner row "Benchmark running" (polls); `failed`: danger summary "Score below 80, not listed" plus the report; `error`: `<ErrorPanel>` with `benchmark.error`, owner sees Retry (re-POST benchmark).
- Success: as above.

Accessibility: score has text, not colour alone; `Progress` has `aria-label="Benchmark score"`.

---

## Screen 2: Connect wallet and sign in

Shown as `/connect`, and as the same component in a `Dialog` when a protected action needs it. Nav chip states: "Connect wallet" (button), "Wrong network" (warning, click to switch), "Sign in" (primary), `0x12ab...89ef` plus HBAR label of the account (dropdown: copy address, HashScan account link, Sign out).

Layout: a centred `Card` with `<WalletSteps/>` as a vertical numbered list. Each step: title, one-line status, action button. Steps:
1. **Connect wallet**: `eth_requestAccounts`. Shows address (mono) when done.
2. **Switch to Hedera Testnet**: `wallet_addEthereumChain` / switch to chain `296` (`0x128`). Done when the wallet reports chain 296.
3. **Sign in**: `POST /auth/nonce {address}` -> sign returned `message` -> `POST /auth/verify {address, nonce, signature}`. Fields used: `nonce`, `message`, `expiresAt`, `token`, `user.id`, `user.address`.
Footnote under step 3: "Signing a message is free and does not move funds."
(Step 4, Fund escrow, appears only on the accept screen.)

States per step: `todo`, `in progress` (button disabled, text "Waiting for wallet..."), `done`, `error` (message + Retry on that step only).
- No wallet detected: Alert "No EVM wallet found. Install MetaMask." with link; steps 2 and 3 disabled.
- User rejects in wallet: step error "You rejected the request in your wallet." with Retry. Not an infrastructure error.
- Nonce expired / `400`: step 3 error "Sign-in expired, try again" (refetch nonce).
- `401` bad signature: "Signature did not match this address."
- `5xx` / network: `<ErrorPanel/>`.
- Account is not ECDSA / transaction rejects later: hint under step 1, "Use an ECDSA Hedera account (create it in the Hedera Portal)."
- Success: toast "Signed in", redirect to the page the user came from (default `/`). Session 7 days; on expiry (`401`) return to step 3 only.

Accessibility: steps are an `<ol>`; each status is text; the active step's button gets focus when the step becomes active; wallet pop-ups are announced by the text "Check your wallet".
Chain links: step 2 shows `https://hashscan.io/testnet` as the network link text "Hedera Testnet on HashScan"; the connected account gets a `HashScanLink kind="account"` (account id needs the Hedera id; if only an EVM address is known, link by address `[VERIFY]`).

---

## Screen 3: Create request, quotes, accept, fund escrow

### 3a. Create request (`/requests/new`), auth required
Form (`POST /requests`): 
- `title` (Input, 1-200), `requirements` (Textarea, 10-10000, character counter), `checksRequested` (Checkbox group, labels: Build config `build_config`, Lint rules `lint_rules`, Secrets scan `secrets_scan`, Dependency check `dependency_check`, Security review `security_review`), `budgetTinybar` (UI input is HBAR as text, e.g. "5" or "1.5", up to 8 decimals; convert to a tinybar string by string parsing (split on "."), never `parseFloat`), `deadlineAt` (datetime-local, optional, shown in local time, sent ISO).
- Live helper under budget: "= `500000000` tinybar" is NOT shown; show only the parsed `<Hbar>` preview.
- Submit button "Create request".
States: idle; submitting (button disabled "Creating..."); field errors from `400 issues[].path/message` mapped under each field; `401` -> sign-in dialog; `5xx` -> ErrorPanel with Retry that keeps the form values; success -> go to `/requests/[id]` with toast "Request created. Asking agents for quotes."
If not signed in: page shows the Screen 2 component instead of the form.

### 3b. Quotes (`/requests/[id]`) from `GET /requests/:id` -> `{request, quotes}`
Top: request summary card: `title`, `requirements` (plain text), `checksRequested[]` badges, `budgetTinybar` (`<Hbar>`), `deadlineAt`, `status` badge (`open`, `agreed`, `closed`), `isSeeded` badge.

Quote list (table on `md`, stacked cards on phone). Per quote: agent name and score (**missing from api.md**: Quote has only `agentId`; fallback: fetch `GET /agents/:agentId` per quote, in parallel, and show name, benchmark score), `priceTinybar` (`<Hbar>`, with a warning badge "Over budget" if greater than `request.budgetTinybar`, compared with BigInt), `etaHours` ("n hours", or "not given" when null), `status` badge, button "Accept this quote" (only for `open` quotes and only when `request.status === "open"`; client only).
Link on each row: "View agent".

States:
- Waiting for quotes (`open` request, zero quotes): a `Loader2` row "Asking listed agents for quotes..." polling every 3 s for up to 60 s, then EmptyState "No quotes yet" with a "Check again" button. This does not mean failure.
- Loading: skeleton.
- Error: `<ErrorPanel/>`.
- 404: "Request not found".
- Accepted: the page switches to 3c.

### 3c. Accept and fund escrow
Triggered by "Accept this quote" -> confirmation `Dialog` showing agent, `<Hbar>` price, "Funds stay in a per-job escrow contract until the automated check decides. PASS pays the agent; FAIL refunds you." and `<AuditNotice/>`. Confirm calls `POST /quotes/:id/accept` (201 returns Agreement plus `escrowAddress` or `escrowError`).

Then a "Fund escrow" panel (same page, below the summary) driven by the agreement (`GET /agreements/:id`, poll while in flight). It shows `<WalletSteps/>` with all four steps; step 4 is this panel's content. Steps:
1. **Escrow contract created**: `escrowAddress` present -> done with `<HashScanLink kind="contract" value={escrowAddress}/>`. `escrowAddress` null with `escrowError` -> danger-free warning panel "The escrow contract could not be created yet" + button "Retry" -> `POST /agreements/:id/escrow` (returns `escrowAddress`; `502` shows the `error` text).
2. **Wallet on Hedera Testnet** (re-check chain 296, show Switch button if not).
3. **Wallet matches the buyer account**: if connected address differs from the signed-in user, block with "Connect the wallet you signed in with."
4. **Fund escrow**: shows `agreement.priceTinybar` as `<Hbar>` and the sentence "Your wallet will ask you to send exactly this amount." Button "Fund escrow (`<Hbar>`)" calls `JobEscrow.fund()` with value `toRpcValue(priceTinybar)` (frontend helper; user never sees weibar). The wallet transaction hash appears immediately as `<HashScanLink kind="tx"/>` with `<ChainStatus state="pending"/>` "Waiting for confirmation".

Funded is confirmed only when `GET /agreements/:id` returns `status: "funded"` (set by the indexer). Until then keep "Waiting for confirmation" (poll every 3 s). The mirror node may lag by several seconds; after 90 s still pending, show an info Alert "Still waiting. Your transaction may be confirmed on HashScan; this page will update when our indexer sees it." with a "Check again" button. Never show success on the wallet hash alone.

Fund states:
- idle, wallet confirming (button "Check your wallet..."), wallet rejected ("You rejected the transaction. No funds moved." + Retry), tx sent / pending, `funded` success (CheckCircle2 "Escrow funded", payment row `kind: "fund"` with `amountTinybar`, `txHash` link, then button "Go to job" -> `/jobs/[agreementId]`), insufficient balance (wallet error text shown: "Not enough HBAR in this account."), RPC/relay error (ErrorPanel "The Hedera relay did not accept the transaction. Your funds did not move. Retry.").
- Ownership: only the client sees the Fund panel; others see read-only status.

Accessibility: dialog focus trap; confirm button is not the default-focused element (Cancel is); step statuses in an `aria-live="polite"` region; the HBAR amount is in the button label text, not only a tooltip.
Chain links: escrow contract, fund tx hash.
Fields used: Request (`id,title,requirements,checksRequested,budgetTinybar,deadlineAt,status,isSeeded`), Quote (`id,agentId,priceTinybar,etaHours,status`), Agreement (`id,priceTinybar,escrowAddress,status,deadlineAt`), Payment (`kind,amountTinybar,txHash,status`), `escrowError` (accept response only).

---

## Screen 4: Job page (`/jobs/[agreementId]`)

Data: `GET /agreements/:id` -> `{agreement, request, agent, submission, verdict, payments}`; `GET /agreements/:id/verification` -> `{status, latest, history, verdict, disclaimer}`; `GET /agreements/:id/a2a`. Poll all three every 3 s while `agreement.status` is in `agreed|funded|submitted|verifying`; stop at `released|refunded`.

Layout: header (request `title`, `isSeeded` badge, `<Hbar>` of `agreement.priceTinybar`, agent link `agent.name`, `agreement.status` badge). Then a vertical **timeline**, then cards in this order: Submission, Verification checklist, Verdict and settlement, A2A calls. Single column; two columns are not needed.

### Timeline (`<ol>`, one row each; done/active/todo)
`agreed` Agreement created (+ escrow contract `<HashScanLink kind="contract" value={agreement.escrowAddress}/>`), `funded` Escrow funded (payment `kind:"fund"` `txHash` link), `submitted` Work submitted (`submission.submittedAt`), `verifying` Verifying, `released` or `refunded` Settled (payment `kind:"release"`/`"refund"` `txHash` link). Each row: icon, label, time (payment `createdAt` / `submission.submittedAt` / verification `createdAt`; the API has no per-status timestamps, so rows without a source show no time). The active row reads like "Waiting for the agent to submit work". Any row whose chain event is not yet indexed shows `<ChainStatus state="pending"/>`.
Deadline: `agreement.deadlineAt` shown as "Due <date>"; once past and status is `funded`, show a warning "Past deadline. Refund after deadline is a contract function (not in this app's scope)."

### Submission card
`submission.kind` (text/repo), `submission.content` (repo: external link; text: plain text in a scrollable block max 20 lines with "Show all"), `submission.deliverableHash` (mono, copy), `submission.submittedAt`.
States: `submission: null` -> "Waiting for the agent to submit." (status `funded`) or "Fund the escrow to start work." (status `agreed`, with link to 3c for the client).

### Verification checklist card
From `verification.latest`: `result` (`<VerdictBadge/>`), `summary`, `items[]` rows (name, Passed/Failed icon plus text, detail) `[VERIFY items shape]`, `createdAt`, `reportRoot` ("Report stored on 0G" with hash, copy). `history[]` collapsed under "Earlier runs".
States:
- `latest: null` and status before `submitted`: hidden.
- `verifying`: skeleton rows plus "Checking the submitted work against your requirements..." (live region).
- `PASS` / `FAIL`: as above.
- `ERROR`: `<ErrorPanel title="Verification could not run" detail={latest.error}/>` plus the sentence "This is not a fail. The work was not judged." The client gets a "Retry verification" button -> `POST /agreements/:id/verify` (`409` shows server text). Never uses the FAIL colour.
- `<AuditNotice/>` always below the card (use `verification.disclaimer` text when present, else the fixed sentence).

### Verdict and settlement card
Shows when `verdict` exists: `verdict.result`; plain-language outcome: PASS -> "Payment released to the agent", FAIL -> "Refunded to you"; amount `<Hbar>` from the matching payment (`kind` `release`/`refund`) `amountTinybar`; `verdict.settleTxHash` link (or payment `txHash`).
Money state wording follows the DB state only: the card says "Released" / "Refunded" when `agreement.status` is `released`/`refunded`. If the verdict exists but the status is still `submitted`/`verifying`: `<ChainStatus state="pending"/>` "Verdict signed, waiting for confirmation of the on-chain payout".
If `verdict.settleError` is non-null: ErrorPanel "The payout transaction failed" with detail and button "Retry payout" -> `POST /agreements/:id/settle` (`200` shows toast, `{already:true}` shows "Already settled", `502` shows the error). Visible to the client or the agent's owner only.
Final success: PASS -> success-tinted panel; FAIL -> danger-tinted panel with the refund line. Payments table below: kind, amount, status badge (`pending|confirmed|failed`), `txHash` HashScan link, `createdAt`.

### A2A calls card
Table from `GET /agreements/:id/a2a`: caller and callee names (**missing from api.md**: only ids; fallback: resolve through the cached agents list/`GET /agents/:id`), `priceTinybar` (`<Hbar>`), `rail` badge (`delegate`/`x402`), `status` badge (`quoted` neutral, `paid` info, `done` success, `failed` danger, `blocked` warning with `Ban` icon), `depth`, and for `blocked` the `blockedReason` shown in full ("Blocked: would exceed 30% of the job price"). Summary line: total paid `<Hbar>` (sum of `paid|done` BigInt) of the cap, and the cap as 30% of `agreement.priceTinybar` (BigInt `price * 30n / 100n`; the percent is a backend setting, `A2A_MAX_PERCENT`, **missing from api.md** as a response field; show it as "30% default" only if not provided).
Chain link per call: tx hash of the delegate payment **missing from api.md** (A2aCall has no `txHash`). Fallback: A2A payments are not listed in `payments`? They are (`kind:"a2a"`), but are not linked to a call. Use the payments table rows with `kind:"a2a"` for hashes.
States: empty -> "No agent-to-agent calls in this job." (not an error); loading skeleton; error ErrorPanel scoped to this card only.

### Whole-page states
Loading `<PageSkeleton/>`; `404` "Job not found"; `401` sign-in (the job read is public in the API, but money controls only show for the signed-in client); `5xx` ErrorPanel (the rest of the page stays if only one card failed).
Accessibility: timeline is an ordered list with `aria-current="step"` on the active row; status changes announced in a polite live region; tables have captions and proper headers.
Chain links: escrow contract, fund tx, release/refund tx, A2A payment txs.

---

## Screen 5: List an agent, benchmark progress and report (`/agents/new`), auth required

### Step form (`POST /agents`)
Fields: `name` (1-100), `description` (textarea 1-2000), `capabilities` (tag input, 1-10 tags, each 1-40; Enter or comma adds, Backspace removes; chips have remove buttons with labels), `priceTinybar` (HBAR text input parsed to a tinybar string like in 3a; preview `<Hbar>`), `endpointUrl` (url, optional, helper "Where we ask for quotes and send tasks. Public HTTPS URL"), `payoutAddress` (defaults to the connected wallet; mono; editable; 0x validation), `hederaAccountId` (optional, "0.0.123"), `repoUrl` (url, "Public GitHub repository URL").
Submit "Create agent and run benchmark": calls `POST /agents` (201 `{agent, apiKey}`), then `POST /agents/:id/benchmark` (202 `{runId, status}`).

**API key panel** (after 201): a one-time `Alert` "Save this key now. It is shown once." with `apiKey` in mono, copy button, and a checkbox "I saved the key" that must be ticked before "Continue" is enabled. Never stored in `localStorage`, never logged. If the page is left without ticking, a warning dialog asks to confirm.

### Benchmark progress
Poll `GET /agents/:id/benchmark/:runId` every 3 s. Stages are not exposed by the API, so show one indeterminate `Progress` and the copy "Reading your repository, running code checks, then AI review. This can take a minute or two." plus elapsed seconds (client timer). Do not fake per-stage progress. Status mapping: `running` progress; `passed` success; `failed` below-threshold result; `error` infrastructure error.
Reduced motion: indeterminate bar becomes a static bar with the text.

### Report (same data as 1b benchmark card)
`score` "84 / 100" with threshold marker at 80 ("Pass mark 80"), `customScore` (40%), `aiScore` (60%), `items[]` list, `reviewText`, `repoCommit` (first 7 chars), `reportRoot` hash (0G), `createdAt`.
Result banner:
- `passed`: success "Listed on the marketplace" + button "View listing" -> `/agents/[id]`.
- `failed`: danger-tinted (this is a real score result) "Score is below 80, so this agent is not listed" + the report + button "Re-run benchmark" (`POST /agents/:id/benchmark`, `409` -> "A run is already in progress").
- `error`: `<ErrorPanel>` with `error`, "This is not a failed score" + Retry. `reportRoot: null` with passing score still shows success plus an info Alert about storage.

States: form idle / submitting / field errors (`400 issues`) / `401` -> sign-in / `5xx` ErrorPanel keeps values; API key panel; progress; each result. Not signed in -> Screen 2 component. Owner-only note: someone else's agent shows the report read-only.
Accessibility: progress region `aria-live="polite"`, `role="progressbar"` with `aria-busy`; the key panel is focused on appearance; tag input has a visible label and instructions.
Chain links: payout address `HashScanLink kind="account"` when it is a known Hedera id; otherwise none on this screen.

---

## Field gaps summary (details in the handoff)
1. Agent list has no benchmark score (`latestScore`).
2. Quote has no agent name or score (needs N+1 `GET /agents/:id`).
3. A2aCall has no caller/callee names and no tx hash.
4. `items` shape of benchmark and verification is not documented (assumed `{name, passed, detail}`).
5. No "my requests" filter on `GET /requests` (using `GET /agreements`; requests without an agreement are not reachable).
6. Timeline has no per-status timestamps.
