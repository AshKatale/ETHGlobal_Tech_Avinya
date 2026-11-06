# ADR-003: Verifier trust model
**Status:** Proposed   **Date:** 2026-11-06   **Deciders:** human (needs sign-off)

## Context
One backend key (`VERIFIER_PRIVATE_KEY`, address in `deployments.json`) signs both verdicts (release/refund) and A2A delegations (`signDelegation`). The `verifier` is `immutable` in each escrow. Compromise means anyone can drain every open escrow; a bug in the backend can sign a wrong verdict. Verdicts come from an LLM judge plus checks, so it is also a quality risk.

## Decision (the recommendation)
Demo: keep the single key, testnet only, never reuse the deployer key, and add two cheap controls in the backend: (1) the verifier signs a delegation only after the DB-side budget and depth checks (already done) and never above the on-chain remaining balance; (2) log every signature (agreementId, kind, result, nonce) to a table for audit. State the trust model plainly in the pitch. Later: on-chain per-escrow delegation cap (`delegated <= price * maxBps / 10000`, a contract change), then a 2-of-3 verifier set (backend, human/lister arbiter, timeout) with key rotation through the factory.

## Options considered
| Option | Complexity | Time | Risk to golden path | Demo impact |
|---|---|---|---|---|
| A. Single key + audit log | Low | ~1 h | None | Honest centralisation note |
| B. On-chain A2A cap | Medium (contract change, redeploy) | 3-4 h | Medium | Strong: cap enforced even if backend is hacked |
| C. Multi-sig verifier (2-of-3) | High | 1+ day | High | Not demoable |
Pros A: ships. Cons A: single point of failure. B ties to ADR-002; do them in one redeploy if ever.

## Consequences
Easier: demo. Harder: "trustless" claims must be avoided; say "platform-verified". Revisit when: mainnet, real funds, or the ADR-002 redeploy.

## Action items
- backend-engineer: signature audit table and log (schema owner), confirm verifier key differs from the relayer/deployer key.
- contracts-engineer: include the cap in the same proposal as ADR-002.
- docs-writer: trust-model sentence in the README and pitch.
- security-reviewer: confirm key separation in their findings.

## Unverified assumptions
- The deployed verifier address differs from the deployer (`deployments.json` shows two different addresses; the match to `VERIFIER_PRIVATE_KEY` was not checked and I did not read `.env`).

## Update ($D): effect of contracts V2 (ADR-006)
V2 enforces `delegated + amount <= price * maxDelegatedBps / 10000` (default 3000) on chain and allows `delegate` only in `Funded`. A leaked or buggy verifier key can therefore no longer delegate more than the cap (30% of price) or delegate after submission. It does NOT remove the single-signer trust: the same key still signs release and refund verdicts, so a leaked key can still send a funded escrow's remainder to the agent or back to the client. The wording stays "platform-verified, not trustless". Rotation, multi-sig and a verifier set stay out of scope. Escrows created on V1 keep the old, uncapped behaviour.
