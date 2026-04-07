---
phase: 55-critical-fixes
plan: 02
subsystem: workflows, mcp
tags: [stderr, error-classes, refactor, crit-01, crit-02]
dependency_graph:
  requires: [55-01]
  provides: [withStderrFilter-wired, NoIndexError-wired]
  affects:
    - src/workflows/index.ts
    - src/workflows/watch.ts
    - src/workflows/search.ts
    - src/workflows/buildContext.ts
    - src/workflows/status.ts
    - src/mcp/guards.ts
    - tests/mcp/server.test.ts
tech_stack:
  added: []
  patterns: [stack-based-filter-wired, typed-error-instanceof]
key_files:
  created: []
  modified:
    - src/workflows/index.ts
    - src/workflows/watch.ts
    - src/workflows/search.ts
    - src/workflows/buildContext.ts
    - src/workflows/status.ts
    - src/mcp/guards.ts
    - tests/mcp/server.test.ts
decisions:
  - Wrap full runIndex body in withStderrFilter rather than just the LanceDB calls — keeps lock acquire/release inside the filter scope and simplifies the function structure
  - Re-import NoIndexError inside beforeEach in server.test.ts to work around vi.resetModules() module identity issue — guards.ts and the test must share the same class instance for instanceof to work
metrics:
  duration: "~3 minutes"
  completed: "2026-04-07"
  tasks_completed: 2
  files_changed: 7
---

# Phase 55 Plan 02: Wire withStderrFilter and NoIndexError into Codebase — Summary

Wired `withStderrFilter` into `index.ts` and `watch.ts` (eliminating raw `process.stderr.write` monkey-patching), and replaced all bare `Error('No index found...')` throws with `new NoIndexError(rootDir)` across three workflow files, updating `guards.ts` to use `instanceof NoIndexError` and fixing test mocks accordingly.

## What Was Built

### Task 1: withStderrFilter wired into index.ts and watch.ts (CRIT-01)

**`src/workflows/index.ts`:** The full body of `runIndex` is now wrapped in `withStderrFilter` with a LanceDB log suppression filter. The `originalStderrWrite` variable and the `process.stderr.write = ...` assignment and restore are removed. The `withStderrFilter` callback captures `previousLogLevel` and the try/finally block — the finally no longer needs to restore stderr since the stack-based filter handles it.

**`src/workflows/watch.ts`:** `triggerReindex` now uses `withStderrFilter` with a capture filter (`(line) => { captured.push(line); return true; }`) to collect and suppress runIndex's output. The old manual monkey-patch (`originalWrite`, the direct assignment, and both restore points in try and catch) are removed. Nesting is now safe: watch calls runIndex via withStderrFilter, and runIndex's own withStderrFilter correctly stacks and pops without corrupting the outer capture.

### Task 2: NoIndexError wired across workflows and guards (CRIT-02)

**`src/workflows/search.ts`:** Imports `NoIndexError` and throws `new NoIndexError(rootDir)` instead of bare Error.

**`src/workflows/buildContext.ts`:** Same replacement.

**`src/workflows/status.ts`:** Same replacement. Old message said "index [path]" — NoIndexError standardizes to "index" (intentional unification).

**`src/mcp/guards.ts`:** Imports `NoIndexError` and uses `err instanceof NoIndexError` instead of `err.message.includes("No index found")`. The DEBT-01 comment is removed — the debt is resolved.

**`tests/mcp/server.test.ts`:** The `NoIndexError` class is re-imported inside `beforeEach` (after `createMcpServer()` loads the server module) to ensure the test and guards.ts share the same class instance. This works around `vi.resetModules()` in `afterEach` which clears the module cache between tests — without re-import, the top-level import gives a stale class that fails `instanceof` against the freshly-loaded guards.ts class. All four mock throw sites updated from `new Error('No index found...')` to `new NoIndexError('/some/project')`.

## Commits

| Hash | Description |
|------|-------------|
| cb2abd1 | feat(55-02): replace stderr monkey-patching with withStderrFilter in index.ts and watch.ts |
| 1277541 | feat(55-02): replace string-based error detection with NoIndexError across workflows and guards |

## Test Results

- Full test suite: 552/552 pass
- `tests/workflows/watch.test.ts`: 25/25 pass
- `tests/lib/stderr.test.ts`: 5/5 pass
- `tests/mcp/server.test.ts`: 20/20 pass
- `tests/lib/errors.test.ts`: 6/6 pass

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] vi.resetModules() module identity breaks instanceof NoIndexError in tests**

- **Found during:** Task 2 verification
- **Issue:** `server.test.ts` calls `vi.resetModules()` in afterEach, then re-imports `server.js` dynamically in beforeEach. This causes guards.ts to load a fresh `errors.ts` with a new `NoIndexError` class, while the top-level import at line 2 held a stale class. `instanceof NoIndexError` in guards.ts then failed (different class objects), so auto-index tests showed `mockRunIndex` called 0 times.
- **Fix:** Changed top-level `import { NoIndexError }` to `import type { NoIndexError as NoIndexErrorType }` (type-only, no runtime value), then added `let NoIndexError: typeof NoIndexErrorType` inside the describe block, re-assigned inside `beforeEach` after the dynamic server import completes. This ensures the test and guards.ts always share the same class instance.
- **Files modified:** `tests/mcp/server.test.ts`
- **Commit:** 1277541

## Known Stubs

None. Both CRIT-01 and CRIT-02 are fully wired and functional.

## Self-Check: PASSED
