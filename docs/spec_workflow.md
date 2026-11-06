# Spec-Driven Workflow (AgentForge)

Based on the installed `spec-driven-development` skill (`.agents/skills/spec-driven-development/SKILL.md`). Each phase ends with a human review; do not advance until approved.

| Phase | Who | Output | Gate |
|---|---|---|---|
| 0. Capability map | Claude + human | `CAPABILITY_MAP.md` (module ids, dependencies, build order) | Human approves map |
| 1. Specify | Claude + human | `SPEC-<module-id>.md` (six core areas) | Human approves spec in a later turn |
| 2. Plan | **`spec-planner` agent** (`.claude/agents/spec-planner.md`) | `tasks/plan.md` | Human approves plan |
| 3. Tasks | **`spec-planner` agent** | `tasks/todo.md` | Human approves tasks |
| 4. Implement | Claude, one task at a time | Code and tests | Verify step passes per task |

## Running the planner
After a spec is approved, ask Claude to run the `spec-planner` agent on it, for example:
"Run spec-planner on SPEC-escrow.md." The agent reads the capability map, the spec, the MVP PRD and `docs/build_plan.md`, then writes only `tasks/plan.md` and `tasks/todo.md`.

One module at a time, in build order from `CAPABILITY_MAP.md`. Re-running for the next module replaces the previous plan, so commit it first.

## Rules
- The MVP PRD (`docs/agentforge_mvp_PRD.md`) is the product source of truth. A module spec refines it and never contradicts it without updating the PRD first.
- Update the spec first when a decision changes, then the plan, then the code.
- Link each PR to the spec section it implements.
