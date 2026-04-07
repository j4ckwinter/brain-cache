---
phase: 55-critical-fixes
plan: 01
subsystem: lib
tags: [stderr, error-classes, tdd, utilities]
dependency_graph:
  requires: []
  provides: [withStderrFilter, NoIndexError]
  affects: [src/lib/index.ts]
tech_stack:
  added: []
  patterns: [stack-based-filter, typed-error-class, tdd-red-green]
key_files:
  created:
    - src/lib/stderr.ts
    - src/lib/errors.ts
    - tests/lib/stderr.test.ts
    - tests/lib/errors.test.ts
  modified:
    - src/lib/index.ts
decisions:
  - LIFO filter stack with single shared interceptor at module load time — avoids re-assignment corruption
  - Object.setPrototypeOf in NoIndexError constructor — required for instanceof to work after TS compilation
metrics:
  duration: "~2 minutes"
  completed: "2026-04-07"
  tasks_completed: 2
  files_changed: 5
---

# Phase 55 Plan 01: Critical Fixes Foundation — Summary

Stack-based stderr filter utility (`withStderrFilter`) and typed error class (`NoIndexError`) created using TDD with all 11 tests passing.

## What Was Built

### Task 1: withStderrFilter (CRIT-01 foundation)

`src/lib/stderr.ts` installs a single shared interceptor on `process.stderr.write` at module load time. Filters coordinate through a `filterStack` array using push/pop — no repeated `process.stderr.write` assignments. `withStderrFilter` wraps an async function with a filter active in a try/finally block, guaranteeing the filter is popped even on error.

Key properties:
- LIFO iteration (`for (let i = filterStack.length - 1; i >= 0; i--)`) means innermost filter runs first
- Nested calls compose correctly — inner filter pops without affecting outer filter
- Single interceptor = no nesting bug where restore overwrites a caller's patch

### Task 2: NoIndexError (CRIT-02 foundation)

`src/lib/errors.ts` defines a `NoIndexError extends Error` class with `readonly rootDir: string`. `Object.setPrototypeOf(this, new.target.prototype)` is placed after `super()` to ensure `instanceof NoIndexError` works correctly in compiled JavaScript.

Both are re-exported from `src/lib/index.ts`.

## Commits

| Hash | Description |
|------|-------------|
| baaf44b | test(55-01): add failing tests for withStderrFilter |
| 1ec1ab9 | feat(55-01): implement withStderrFilter stack-based stderr utility |
| 17664fb | test(55-01): add failing tests for NoIndexError |
| d95f4d0 | feat(55-01): implement NoIndexError typed error class |

## Test Results

- `tests/lib/stderr.test.ts`: 5/5 pass
- `tests/lib/errors.test.ts`: 6/6 pass
- Total: 11/11 pass

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None. Both utilities are fully implemented and functional.

## Self-Check: PASSED
