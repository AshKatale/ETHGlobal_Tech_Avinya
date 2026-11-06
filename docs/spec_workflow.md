# Spec-Driven Workflow (AgentForge)

Based on the installed `spec-driven-development` skill (`.agents/skills/spec-driven-development/SKILL.md`). Each phase ends with a human review; do not advance until approved.

| Phase | Who | Output | Gate |
|---|---|---|---|
| 0. Capability map | Claude + human | `CAPABILITY_MAP.md` (module ids, dependencies, build order) | Human approves map |
| 1. Specify | Claude + human | `SPEC-<module-id>.md` (six core areas) | Human approves spec in a later turn |
| 2. Plan | **`spec-planner` agent** (`.claude/agents/spec-planner.md`, mirrored in `.agents/agents/`) | `tasks/plan.md` | Human approves plan |
| 3. Tasks | **`spec-planner` agent** | `tasks/todo.md` | Human approves tasks |
| 4. Implement | Claude, one task at a time | Code and tests | Verify step passes per task |

## Architecture decisions (`architect` agent and `/architecture` skill)
Ask Claude to "run the `architect` agent on <decision>" (agent file: `.claude/agents/architect.md`, mirrored in `.agents/agents/`), or use the `/architecture <decision>` skill directly, during Phase 1 (Specify) whenever a module spec hits a real choice between options. Save each result as `docs/adr/ADR-NNN-<slug>.md` and link it from the spec. Decisions already pending:
- Escrow association strategy: constructor `associateToken` vs separate `initAssociate()` (depends on spike S2)
- x402 vs mirror-verified pay-then-call fallback (depends on spike S3)
- Single-key `release` vs two-verifier `recordVerdict` signatures (the plan chooses two verifiers)
- Postgres polling outbox vs a queue (solo plan chooses Postgres polling)
Accepted ADRs are binding on the planner; a change needs a new ADR that supersedes the old one.

## UI design (`ui-designer` agent)
For the `web` module, run the `ui-designer` agent (`.claude/agents/ui-designer.md`, mirrored in `.agents/agents/`) during Phase 1 (Specify). It reads the draft PRD's UI section and the `ui-ux-pro-max` data, and writes `docs/design/DESIGN_SYSTEM.md` and one note per screen. Link those from `SPEC-web.md`. Example: "Run ui-designer on the Agreement and Verification page."

## Running the planner
After a spec is approved, ask Claude to run the `spec-planner` agent on it, for example:
"Run spec-planner on SPEC-escrow.md." The agent reads the capability map, the spec, `docs/build_plan.md` and the draft PRD, then writes only `tasks/plan.md` and `tasks/todo.md`.

One module at a time, in build order from `CAPABILITY_MAP.md`. Re-running for the next module replaces the previous plan, so commit it first.

## Rules
- `docs/build_plan.md` is the source of truth. `docs/agent_forge_PRD.md` is background for personas, features and screens. A module spec refines the plan and never contradicts it without updating the plan first.
- Update the spec first when a decision changes, then the plan, then the code.
- Link each PR to the spec section it implements.
