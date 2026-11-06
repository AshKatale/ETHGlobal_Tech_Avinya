# AgentForge design system

Owner: ui-designer. Consumer: frontend-engineer. Small on purpose: buildable tonight (deadline 09:00 IST Sat 7 Nov 2026).

## 1. Direction
Calm, flat, trust-first escrow marketplace. Not a neon crypto look.
- Search result basis: `products.csv` rows "Marketplace (P2P)" (flat design, trust colours, success green) and "Freelancer Platform" (flat + minimal, professional blue + success green). The "Fintech/Crypto" row (glassmorphism, OLED dark) was checked and rejected: glass blur hurts contrast and costs build time. Palette below is a custom flat blue and green set; `colors.csv` has no verified row that matches, so the hex values are mine and checked for contrast by hand (see 2).
- Light is the default. Dark is supported through tokens only (no per-component work).
- No custom illustration, no gradients, no heavy animation. Only 150 ms colour and opacity transitions, disabled under `prefers-reduced-motion`.

## 2. Colour tokens
Define as CSS variables in `globals.css` and map in Tailwind (`bg-background`, `text-foreground`, ...), the standard shadcn pattern. Light on `:root`, dark on `.dark`.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--background` | `#F8FAFC` | `#0B1020` | page |
| `--surface` | `#FFFFFF` | `#111827` | cards, popovers |
| `--surface-2` | `#F1F5F9` | `#1A2234` | table header, code blocks |
| `--foreground` | `#0F172A` | `#F1F5F9` | body text |
| `--muted-foreground` | `#475569` | `#94A3B8` | secondary text |
| `--border` | `#CBD5E1` | `#334155` | borders, inputs |
| `--primary` | `#1D4ED8` | `#60A5FA` | main buttons, links |
| `--primary-foreground` | `#FFFFFF` | `#0B1020` | text on primary |
| `--success` | `#15803D` | `#4ADE80` | PASS, released, confirmed |
| `--warning` | `#B45309` | `#FBBF24` | pending chain state, blocked, seeded badge |
| `--danger` | `#B91C1C` | `#F87171` | FAIL, refunded, errors |
| `--info` | `#0369A1` | `#38BDF8` | neutral status, A2A |
| `--ring` | `#1D4ED8` | `#93C5FD` | focus ring |

Rules: text/background pairs are at least 4.5:1 (foreground, muted-foreground, primary-foreground on primary, success/warning/danger/info text on `--surface` all clear 4.5:1 in both themes by calculation; frontend must re-check any new pair). Status is never colour alone: always an icon plus a word. Tinted status backgrounds use the token at 10% opacity with the full token as text.

## 3. Type
- Font: Inter (Google Fonts, `next/font`) for UI. `JetBrains Mono` for hashes, addresses, tinybar-derived amounts, code. Matches `typography.csv` "Minimal Swiss" (dashboards, enterprise apps). Fallback stack: `system-ui, sans-serif` and `ui-monospace, monospace`.
- Scale (px / line height): 12/16 caption, 14/20 small and table, 16/24 body (minimum for body and inputs), 20/28 h3, 24/32 h2, 32/40 h1. Weights 400, 500, 600.
- Amounts and hashes use `font-variant-numeric: tabular-nums`.

## 4. Spacing, shape, layout
- 4 px base; use Tailwind 1, 2, 3, 4, 6, 8, 12.
- Radius: 8 px cards and inputs, 6 px badges, full for avatars.
- Border 1 px `--border`; shadow only on popovers and dialogs (`shadow-md`).
- Container: `max-w-5xl`, 16 px side padding on phone, 24 px from `md`. Single column below 768 px; two columns above where a screen says so. Touch targets at least 44 x 44 px (buttons `h-11`).
- Top nav: logo, Marketplace, My requests, List an agent, and a wallet chip (section 7). Persistent footer line: "Automated verification is not a professional audit."

## 5. shadcn/ui components (install only these)
`button`, `card`, `badge`, `input`, `textarea`, `label`, `checkbox`, `select`, `tabs`, `table`, `dialog`, `alert`, `progress`, `skeleton`, `separator`, `tooltip`, `sonner` (toasts), `form` (react-hook-form + zod). Nothing else without a reason in a handoff.

Checked against `stacks/shadcn.csv` generally; no stack row contradicts this list.

## 6. Icons
`lucide-react` (ships with shadcn, no extra install). `icons.csv` lists Phosphor; lucide is chosen to avoid a second dependency. Set: `Wallet`, `ShieldCheck`, `CheckCircle2`, `XCircle`, `Clock`, `Loader2` (spin, static under reduced motion), `AlertTriangle`, `ExternalLink`, `RefreshCw`, `Copy`, `Bot`, `FileText`, `ArrowRightLeft` (A2A), `Ban` (blocked), `Search`. Decorative icons get `aria-hidden`; icon-only buttons get `aria-label`.

## 7. Shared product components (built once, used on every screen)
These encode the AgentForge rules. Build them before screens.

1. **`<Hbar value="150000000" />`**: takes a tinybar string, prints `1.5 HBAR`. Uses `BigInt` division: whole = v / 10^8, fraction = v % 10^8, padded to 8 digits, trailing zeros trimmed, at least no fraction when zero (`2 HBAR`). Never `Number()` or float. Invalid or missing input prints "n/a" (never "0 HBAR"). Optional `title` shows the raw tinybar as "150000000 tinybar" in a tooltip only.
2. **`<HashScanLink kind="tx|contract|account" value />`**: `https://hashscan.io/testnet/transaction/<hash>`, `/contract/<addr>`, `/account/<id>` `[VERIFY]` path names on the live site. Shows a shortened value (`0x12ab...89ef`), an `ExternalLink` icon, opens in a new tab with `rel="noopener noreferrer"`, label "View on HashScan". If the value is null the link is not rendered and the row shows the pending state instead.
3. **`<ChainStatus state />`**: `pending` (Clock, warning, "Waiting for confirmation"), `confirmed` (CheckCircle2, success, "Confirmed on Hedera"), `failed` (XCircle, danger, "Transaction failed"). Never shows success before the backend reports the indexed state.
4. **`<SeededBadge />`**: warning-tinted badge "Seeded demo data", shown on any agent, request or job where `isSeeded` is true.
5. **`<VerdictBadge result />`**: `PASS` (success), `FAIL` (danger), `ERROR` (warning, text "Verification error, not a fail", always next to a Retry button).
6. **`<AuditNotice />`**: muted line with ShieldCheck: "Automated verification is not a professional audit." Appears on the quote, job and agent-report screens and in the footer.
7. **`<WalletSteps />`**: the four explicit steps, each with its own status (not started, in progress, done, error): 1 Connect wallet, 2 Switch to Hedera Testnet (chain 296), 3 Sign in (sign message), 4 Fund escrow (only on the accept screen). A step cannot show done until the wallet or backend confirms it.
8. **`<ErrorPanel title detail onRetry />`**: `Alert` (destructive) with a Retry button. Always used for infrastructure errors (network, NVIDIA, 0G, mirror node). Copy: "Something on our side failed. Your funds are not affected. Try again."
9. **`<EmptyState icon title body action />`** and **`<PageSkeleton />`** (shadcn `skeleton` shaped like the page).

## 8. Interaction and accessibility baseline
- Every input has a visible `<Label>`; errors appear under the field with `aria-describedby` and `role="alert"` for form-level errors.
- Focus ring: 2 px `--ring` with 2 px offset on every interactive element; never `outline: none` without a replacement.
- Tab order equals visual order; dialogs trap focus and return it on close.
- Status text uses `aria-live="polite"` (timeline, benchmark progress, chain status).
- Polling updates must not steal focus or shift layout (reserve space).
- `@media (prefers-reduced-motion: reduce)`: remove transitions, stop spinners (show static icon plus text).
- Buttons that start a chain action are disabled while pending and show the text, not only a spinner.
- Long hashes and addresses wrap or truncate with a copy button; never overflow the viewport.
