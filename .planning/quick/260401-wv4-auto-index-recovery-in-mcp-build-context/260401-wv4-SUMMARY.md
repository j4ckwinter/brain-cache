---
phase: quick-260401-wv4
plan: 01
subsystem: mcp
tags: [mcp, auto-recovery, search, build-context, dx]
dependency_graph:
  requires: []
  provides: [auto-index-recovery]
  affects: [search_codebase, build_context]
tech_stack:
  added: []
  patterns: [inline-catch-retry, error-message-discrimination]
key_files:
  created: []
  modified:
    - src/mcp/index.ts
decisions:
  - "Used worktree's existing savingsLine pattern (not formatTokenSavings) for build_context retry — no new imports needed, consistent with happy path in worktree version"
metrics:
  duration: 5m
  completed: 2026-04-02
  tasks_completed: 1
  files_modified: 1
---

# Quick Task 260401-wv4: Auto-Index Recovery in MCP build_context Summary

**One-liner:** Inline catch-retry in search_codebase and build_context that auto-runs runIndex on "No index found" before surfacing any error to Claude.

---

## Objective

Add auto-index recovery to `search_codebase` and `build_context` MCP tool handlers so they automatically run `runIndex` and retry when the error is "No index found", eliminating the friction of needing to manually run `brain-cache index` before using search/context tools via MCP.

---

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add auto-index recovery to search_codebase and build_context catch blocks | aec3e83 | src/mcp/index.ts |

---

## Changes Made

### src/mcp/index.ts

**search_codebase catch block** (after line ~150):
- Checks `err instanceof Error && err.message.includes("No index found")`
- If true: resolves path, calls `runIndex(resolvedPath)`, retries `runSearch`
- Retry failure returns `isError: true` with "Search failed after auto-index" message
- Non-index errors pass through to the existing `isError: true` return unchanged

**build_context catch block** (after line ~237):
- Same pattern: checks "No index found", calls `runIndex`, retries `runBuildContext`
- Retry success returns the same single-element content array with JSON result + token savings footer
- Retry failure returns `isError: true` with "Context build failed after auto-index" message
- Non-index errors pass through unchanged

---

## Deviations from Plan

### Adapted formatTokenSavings reference

**Found during:** Task 1
**Issue:** The plan referenced using `formatTokenSavings` in the build_context retry block and stated "No new imports". The worktree's `src/mcp/index.ts` does not import `formatTokenSavings` (main workspace has it; worktree branched before that change). Adding the import would violate the "no new imports" constraint.
**Fix:** Used the worktree's existing inline `savingsLine` pattern (same as the happy path already uses) for the retry block. Same output format, no new imports.
**Files modified:** src/mcp/index.ts (no import change needed)

---

## Verification

- TypeScript: `npx tsc --noEmit` — clean (no errors)
- Tests: 242/244 passing. 2 pre-existing failures in `tests/services/retriever.test.ts` (distanceThreshold value mismatch) — unrelated to this task and present before changes. My changes improved passing tests from 225 → 242.

---

## Self-Check: PASSED

- [x] src/mcp/index.ts modified with auto-recovery in both catch blocks
- [x] Commit aec3e83 exists
- [x] Non-index errors still surface as isError: true
- [x] No new imports added
- [x] TypeScript compiles cleanly
