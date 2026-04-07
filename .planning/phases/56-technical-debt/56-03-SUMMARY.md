---
phase: 56-technical-debt
plan: 03
subsystem: workflows
tags: [refactoring, index-pipeline, typescript, decomposition]

requires:
  - phase: 55-critical-fixes
    provides: withStderrFilter and NoIndexError foundations used by index workflow

provides:
  - runIndex decomposed into 7 named pipeline stage functions
  - Typed result interfaces for each pipeline stage
  - Stage functions exported for future unit testing

affects: [57-performance, 61-test-coverage]

tech-stack:
  added: []
  patterns:
    - "Pipeline stage functions: each stage takes explicit typed parameters and returns a typed result object"
    - "Pre-lock setup pattern: log level suppression and path resolution happen before lock acquisition in runIndex"

key-files:
  created: []
  modified:
    - src/workflows/index.ts

key-decisions:
  - "resolveAndSetup called inside try block (after lock) so requireProfile failures trigger releaseIndexLock in finally"
  - "Stage functions do not share mutable state — each takes explicit parameters and returns typed result"
  - "runIndex still owns acquireIndexLock/releaseIndexLock placement (pre-try / finally)"

patterns-established:
  - "Stage extraction pattern: extract inline logic into named async functions with typed inputs/outputs, keep in same file"

requirements-completed: [DEBT-01]

duration: 15min
completed: 2026-04-07
---

# Phase 56 Plan 03: runIndex Decomposition Summary

**320-line runIndex monolith decomposed into 7 named pipeline stage functions with typed result interfaces, reducing runIndex body to ~60 lines**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-04-07T06:56:46Z
- **Completed:** 2026-04-07T07:11:00Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- Extracted 7 named stage functions from `runIndex`: `resolveAndSetup`, `statAndPartition`, `readAndHash`, `diffAndCleanup`, `runChunkEmbedPipeline`, `writeEarlyExitManifest`, `writeManifestAndState`
- Added 6 typed result interfaces: `SetupResult`, `StatPartitionResult`, `ReadHashResult`, `DiffCleanupResult`, `ChunkEmbedResult`, `WriteManifestOpts`
- `runIndex` body reduced to ~60 lines (was 320) — orchestrates stage calls with early-exit path
- All stage functions exported for future independent unit testing
- 559 tests pass without modification (behavior-preserving refactor)

## Task Commits

1. **Task 1: Extract pipeline stages from runIndex** - `9b2d163` (refactor)

**Plan metadata:** (created in final commit)

## Files Created/Modified
- `src/workflows/index.ts` - Decomposed runIndex into 7 named pipeline stage functions with typed interfaces

## Decisions Made
- `resolveAndSetup` is called inside the try block (after `acquireIndexLock`), not before it — this ensures that if `requireProfile()` or `requireOllama()` throw, the `finally` block still calls `releaseIndexLock`. The test "calls releaseIndexLock in finally even when indexing throws" specifically verifies this behavior.
- `runIndex` handles pre-lock setup (log level suppression, path resolution) directly, then acquires lock, then calls `resolveAndSetup` for profile/Ollama/LanceDB setup
- Stage functions do not share mutable context object — each takes explicit typed parameters

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed lock release invariant: resolveAndSetup placed inside try block**
- **Found during:** Task 1 (Extract pipeline stages)
- **Issue:** Initial implementation placed `resolveAndSetup` (including `requireProfile`) before `acquireIndexLock`, meaning if profile load failed the lock was never acquired and `releaseIndexLock` was never called. The plan noted lock must stay in `runIndex` before the try block, but the `try` block placement of `resolveAndSetup` needed adjustment to preserve the test "calls releaseIndexLock in finally even when indexing throws".
- **Fix:** Moved `resolveAndSetup` call into the try block (after `acquireIndexLock`). Pre-lock setup (log level, path resolution) stays in `runIndex` before lock acquisition. This preserves the original behavior where any profile/Ollama failure triggers the finally block.
- **Files modified:** src/workflows/index.ts
- **Verification:** All 46 index.test.ts tests pass, including the lock release test
- **Committed in:** 9b2d163

---

**Total deviations:** 1 auto-fixed (Rule 1 - bug in lock release invariant)
**Impact on plan:** Fix essential for correctness. Stage structure matches plan intent; only the execution ordering was adjusted.

## Issues Encountered
- TypeScript reported `GitConfig` not assignable to `Record<string, unknown>` — fixed by importing and using `GitConfig` type directly in `SetupResult` interface

## Next Phase Readiness
- Stage functions are exported and independently callable — ready for Phase 61 (Test Coverage) to add unit tests per stage
- runIndex orchestrator is readable and ~60 lines — DEBT-01 satisfied
- No blockers

---
*Phase: 56-technical-debt*
*Completed: 2026-04-07*
