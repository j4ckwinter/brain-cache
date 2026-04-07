---
phase: 56-technical-debt
plan: "01"
subsystem: services
tags: [debt, cleanup, dead-code]
dependency_graph:
  requires: []
  provides: [clean-services-barrel, no-tools-directory]
  affects: [src/services/retriever.ts, src/services/index.ts, tests/workflows/buildContext.test.ts, tests/workflows/search.test.ts]
tech_stack:
  added: []
  patterns: []
key_files:
  created: []
  modified:
    - src/services/retriever.ts
    - src/services/index.ts
    - tests/workflows/buildContext.test.ts
    - tests/workflows/search.test.ts
  deleted:
    - src/tools/index.ts
decisions:
  - "classifyQueryIntent alias removed entirely — no migration needed, classifyRetrievalMode was the canonical name throughout all active callers"
  - "src/tools/ deleted rather than kept — confirmed no imports exist and tsup has no entry point for it"
metrics:
  duration_seconds: 91
  completed_date: "2026-04-07"
  tasks_completed: 2
  files_changed: 5
requirements: [DEBT-02, DEBT-03]
---

# Phase 56 Plan 01: Dead Code Removal (classifyQueryIntent + src/tools/) Summary

Remove deprecated classifyQueryIntent alias and empty src/tools/ placeholder directory — eliminating dead code surface area with zero behavior change.

## What Was Done

### Task 1: Remove classifyQueryIntent deprecated alias (DEBT-02)

Deleted the `@deprecated` JSDoc comment and `export const classifyQueryIntent = classifyRetrievalMode;` line from `src/services/retriever.ts` (lines 98–99). Removed the `classifyQueryIntent` named re-export from the services barrel `src/services/index.ts`. Cleaned the Vitest mock in `tests/workflows/buildContext.test.ts` (removed the deprecated alias mock entry). Updated the test description in `tests/workflows/search.test.ts` from "calls classifyQueryIntent" to "calls classifyRetrievalMode".

The two remaining references to the string "classifyQueryIntent" in `tests/services/retriever.test.ts` (lines 367–368) are query content strings used to test the `classifyRetrievalMode` function itself — they are not imports or function calls and were correctly left untouched.

### Task 2: Delete empty src/tools/ directory (DEBT-03)

Removed `src/tools/index.ts` (a placeholder `export {}` barrel with a comment explaining the directory was reserved for future use). Confirmed no source files import from `src/tools/`, tsup.config.ts has no `tools` entry point, and `npx tsc --noEmit` passes cleanly after deletion.

## Verification

- `grep -rn "classifyQueryIntent" src/services/retriever.ts` → 0 lines
- `grep -rn "classifyQueryIntent" src/services/index.ts` → 0 lines
- `grep -rn "classifyQueryIntent" tests/workflows/buildContext.test.ts` → 0 lines
- `tests/workflows/search.test.ts` contains "calls classifyRetrievalMode with the query"
- `test ! -d src/tools` → passes
- `npx tsc --noEmit` → exits 0
- `npx vitest run tests/workflows/buildContext.test.ts tests/workflows/search.test.ts tests/services/retriever.test.ts` → 85/85 passed

## Commits

- `a1b75e6` feat(56-01): remove classifyQueryIntent deprecated alias
- `81f0b47` chore(56-01): delete empty src/tools/ directory

## Deviations from Plan

None - plan executed exactly as written.

## Known Stubs

None.

## Self-Check: PASSED

- `src/services/retriever.ts` exists and no classifyQueryIntent export
- `src/services/index.ts` exists and no classifyQueryIntent re-export
- `src/tools/` does not exist
- Commits a1b75e6 and 81f0b47 confirmed in git log
