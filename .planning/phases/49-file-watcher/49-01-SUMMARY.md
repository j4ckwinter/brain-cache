---
phase: 49-file-watcher
plan: "01"
subsystem: workflows
tags: [file-watcher, debounce, fs-watch, lock-contention, tdd]
dependency_graph:
  requires: [src/workflows/index.ts, src/services/crawler.ts, src/services/indexLock.ts, src/services/logger.ts]
  provides: [src/workflows/watch.ts]
  affects: [src/cli/index.ts]
tech_stack:
  added: []
  patterns: [fs.watch-recursive, monkey-patch-stderr, rolling-debounce, lock-contention-catch]
key_files:
  created:
    - src/workflows/watch.ts
    - tests/workflows/watch.test.ts
  modified: []
decisions:
  - "Use Node.js built-in fs.watch (recursive) — zero new dependencies per D-01"
  - "Capture stderr BEFORE calling runIndex() — runIndex restores its own patch on return"
  - "Catch lock error from runIndex(), not pre-acquire — double-acquire causes false skips"
  - "Export shouldProcess and buildSummary for direct unit testing without runWatch"
metrics:
  duration_seconds: 207
  completed_date: "2026-04-06"
  tasks_completed: 1
  tasks_total: 1
  files_created: 2
  files_modified: 0
requirements_satisfied: [DAILY-02]
---

# Phase 49 Plan 01: Watch Workflow — Summary

**One-liner:** `fs.watch` recursive watcher with 500ms debounce, SOURCE_EXTENSIONS filter, lock-contention skip, and stderr capture/summary using only Node.js built-ins and existing dependencies.

---

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 (RED) | Failing tests for watch workflow | 1d707fa | tests/workflows/watch.test.ts |
| 1 (GREEN) | Watch workflow implementation | 6757236 | src/workflows/watch.ts, tests/workflows/watch.test.ts |

---

## What Was Built

### `src/workflows/watch.ts`

The watch workflow orchestrates file watching with these exported functions:

- **`runWatch(targetPath?)`** — Main entry point. Resolves root dir, loads `.braincacheignore`, prints startup banner, starts `fs.watch(rootDir, { recursive: true })`, registers SIGINT/SIGTERM cleanup, and blocks forever with `new Promise<never>(() => {})`.

- **`shouldProcess(relativeFilename, ig)`** — Filters watch events. Returns false for: empty/null filenames, non-source extensions (naturally excludes `.brain-cache/` internal files), excluded path prefixes (`node_modules/`, `.git/`, `dist/`, `build/`, `.next/`, `__pycache__/`), and files matching `.braincacheignore` patterns.

- **`buildSummary(lines, elapsed)`** — Extracts the `incremental index -- N new, M changed, K removed` line from captured runIndex stderr output to build a compact one-liner. Falls back to `brain-cache: re-indexed in Xs` if pattern not found.

Internal functions:

- **`scheduleReindex(rootDir)`** — Rolling 500ms debounce. Each qualifying event clears the pending timer and sets a new 500ms timeout.

- **`triggerReindex(rootDir)`** — Captures `process.stderr.write` before calling `runIndex()` (so runIndex progress lines are intercepted), then restores stderr and emits the compact summary. On lock contention error ("Try again later"), writes the skip message and returns without crashing.

### `tests/workflows/watch.test.ts`

25 unit tests covering all acceptance criteria via TDD:

- `shouldProcess` — 10 tests: extension filter, prefix filter, null guard, braincacheignore, brain-cache internals
- `buildSummary` — 4 tests: stats extraction, fallback cases, empty input
- Debounce coalescing — 4 tests: 5 rapid events → 1 runIndex, single event, non-source filtered, node_modules filtered
- Lock contention skip — 2 tests: skip message written, no rethrow
- Stderr suppression — 2 tests: capture during runIndex, restore after completion
- Cleanup handler — 3 tests: SIGINT closes watcher, SIGINT clears debounce timer, SIGTERM closes watcher

---

## Key Implementation Decisions

**1. Stderr capture before runIndex call (not after)**
Research pitfall 6 confirmed: `runIndex()` restores its own `process.stderr.write` in its `finally` block. The watcher must capture stderr BEFORE calling `runIndex()` — after `runIndex()` returns, the write is already the original. The watcher's capture sits outside `runIndex()`'s own patch window.

**2. No pre-acquire lock check**
Calling `acquireIndexLock()` before `runIndex()` causes a double-acquire false positive: the watcher holds the lock, then `runIndex()` tries to acquire it, sees the watcher's PID as alive, and throws "Another index operation is in progress" on every cycle. Solution: call `runIndex()` directly and catch its error.

**3. Extension filter prevents infinite re-index loop**
`.brain-cache/` internal files (file-hashes.json, index.lock, index-state.json) have `.json` and `.lock` extensions which are not in `SOURCE_EXTENSIONS`. No special-case path exclusion needed.

**4. `vi.spyOn(process, 'exit').mockImplementation(() => {})` in tests**
`runWatch()` calls `process.exit(0)` in the cleanup handler. Tests mock this to prevent the test process from dying, allowing assertions on `watcher.close()` to pass.

---

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Test design: vi.resetModules() + re-import does not clear mock call records**

- **Found during:** GREEN phase test run
- **Issue:** The initial test design used `vi.resetModules()` + dynamic import with cache-busting query strings to get fresh module instances. However, `mockWatch.mock.calls` was still empty in those tests because the `node:fs` mock was set up once at module level and the re-imported modules shared the same mock.
- **Fix:** Rewrote tests to use a `setupWatch()` helper that reuses the single module import (since vitest mocks persist across test runs within a describe block), with proper `vi.clearAllMocks()` in `beforeEach`. Also mocked `process.exit` to prevent test process termination.
- **Files modified:** tests/workflows/watch.test.ts
- **Commit:** 6757236

---

## Test Results

```
Test Files  31 passed (31)
Tests       524 passed (524)
Duration    16.30s
```

No regressions. All 524 tests pass.

---

## Known Stubs

None. The implementation is complete and functional. CLI registration (`brain-cache watch [path]`) is planned for Phase 49 Plan 02.

---

## Self-Check: PASSED

- [x] `src/workflows/watch.ts` exists (min 80 lines — actual: ~140 lines)
- [x] `tests/workflows/watch.test.ts` exists (min 60 lines — actual: 25 tests)
- [x] Commit 1d707fa exists (RED phase)
- [x] Commit 6757236 exists (GREEN phase)
- [x] All 524 tests pass with no regressions
