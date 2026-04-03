---
phase: 18-file-watcher
plan: "01"
subsystem: file-watcher
tags: [file-watcher, chokidar, debounce, cross-process-lock, incremental-indexing]
dependency_graph:
  requires: [src/services/ignorePatterns.ts, src/services/crawler.ts, src/workflows/index.ts]
  provides: [src/services/fileWatcher.ts, src/workflows/watch.ts]
  affects: [src/cli/index.ts]
tech_stack:
  added: [chokidar@5.0.0]
  patterns: [rolling-debounce, file-lock-sentinel, chokidar-esm]
key_files:
  created:
    - src/services/fileWatcher.ts
    - src/workflows/watch.ts
    - tests/services/fileWatcher.test.ts
    - tests/workflows/watch.test.ts
  modified:
    - package.json
    - package-lock.json
decisions:
  - "Use chokidar v5 (ESM-only) per INC-02 specification"
  - "500ms rolling debounce coalesces rapid events into single runIndex call"
  - "Cross-process lock via .brain-cache/.indexing flag file with O_EXCL atomic create"
  - "Export acquireIndexLock, releaseIndexLock, scheduleReindex, resetState for testability"
metrics:
  duration_minutes: 5
  completed_date: "2026-04-03"
  tasks_completed: 2
  tasks_total: 2
  files_created: 4
  files_modified: 2
---

# Phase 18 Plan 01: File Watcher Service and Watch Workflow Summary

**One-liner:** Chokidar v5 file watcher with 500ms rolling debounce, O_EXCL cross-process lock, and SIGINT/SIGTERM cleanup wired to the existing runIndex pipeline.

---

## What Was Built

### src/services/fileWatcher.ts
Exports `createWatcher(projectRoot: string): Promise<FSWatcher>`:
- Loads `.braincacheignore` patterns via `loadIgnorePatterns`
- Applies `ALWAYS_EXCLUDE_GLOBS` (node_modules, dist, .git, etc.) via the `ignore` package
- Hard-excludes `.brain-cache/` directory to prevent infinite re-index loops
- Configures chokidar with `ignoreInitial: true` and `persistent: true`

### src/workflows/watch.ts
Exports `runWatch(targetPath?: string): Promise<void>` plus helpers for testing:
- `scheduleReindex(filePath, eventType, projectRoot)`: Rolling 500ms debounce, accumulates pending file paths, fires `runIndex` once after idle window
- `acquireIndexLock(projectRoot)`: Atomic O_EXCL file creation at `.brain-cache/.indexing` — returns false if another process holds the lock
- `releaseIndexLock(projectRoot)`: Removes lock file silently
- `resetState()`: Clears module-level timer and pending set for test isolation
- Signal handlers for `SIGINT`/`SIGTERM` cleanly close watcher and clear timers

---

## Decisions Made

1. **chokidar v5 (ESM-only):** Specified in INC-02. Node 20+ compatible. No polling by default — uses native fs.watch/FSEvents.
2. **500ms rolling debounce:** Resets timer on each new event. Coalesces rapid saves (e.g., format-on-save followed by editor write) into one `runIndex` call.
3. **O_EXCL flag file for cross-process lock:** `withWriteLock` in lancedb.ts is single-process only. Flag file with `open(..., 'wx')` is atomic on POSIX — fails immediately if another process holds the lock, no blocking wait.
4. **Exported test helpers:** `acquireIndexLock`, `releaseIndexLock`, `scheduleReindex`, `resetState` are exported so tests can exercise them without spinning up a full watcher process.

---

## Test Coverage

| Test File | Tests | Coverage |
|-----------|-------|---------|
| tests/services/fileWatcher.test.ts | 5 | createWatcher options, .brain-cache exclusion, .braincacheignore patterns, normal files pass through, node_modules excluded |
| tests/workflows/watch.test.ts | 9 | acquireIndexLock success/fail, releaseIndexLock cleanup, debounce single call, debounce coalescing, rolling debounce, lock contention skip, watcher close |

All 14 tests pass.

---

## Deviations from Plan

### Auto-fixed Issues

None — plan executed exactly as written.

**Minor addition:** Exported `resetState()` function not in the plan spec, but required for test isolation (module-level debounce state needed clearing between tests). This is a test-enablement helper, not a behavioral change.

---

## Self-Check: PASSED
