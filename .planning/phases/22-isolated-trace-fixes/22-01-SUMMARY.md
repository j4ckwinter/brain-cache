---
phase: 22-isolated-trace-fixes
plan: 01
subsystem: services
tags: [flowTracer, deduplication, callsFound, trace_flow, BFS, edges-table]

# Dependency graph
requires:
  - phase: 17-new-mcp-tools-and-workflows
    provides: traceFlow workflow and flowTracer service with BFS and callsFound output
provides:
  - Set-based deduplication of callsFound entries in FlowHop output
  - Test coverage proving duplicate to_symbol edges produce unique callsFound arrays
affects:
  - 22-02-isolated-trace-fixes (plan 02 uses same flowTracer service)
  - trace_flow MCP tool output quality

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Set spread for array deduplication: [...new Set(arr)] preserves insertion order"

key-files:
  created: []
  modified:
    - src/services/flowTracer.ts
    - tests/services/flowTracer.test.ts

key-decisions:
  - "Set spread ([...new Set(...)]) used over custom dedup loop — one-liner, preserves insertion order, no edge cases"
  - "callsFound dedup applied at the map site in traceFlow, not at the query level — edges table is source of truth, dedup is a display concern"

patterns-established:
  - "TDD Red-Green: write failing test first, then minimal fix to pass"

requirements-completed:
  - OUT-01

# Metrics
duration: 5min
completed: 2026-04-03
---

# Phase 22 Plan 01: Isolated Trace Fixes (callsFound Dedup) Summary

**Set-based deduplication of callsFound in flowTracer.ts eliminates duplicate callee names when edges table has repeated to_symbol rows**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-04-03T12:20:00Z
- **Completed:** 2026-04-03T12:26:28Z
- **Tasks:** 2 (TDD Red + Green)
- **Files modified:** 2

## Accomplishments
- Added failing test proving duplicate to_symbol edges produce duplicate callsFound entries (RED)
- Fixed flowTracer.ts line 102 with single-line Set spread to deduplicate callsFound (GREEN)
- All 16 flowTracer tests pass with zero regressions

## Task Commits

Each task was committed atomically:

1. **Task 1: Add failing test for callsFound deduplication** - `60bf1f3` (test)
2. **Task 2: Apply Set-based dedup to callsFound** - `7ec0052` (fix)

_Note: TDD tasks had two commits (RED test commit, then GREEN fix commit)_

## Files Created/Modified
- `src/services/flowTracer.ts` - Line 102: `callEdges.map(e => e.to_symbol)` → `[...new Set(callEdges.map(e => e.to_symbol))]`
- `tests/services/flowTracer.test.ts` - New test case in `traceFlow — callsFound` describe block covering duplicate to_symbol scenario

## Decisions Made
- Set spread used over custom loop — built-in, preserves insertion order, one-liner
- No type changes to `FlowHop.callsFound: string[]` — the type already supports deduplicated arrays

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

Three tests in `tests/workflows/traceFlow.test.ts` were pre-existing failures related to plan 02 (RET-03 exact-name lookup feature). These are out of scope for plan 01 and will be resolved when plan 02 executes. The flowTracer.test.ts file (this plan's scope) has all 16 tests passing.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Plan 01 complete: OUT-01 requirement fulfilled
- Plan 02 ready to execute: RET-03 (exact-name SQL lookup in traceFlow.ts) is independent and can proceed

---
*Phase: 22-isolated-trace-fixes*
*Completed: 2026-04-03*
