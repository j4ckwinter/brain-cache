---
phase: 22-isolated-trace-fixes
plan: "02"
subsystem: retrieval
tags: [traceFlow, flowTracer, sql-lookup, exact-name, RET-03]

# Dependency graph
requires:
  - phase: 17-new-mcp-tools-and-workflows
    provides: traceFlow workflow and flowTracer service
  - phase: 22-isolated-trace-fixes
    provides: "Plan 01 — callsFound deduplication"
provides:
  - extractSymbolCandidate function in traceFlow.ts (module-private)
  - Exact SQL name lookup branch in runTraceFlow before embedding
  - resolveSymbolToChunkId wired into traceFlow workflow
affects:
  - trace_flow MCP tool (now resolves camelCase symbols without embedding)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Exact-before-vector: attempt SQL name lookup first, fall back to vector search on null"
    - "extractSymbolCandidate: camelCase preference, stop-word filter, module-private"

key-files:
  created: []
  modified:
    - src/workflows/traceFlow.ts
    - tests/workflows/traceFlow.test.ts

key-decisions:
  - "resolveSymbolToChunkId called with empty string fromFile for entry point resolution — no file context available at trace entry"
  - "extractSymbolCandidate prefers camelCase (has [a-z][A-Z] pattern), falls back to last non-stop-word token"
  - "Exact match branch returns early — embedBatchWithRetry, searchChunks, deduplicateChunks are completely skipped"
  - "localTasksPerformed on exact path: ['exact_name_lookup', 'bfs_trace', 'compress'] — no embed_query"
  - "localTasksPerformed on fallback: ['embed_query', 'seed_search', 'bfs_trace', 'compress'] — identical to pre-fix"

patterns-established:
  - "RET-03 exact-name lookup pattern: extract symbol candidate → SQL lookup → fall back to vector if null"

requirements-completed:
  - RET-03

# Metrics
duration: 8min
completed: 2026-04-03
---

# Phase 22 Plan 02: Exact-Name SQL Lookup for trace_flow Entry Point Resolution Summary

**Exact SQL name lookup via extractSymbolCandidate short-circuits embedding for camelCase symbol queries in trace_flow, resolving RET-03**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-04-03T05:26:00Z
- **Completed:** 2026-04-03T05:34:00Z
- **Tasks:** 2 (TDD: RED + GREEN each)
- **Files modified:** 2

## Accomplishments
- Added `extractSymbolCandidate` module-private function that extracts a likely symbol name from a natural-language query (camelCase preference, stop-word filter)
- Added exact SQL name lookup branch in `runTraceFlow` — when a camelCase candidate is found and `resolveSymbolToChunkId` returns a match, embedding is skipped entirely
- Wired `resolveSymbolToChunkId` import from `flowTracer.js` into `traceFlow.ts`
- 5 new RET-03 test cases covering exact path, fallback path, no-candidate path, and localTasksPerformed metadata
- Full test suite: 461 tests passing, 0 failures

## Task Commits

Each task was committed atomically:

1. **Task 1: Add failing tests for exact-name lookup and fallback** - `0c114e3` (test)
2. **Task 2: Implement extractSymbolCandidate and exact-name lookup branch** - `61269d9` (feat)

_Note: TDD tasks committed as test (RED) then feat (GREEN)_

## Files Created/Modified
- `src/workflows/traceFlow.ts` - Added `extractSymbolCandidate` function, `resolveSymbolToChunkId` import, exact-name lookup branch before embedding
- `tests/workflows/traceFlow.test.ts` - Added `resolveSymbolToChunkId` to mock factory, 5 new RET-03 test cases

## Decisions Made
- `resolveSymbolToChunkId` called with `''` (empty string) for `fromFile` — no file context at trace entry point; matches research pitfall guidance
- `extractSymbolCandidate` prefers camelCase tokens (tokens with `[a-z][A-Z]` pattern) over stop-word fallback, ensuring "chunkFile" beats "authenticate" as a candidate
- Exact match branch returns early and completely skips `embedBatchWithRetry`, `searchChunks`, `deduplicateChunks`
- `localTasksPerformed` on exact path is `['exact_name_lookup', 'bfs_trace', 'compress']` — explicitly excludes `embed_query` so callers can detect which path was taken
- Fallback path is strictly identical to pre-fix behavior — no behavior change when exact lookup fails

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Phase 22 plans 01 and 02 are both complete
- `trace_flow` now has: callsFound deduplication (Plan 01) and exact-name SQL lookup (Plan 02)
- RET-03 requirement fully satisfied

---
*Phase: 22-isolated-trace-fixes*
*Completed: 2026-04-03*
