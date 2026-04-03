---
phase: 30-stats-infrastructure
plan: 02
subsystem: mcp
tags: [sessionStats, accumulateStats, fire-and-forget, token-savings, mcp-handlers]

# Dependency graph
requires:
  - phase: 30-stats-infrastructure plan 01
    provides: accumulateStats service, StatsDelta type, SESSION_STATS_PATH constant
provides:
  - Fire-and-forget accumulateStats wiring in all four MCP retrieval handlers
  - Integration tests verifying stats accumulation behavior and error isolation
affects: [31-status-line-rendering, 32-init-integration]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Fire-and-forget stats pattern: call without await, chain .catch(err => log.warn({ err }, 'stats accumulation failed'))"
    - "search_codebase computes delta inline (Math.round(chunks.reduce(...).length/4)), not from result.metadata"
    - "build_context/trace_flow/explain_codebase extract delta from result.metadata"

key-files:
  created: []
  modified:
    - src/mcp/index.ts
    - tests/mcp/server.test.ts

key-decisions:
  - "Fire-and-forget pattern: never await accumulateStats — handler returns before accumulation completes"
  - "search_codebase delta is computed inline from chunks array, not stored in result.metadata (which buildSearchResponse computes internally)"
  - "accumulateStats called on success paths only; error paths (isError: true) never call it"
  - "Both auto-index retry paths in search_codebase and build_context also accumulate stats on success"

patterns-established:
  - "Stats accumulation: placed between result computation and response building, never in catch blocks"

requirements-completed: [STAT-01]

# Metrics
duration: 8min
completed: 2026-04-03
---

# Phase 30 Plan 02: Stats Wiring Summary

**Fire-and-forget accumulateStats calls wired into all four MCP retrieval handlers (search_codebase, build_context, trace_flow, explain_codebase) with 6 integration tests verifying correct delta values and error isolation**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-04-03T13:25:00Z
- **Completed:** 2026-04-03T13:28:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Added import and 6 fire-and-forget `accumulateStats` calls across all four retrieval handlers — completes STAT-01
- Covered both auto-index retry paths in search_codebase and build_context (not just the primary success path)
- Added 6 integration tests confirming: correct delta values per tool, no call on error path, response unaffected by stats failure

## Task Commits

Each task was committed atomically:

1. **Task 1: Wire accumulateStats into all four MCP retrieval handlers** - `0bc3bab` (feat)
2. **Task 2: Add integration tests for stats wiring in MCP handlers** - `1f5fe8e` (test)

**Plan metadata:** (docs commit follows)

## Files Created/Modified

- `src/mcp/index.ts` - Added `import { accumulateStats }` and 6 fire-and-forget calls: 2 in search_codebase (primary + retry), 2 in build_context (primary + retry), 1 in trace_flow, 1 in explain_codebase
- `tests/mcp/server.test.ts` - Added `vi.mock` for sessionStats, `mockAccumulateStats` reference, and `describe('stats accumulation')` block with 6 tests

## Decisions Made

- Fire-and-forget pattern: always `accumulateStats(...).catch(err => log.warn({ err }, ...))`, never `await`
- search_codebase computes delta inline from the `chunks` array (same formula as `buildSearchResponse`) rather than accessing it from `result.metadata` — the search handler has no result metadata object
- Both retry success paths in search_codebase and build_context also accumulate stats, since they represent real successful retrievals
- accumulateStats failure is isolated via `.catch` — the handler response is unaffected

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- STAT-01 fully complete: sessionStats service (Plan 01) + MCP handler wiring (Plan 02) both done
- `~/.brain-cache/session-stats.json` will be updated on every successful retrieval call
- Phase 31 (status line rendering) can now read the stats file and display session savings

## Self-Check: PASSED

- `src/mcp/index.ts` — FOUND
- `tests/mcp/server.test.ts` — FOUND
- `30-02-SUMMARY.md` — FOUND
- Commit `0bc3bab` — FOUND (feat: wire accumulateStats)
- Commit `1f5fe8e` — FOUND (test: stats accumulation tests)
- `grep -c 'accumulateStats' src/mcp/index.ts` → 7 (1 import + 6 calls)
- `grep -c 'await accumulateStats' src/mcp/index.ts` → 0
- Full test suite: 563 tests passing

---
*Phase: 30-stats-infrastructure*
*Completed: 2026-04-03*
