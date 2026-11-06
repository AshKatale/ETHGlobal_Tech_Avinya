# Build order for frontend-engineer

Goal: the demo path exists first (connect, request, quote, accept, fund, job result), then listing. Each step lists what is "done" so you can stop at any point and still have a demo. Names refer to `DESIGN_SYSTEM.md` and `screens.md`.

## Phase 0: foundation (about 1 h)
1. Next.js + Tailwind + shadcn init; install only the components in DESIGN_SYSTEM section 5; Inter and JetBrains Mono through `next/font`; tokens in `globals.css` (light and dark), reduced-motion rule, focus ring.
2. `lib/money.ts`: `formatHbar(tinybarString)` and `parseHbarInput("1.5") -> "150000000"` (BigInt and string math only) and `toRpcValue`. Unit test: `150000000 -> "1.5 HBAR"`, `100000000 -> "1 HBAR"`, `1 -> "0.00000001 HBAR"`, `0 -> "0 HBAR"`, invalid -> "n/a".
3. `lib/api.ts`: typed fetch wrapper (Bearer token, `{error}` and `issues` handling, throws typed errors: `ApiError(status)`, `NetworkError`).
4. Shared components (DESIGN_SYSTEM section 7): `Hbar`, `HashScanLink`, `ChainStatus`, `SeededBadge`, `VerdictBadge`, `AuditNotice`, `ErrorPanel`, `EmptyState`, `PageSkeleton`. App shell: nav, wallet chip placeholder, footer notice.

## Phase 1: demo path (do in this order)
5. **Screen 2, connect and sign in**: `useWallet()` hook (wagmi/viem; chain 296; add-network), `WalletSteps`, nonce -> sign -> verify, session in memory plus `af_token`, nav chip. Done when: a real wallet signs in and `GET /me` shows the address.
6. **Screen 1a/1b, marketplace and agent detail** (read-only, public): list, filter, detail, benchmark card. Done when: seeded agents show with the "Seeded demo data" badge. Use the fallback for score (screens.md) until the backend adds `latestScore`.
7. **Screen 3a, create request**: form with HBAR parsing, field errors. Done when: a request is created and you land on `/requests/[id]`.
8. **Screen 3b, quotes**: summary, polling "asking agents", quote table (N+1 agent fetch), accept dialog. Done when: accepting returns an agreement.
9. **Screen 3c, fund escrow**: four-step panel, `fund()` with `toRpcValue`, pending -> funded via polling `GET /agreements/:id`, escrow retry. Done when: the status flips to `funded` from the indexer, with HashScan links visible. This is the main demo moment; test the rejected-in-wallet and still-waiting states.
10. **Screen 4, job page**: header, timeline, submission card, verification card (including the ERROR state with Retry), verdict card with settle retry, payments table. Done when: a PASS run shows Released with the payout link and a FAIL run shows Refunded.
11. **Screen 4, A2A card**: table with blocked state and spend summary. Done when: the blocked-payment demo case shows `blockedReason`.

## Phase 2: onboarding (after the demo path works)
12. **Screen 5, list an agent**: form, tag input, one-time API key panel, benchmark polling, report, re-run. Done when: a demo agent repo gets a score and the result banner.
13. "My jobs" list (`/jobs`) from `GET /agreements`.

## Phase 3: polish, only if time remains
14. Dark mode toggle, copy buttons everywhere, empty-state copy, mobile pass at 400 px, keyboard pass through the whole demo path, `axe` check on Screens 2, 3c and 4.

## Cut list (design already allows these to be dropped)
Dark mode toggle, benchmark history, "Earlier runs" in verification, filter row on the marketplace, `/jobs` list (link to the job straight from 3c), x402 badge styling.

## Keep even under pressure
`Hbar` formatting, HashScan links, "Waiting for confirmation" states, the ERROR-is-not-FAIL treatment, the audit notice, the Seeded badge.
