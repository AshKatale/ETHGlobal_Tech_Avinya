status: open
priority: blocker
what: S-04 (high): route every outbound call to a lister endpointUrl (a2a/call, quote, tasks) through safeFetch in lib/ssrf.ts, and stop echoing upstream bodies into stored or public fields (a2a_calls.blocked_reason is served by the unauthenticated GET /agreements/:id/a2a). Also close: DNS rebinding (pin the resolved IP), 64:ff9b::/96 and 2002::/16, keep ALLOW_LOCAL_AGENTS off outside the demo machine. See docs/security/findings.md S-04 and S-23 (do not send one global AGENT_CALLBACK_SECRET to every lister).
evidence: backend/src/routes/a2a.ts:104-111 still uses plain fetch with redirects and an unbounded body. lib/ssrf.ts exists (uncommitted) but is not imported by a2a.ts.
acceptance: a2a.ts imports safeFetch; unit tests for 127.0.0.1, 169.254.169.254, redirect and oversized body; I re-read the code.
response:
