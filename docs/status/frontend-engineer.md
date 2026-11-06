updated: 2026-11-06 (second pass, follow-ups done)
state: done (wallet and browser flows build-verified only)
done:
- Task 1 audit log: GET /agreements/:id/audit -> AuditPanel (kind, nonce, signer, resultOrAmount, sigSha256, createdAt); reportRoot/settleTxHash fallbacks.
- Task 2: latestScore on agent cards and quotes, quote agentName (per-quote agent lookups removed), A2A callerName/calleeName/txHash (lookups removed, "matched transaction" label, Payments table stays authoritative), GET /config a2aMaxPercent (also agreement.a2aMaxPercent; no hardcoded 30), agreement timestamps in the timeline, /requests (My requests) via GET /requests?mine=true. Fallbacks kept when fields are absent.
- Task 3: Bearer token sent on agreement, verification, a2a (query key switches on sign-in); viewerAccess "public" shows the limited-view notice, hides raw errors, keeps hashes, verdict, nonce, signature, tx links.
- Task 4: ClaimRefund (POST /agreements/:id/refund-timeout) with 409 countdown, 501 text, success tx link; no local refunded state. NOT VERIFIED against a real V2 escrow.
- Task 5: CLICKTEST.md updated. Task 6: build, lint, 13 tests pass; 10 routes return 200 on next dev (backend absent).
- Hydration fix: useWallet hasWallet via useSyncExternalStore (server snapshot false); token already used useSyncExternalStore with null server snapshot; other Date.now/locale uses only render after client fetch. h1 added on /connect, /requests/new, /agents/new (ConnectPanel pageHeading) and detail pages' loading/error/not-found states. hydration.mjs PASS; build, lint, 13 tests pass. Real MetaMask flows NOT VERIFIED.
blocked on: nothing
needs from others: V2 escrow deployment and a running backend for click-testing.
next: QA browser click-through.
