---
phase: 57-performance
plan: "02"
subsystem: lib
tags: [performance, concurrency, staleness, refactor]
dependency_graph:
  requires: []
  provides: [statAllFiles shared utility, batched staleness checking]
  affects: [src/lib/staleness.ts, src/workflows/index.ts]
tech_stack:
  added: []
  patterns: [batched concurrent stat with Promise.all, shared utility extraction]
key_files:
  created:
    - src/lib/fsUtils.ts
  modified:
    - src/lib/staleness.ts
    - src/workflows/index.ts
    - tests/lib/staleness.test.ts
decisions:
  - Extracted statAllFiles from index.ts (private) to fsUtils.ts (shared) without changing its signature or behavior
  - staleness.ts now uses statAllFiles with FILE_READ_CONCURRENCY=20 instead of serial individual stat calls
metrics:
  duration: "~2 minutes"
  completed: "2026-04-07"
  tasks_completed: 2
  tasks_total: 2
  files_created: 1
  files_modified: 3
---

# Phase 57 Plan 02: Shared statAllFiles + Batched Staleness Check Summary

**One-liner:** Extracted private `statAllFiles` from index workflow into `src/lib/fsUtils.ts` and rewired `checkIndexStaleness` to use concurrent batched stat calls via `FILE_READ_CONCURRENCY=20` instead of a serial loop.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Extract statAllFiles to src/lib/fsUtils.ts and update index.ts import | fb3a710 | src/lib/fsUtils.ts, src/workflows/index.ts |
| 2 | Rewrite checkIndexStaleness to use batched statAllFiles and update tests | d276294, 9162d77 | src/lib/staleness.ts, tests/lib/staleness.test.ts |

## What Was Built

- **`src/lib/fsUtils.ts`**: New shared utility exporting `statAllFiles(files, concurrency)` — issues concurrent stat calls in batches with capped parallelism. Failures silently omitted (callers treat missing entries as changed/stale).
- **`src/lib/staleness.ts`**: Replaced serial `for...of` + individual `await stat(filePath)` loop with a single `await statAllFiles(files, FILE_READ_CONCURRENCY)` call. Files absent from the result map are skipped gracefully.
- **`src/workflows/index.ts`**: Removed private `statAllFiles` definition; now imports the shared version from `../lib/fsUtils.js`.
- **`tests/lib/staleness.test.ts`**: Migrated from mocking `node:fs/promises.stat` to mocking `../../src/lib/fsUtils.statAllFiles`; updated all 5 existing tests + added 1 new test verifying the concurrency argument is 20.

## Verification

- `npx vitest run tests/lib/staleness.test.ts`: 6/6 passed
- `npx vitest run` (full suite): 560/560 passed (1 new test added)
- `grep -rn "statAllFiles" src/`: shows definition in fsUtils.ts, usage in both staleness.ts and index.ts

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None.

## Self-Check: PASSED

- `src/lib/fsUtils.ts`: exists and exports `statAllFiles` with `Promise.all`
- `src/lib/staleness.ts`: imports `statAllFiles` from `./fsUtils.js`, no `stat` import
- `src/workflows/index.ts`: imports `statAllFiles` from `../lib/fsUtils.js`, no local definition
- Commits fb3a710, d276294, 9162d77: all present in git log
