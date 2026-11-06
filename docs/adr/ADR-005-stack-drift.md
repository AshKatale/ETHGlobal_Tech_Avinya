# ADR-005: Stack drift: pnpm and Turborepo vs npm
**Status:** Proposed   **Date:** 2026-11-06   **Deciders:** human (needs sign-off)

## Context
CLAUDE.md says pnpm + Turborepo; the repo has no root `package.json`, `pnpm-workspace.yaml` or `turbo.json`, and `backend/` uses npm (`package-lock.json`). `frontend/` and `demo-agents/` do not exist yet and are being scaffolded in parallel. GitHub OAuth env vars exist but OAuth is cuttable and out of scope here. Deadline: 09:00 IST Sat.

## Decision (the recommendation)
Use plain npm with independent packages (`backend/`, `frontend/`, `demo-agents/*`), no monorepo tool, Node 22. Each package has its own `package-lock.json` and scripts; a root `Makefile` or script may start all (integration-lead). Update CLAUDE.md's Stack line to "npm, no monorepo". Ports follow the charter.

## Options considered
| Option | Complexity | Time | Risk to golden path | Demo impact |
|---|---|---|---|---|
| A. npm, separate packages | None | 0 | None | None |
| B. Migrate to pnpm workspace only | Low-medium | 1-2 h | Medium; breaks the lock and in-flight parallel agents | None |
| C. pnpm + Turborepo | Medium | 3-4 h | High | None |
Pros A: matches the code and every agent now working. Cons A: no shared types package; the API contract doc (`docs/contracts/api.md`) stands in for it.

## Consequences
Easier: no migration while eight agents write in parallel. Harder: duplicated types across packages. Revisit when: after the hackathon if the team grows.

## Action items
- integration-lead: edit CLAUDE.md Stack line after sign-off.
- frontend-engineer, demo-agents-engineer: scaffold with npm.
- human: confirm.

## Unverified assumptions
- None that need testing; GitHub OAuth is not designed for here (cuttable).
