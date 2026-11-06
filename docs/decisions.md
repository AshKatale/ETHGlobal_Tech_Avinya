# Decisions and deviations

Owner: integration-lead. One entry per decision: what, why, alternative, who decided.

## 2026-11-06

1. **Chain writes stay direct, confined to `backend/src/chain/`; no `chain_outbox` (ADR-001).** CLAUDE.md rule 3 amended. Why: an outbox is 6 to 8 hours and a new moving part under a hard deadline; the relayer queue serializes sends already. Alternative: build the outbox after the hackathon. Decided by: human.
2. **npm with separate packages, no Turborepo or pnpm (ADR-005).** CLAUDE.md stack line amended. Decided by: human.
3. **Contracts V2 side by side with V1 (ADR-006).** Adds an on-chain 30% A2A cap, a stuck-escrow refund (`refundIfNoVerdict`, 72 hour default), a minimum deadline and input checks, with unchanged signatures and EIP-712 data. V1 stays deployed and is the rollback (switch `FACTORY_ADDRESS` back). Supersedes the "no redeploy" recommendation in ADR-002. Decided by: human, scope "Core + contract v2".
4. **Scope of the enhancement pass:** core hardening, audit trail, demo story and contract V2. Not included: 0G verified compute, chain_outbox, multi-signer verifier, x402, GitHub OAuth. Decided by: human.
5. **A2A paid timing (ADR-004):** the call is marked `paid` when its budget is reserved (inside the locked transaction, before the chain transaction is sent) so concurrent calls cannot overspend. If the payment then fails, the call becomes `failed`, and the indexed `Delegated` event heals a call whose transaction actually landed. The payment row is inserted inline (idempotent) and confirmed by the indexer. This deviates from the strict "only after indexing" wording of CLAUDE.md rule 2, deliberately, to close the overspend race (S-01, S-02). Contracts V2 adds the on-chain cap as a second guard.
6. **Shared Neon database:** it holds columns defined by other code (`agreements.task_*`, `payments.payer_account_id`) and old duplicate `payments` rows. Migrations are written by hand with `IF NOT EXISTS`; `db:push` is forbidden. Open: who owns those columns.
7. **Demo agents run on localhost:** the SSRF guard blocks loopback unless `ALLOW_LOCAL_AGENTS=true`. This flag is for local demo runs only and stays off in any shared or deployed environment.
8. **GitHub OAuth and its environment variables:** present in `backend/.env` but no route exists and nothing reads them. Kept out of scope (cuttable).
9. **Branch:** all work is on `feat/project-builder`. Nothing is pushed.
