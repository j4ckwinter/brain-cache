---
phase: 06-foundation-cleanup
plan: 01
subsystem: workflows, cli, mcp
tags: [error-handling, process-exit, version, tech-debt]
dependency_graph:
  requires: []
  provides: [workflow-error-contracts, cli-catch-wrapper, dynamic-version]
  affects: [src/workflows, src/cli, src/mcp]
tech_stack:
  added: []
  patterns: [throw-on-error, createRequire-json-import, parseAsync-catch]
key_files:
  created: []
  modified:
    - src/workflows/index.ts
    - src/workflows/buildContext.ts
    - src/workflows/askCodebase.ts
    - src/workflows/status.ts
    - src/workflows/search.ts
    - src/workflows/doctor.ts
    - src/cli/index.ts
    - src/mcp/index.ts
    - tests/workflows/index.test.ts
    - tests/workflows/buildContext.test.ts
    - tests/workflows/askCodebase.test.ts
    - tests/workflows/status.test.ts
    - tests/workflows/search.test.ts
    - tests/workflows/init.test.ts
decisions:
  - "Used createRequire pattern for JSON import (reliable in ESM projects with tsup)"
  - "Used parseAsync() instead of parse() in CLI to correctly catch async action handler errors"
  - "Kept init.ts process.exit calls out of scope — init workflow was not in plan scope"
metrics:
  duration_seconds: 298
  completed_date: "2026-04-01"
  tasks_completed: 2
  files_modified: 14
---

# Phase 06 Plan 01: Foundation Cleanup — Error Contracts and Dynamic Version Summary

Replaced `process.exit(1)` calls in 6 workflow files with `throw new Error(msg)`, added a CLI-level async catch wrapper that handles all workflow errors, and sourced version from `package.json` in both CLI and MCP server using `createRequire`.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Replace process.exit(1) with thrown errors in all workflow files | 860c7fd | src/workflows/*.ts, tests/workflows/*.test.ts |
| 2 | Add CLI catch wrapper and source version from package.json | 91f3c9b | src/cli/index.ts, src/mcp/index.ts |

## What Was Built

**Task 1 — Workflow error contracts (HARD-01):**
All 6 workflow files (`index.ts`, `buildContext.ts`, `askCodebase.ts`, `status.ts`, `search.ts`, `doctor.ts`) now throw `Error` instead of calling `process.stderr.write` + `process.exit(1)`. Workflows are now pure — they raise errors on failure conditions and let callers decide how to handle them.

Error counts per file:
- `index.ts`: 2 throw sites (no profile, Ollama not running)
- `buildContext.ts`: 4 throw sites (no profile, Ollama, no index, no chunks table)
- `askCodebase.ts`: 1 throw site (missing ANTHROPIC_API_KEY)
- `status.ts`: 2 throw sites (no profile, no index state)
- `search.ts`: 4 throw sites (no profile, Ollama, no index, no chunks table)
- `doctor.ts`: 1 throw site (no profile)

**Task 2 — CLI catch wrapper and dynamic version (HARD-01 + DEBT-02):**
- CLI wraps `program.parseAsync()` in an async IIFE with a `.catch()` handler that prints `Error: ${message}` to stderr and exits with code 1
- Both CLI and MCP server now import version from `package.json` via `createRequire` (ESM-compatible JSON import pattern)
- No more hardcoded `'0.1.0'` strings in either entry point

## Verification Results

```
grep -rn "process.exit" src/workflows/   → 0 lines (PASS)
grep -n "process.exit" src/cli/index.ts  → 1 line (catch wrapper) (PASS)
grep -n "process.exit" src/mcp/index.ts  → 1 line (main catch) (PASS)
grep -rn "'0.1.0'" src/cli/ src/mcp/    → 0 lines (PASS)
npm test                                  → 225/225 tests pass (PASS)
npm run build                             → Build success (PASS)
```

## Deviations from Plan

**1. [Rule 2 - Missing scope] Updated tests/workflows/init.test.ts runDoctor test**
- **Found during:** Task 1 test run
- **Issue:** `init.test.ts` contains the `runDoctor` describe block (not a separate doctor test file). The test at line 286 expected `rejects.toThrow('process.exit(1)')` which failed after `doctor.ts` was converted to throw directly.
- **Fix:** Updated that single test to `rejects.toThrow("No profile found. Run 'brain-cache init' first.")` — minimal change, correct behavior.
- **Files modified:** tests/workflows/init.test.ts
- **Note:** init.ts itself remains out of scope; only the doctor test within init.test.ts was updated.

## Known Stubs

None — all functionality is fully wired.

## Self-Check: PASSED

- SUMMARY.md exists at `.planning/phases/06-foundation-cleanup/06-01-SUMMARY.md`
- Commit 860c7fd exists (Task 1)
- Commit 91f3c9b exists (Task 2)
