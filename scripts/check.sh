#!/usr/bin/env bash
# AgentForge single quality gate. Runs every offline check and prints one PASS/FAIL/NOT RUN table.
# Usage: scripts/check.sh            (fast: typecheck, unit tests, contracts, builds)
#        RUN_INT=1 scripts/check.sh  (also runs backend integration tests; they write [qa] rows to the shared database)
#        SKIP="frontend contracts" scripts/check.sh  (skip groups, for example while another process is building them)
# It never prints environment values. Exit code is 1 if any check FAILs. NOT RUN does not fail the gate but is reported.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PATH="$HOME/.foundry/bin:$PATH"
LOG_DIR="$(mktemp -d)"
RESULTS=()
FAILED=0

run() { # run <name> <dir> <command...>
  local name="$1" dir="$2"; shift 2
  if [ ! -d "$ROOT/$dir" ]; then RESULTS+=("NOT RUN|$name|directory $dir missing"); return; fi
  if (cd "$ROOT/$dir" && "$@" >"$LOG_DIR/$name.log" 2>&1); then
    local detail
    detail="$(grep -E 'Tests +[0-9]+|[0-9]+ passed|compiled|Compiled|Generating static|No ESLint|✔' "$LOG_DIR/$name.log" | tail -n 1 | sed 's/^ *//' | cut -c1-100)"
    RESULTS+=("PASS|$name|${detail:-ok}")
  else
    FAILED=1
    RESULTS+=("FAIL|$name|see $LOG_DIR/$name.log: $(tail -n 2 "$LOG_DIR/$name.log" | tr '\n' ' ' | cut -c1-90)")
  fi
}

need() { # need <name> <tool> : mark NOT RUN if a tool is missing
  command -v "$2" >/dev/null 2>&1 || { RESULTS+=("NOT RUN|$1|$2 not installed"); return 1; }
}

skipped() { case " ${SKIP:-} " in *" $1 "*) RESULTS+=("NOT RUN|$1|skipped via SKIP"); return 0;; esac; return 1; }

NODE_TSC="node node_modules/typescript/bin/tsc"
NODE_VITEST="node node_modules/vitest/vitest.mjs"

# backend
if [ -d "$ROOT/backend/node_modules" ]; then
  run backend-typecheck backend $NODE_TSC --noEmit
  if [ "${RUN_INT:-0}" = "1" ]; then run backend-tests backend $NODE_VITEST run
  else run backend-unit-tests backend $NODE_VITEST run --exclude src/backend.int.test.ts; fi
else RESULTS+=("NOT RUN|backend|run npm ci in backend/"); fi

# contracts
if skipped contracts; then :; elif need contracts-forge-test forge; then run contracts-forge-test contracts forge test; fi

# frontend
if skipped frontend; then :
elif [ -d "$ROOT/frontend/node_modules" ]; then
  run frontend-lint frontend npm run lint --silent
  run frontend-tests frontend npm test --silent
  run frontend-build frontend npm run build --silent
else RESULTS+=("NOT RUN|frontend|run npm ci in frontend/"); fi

# demo agents
for a in demo-agents demo-agents/solidity-builder demo-agents/static-auditor; do
  n="$(echo "$a" | tr '/' '-')-typecheck"
  if [ -d "$ROOT/$a/node_modules" ]; then run "$n" "$a" npm run typecheck --silent
  else RESULTS+=("NOT RUN|$n|run npm ci in $a/"); fi
done

# secrets must not be tracked
if (cd "$ROOT" && git ls-files | grep -E '(^|/)\.env$' >/dev/null); then
  FAILED=1; RESULTS+=("FAIL|no-tracked-env|a .env file is tracked by git")
else RESULTS+=("PASS|no-tracked-env|no .env file is tracked"); fi

printf '\n%-8s %-28s %s\n' RESULT CHECK DETAIL
printf '%-8s %-28s %s\n' ------ ----- ------
for r in "${RESULTS[@]}"; do IFS='|' read -r s n d <<<"$r"; printf '%-8s %-28s %s\n' "$s" "$n" "$d"; done
echo
if [ "$FAILED" = "1" ]; then echo "GATE: FAIL (logs in $LOG_DIR)"; exit 1; fi
echo "GATE: PASS (NOT RUN items above were skipped, not passed)"
