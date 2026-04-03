---
phase: 17-new-mcp-tools-and-workflows
plan: 02
subsystem: api
tags: [mcp-tools, trace_flow, explain_codebase, workflows, buildContext, compression, configLoader]

# Dependency graph
requires:
  - phase: 17-01
    provides: FlowHop with callsFound, compressChunk, loadUserConfig, resolveStrategy
  - phase: 16-retrieval-intelligence
    provides: traceFlow BFS, cohesion grouping, RETRIEVAL_STRATEGIES
provides:
  - runTraceFlow workflow with seed search + BFS + compression
  - runExplainCodebase workflow with explore retrieval + cohesion + compression
  - trace_flow MCP tool (Tool 5) returning hops[] with filePath, name, startLine, content, callsFound
  - explain_codebase MCP tool (Tool 6) returning module-grouped ContextResult
  - buildContext routing: trace -> runTraceFlow, explore -> runExplainCodebase, lookup -> inline
  - configLoader wired into all buildContext query paths
affects:
  - CLAUDE.md MCP tool descriptions (phase 19)
  - Any callers of buildContext (now uses loadUserConfig per call)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "runTraceFlow delegates to traceFlow service; adapts FlowHop[] to output hops with compressed content"
    - "runExplainCodebase uses explore strategy with enrichWithParentClass + compressChunk before cohesion grouping"
    - "buildContext routes by mode: trace (with edges) -> runTraceFlow, explore -> runExplainCodebase, else inline"
    - "MCP tool guard pattern: readProfile check + isOllamaRunning check before workflow delegation"

key-files:
  created:
    - src/workflows/traceFlow.ts
    - src/workflows/explainCodebase.ts
    - tests/workflows/traceFlow.test.ts
    - tests/workflows/explainCodebase.test.ts
  modified:
    - src/mcp/index.ts
    - src/workflows/buildContext.ts
    - tests/workflows/buildContext.test.ts

key-decisions:
  - "buildContext explore mode delegates entirely to runExplainCodebase (avoids duplicate logic)"
  - "buildContext trace mode still assembles context and groups after runTraceFlow (adds cohesion step)"
  - "buildContext tests updated to mock runTraceFlow/runExplainCodebase instead of lower-level service mocks"
  - "localTasksPerformed for lookup/fallback path now includes compress step (was missing in prior version)"

requirements-completed: [FLOW-02, TOOL-02, ADV-01, COMP-01]

# Metrics
duration: 30min
completed: 2026-04-03
---

# Phase 17 Plan 02: MCP Tools and Workflow Routing Summary

**trace_flow and explain_codebase MCP tools registered; buildContext routes trace queries through runTraceFlow and explore queries through runExplainCodebase; all paths use configLoader for user-configurable retrieval depth**

## Performance

- **Duration:** ~30 min
- **Started:** 2026-04-03T04:00:00Z
- **Completed:** 2026-04-03T04:22:34Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments

- Created `src/workflows/traceFlow.ts` with `runTraceFlow`: embed query -> seed search -> BFS trace -> compress -> TraceFlowResult
- Created `src/workflows/explainCodebase.ts` with `runExplainCodebase`: embed -> explore search -> enrich -> compress -> cohesion group -> ContextResult
- Both workflows use `loadUserConfig` + `resolveStrategy` for configurable retrieval depth
- Both workflows apply `compressChunk` to oversized content
- Registered `trace_flow` (Tool 5) and `explain_codebase` (Tool 6) in MCP server — 6 total tools
- Updated `buildContext` to delegate trace mode to `runTraceFlow`, explore mode to `runExplainCodebase`
- Wired `loadUserConfig` + `resolveStrategy` into all `buildContext` query paths
- Applied `compressChunk` to lookup/fallback path (was missing before)
- Updated `buildContext` tests to mock new workflow dependencies
- 31 new tests + 367 total tests passing; build succeeds

## Task Commits

1. **Task 1: Create runTraceFlow and runExplainCodebase workflows with tests** - `db6906b` (feat)
2. **Task 2: Register MCP tools and update buildContext routing** - `03dbfdc` (feat)

## Files Created/Modified

- `src/workflows/traceFlow.ts` - runTraceFlow: seed search + BFS + compression -> TraceFlowResult
- `src/workflows/explainCodebase.ts` - runExplainCodebase: explore retrieval + enrich + compress + cohesion -> ContextResult
- `src/mcp/index.ts` - Added trace_flow (Tool 5) and explain_codebase (Tool 6) registrations
- `src/workflows/buildContext.ts` - Routing + configLoader + compression wired; delegations to new workflows
- `tests/workflows/traceFlow.test.ts` - 17 tests for runTraceFlow
- `tests/workflows/explainCodebase.test.ts` - 14 tests for runExplainCodebase
- `tests/workflows/buildContext.test.ts` - Updated: mocks new workflow dependencies, added explore mode tests

## Decisions Made

- buildContext explore mode delegates entirely to runExplainCodebase to avoid duplicating explore logic
- buildContext trace mode runs runTraceFlow then still applies assembleContext + groupChunksByFile (extra cohesion step over raw hops)
- buildContext tests updated to mock runTraceFlow/runExplainCodebase — lower-level service mocks not appropriate for delegation tests
- localTasksPerformed for lookup/fallback path now includes 'compress' step (auto-fix: was omitted in prior implementation)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Test assertions for resolveStrategy called with `expect.anything()` instead of `undefined`**
- **Found during:** Task 1 (GREEN phase test run)
- **Issue:** Tests asserted `resolveStrategy` was called with `expect.anything()` as third arg when no opts provided. The implementation correctly passes `undefined` when no limit/distanceThreshold opts are given.
- **Fix:** Updated both traceFlow.test.ts and explainCodebase.test.ts to assert `undefined` instead of `expect.anything()`
- **Files modified:** tests/workflows/traceFlow.test.ts, tests/workflows/explainCodebase.test.ts
- **Verification:** All 31 tests pass

**2. [Rule 2 - Missing functionality] compressChunk not applied in buildContext lookup/fallback path**
- **Found during:** Task 2 implementation
- **Issue:** Original buildContext did not call compressChunk in lookup or trace-fallback paths. Only the new explore delegation path would get compression. Per plan requirement "All query paths apply compressChunk to oversized chunks".
- **Fix:** Added `enriched.map(compressChunk)` in lookup/fallback branch; updated localTasksPerformed to include 'compress'
- **Files modified:** src/workflows/buildContext.ts
- **Verification:** Tests updated to match new localTasksPerformed list; all 367 tests pass

---

**Total deviations:** 2 (1 test fix, 1 missing functionality auto-added)
**Impact on plan:** Test fix required for correctness. Compression addition aligned with plan's must_haves truth "Chunks exceeding compression threshold have bodies stripped".

## Known Stubs

None — all data flows are wired end-to-end.

## Self-Check: PASSED

Files exist:
- src/workflows/traceFlow.ts ✓
- src/workflows/explainCodebase.ts ✓
- tests/workflows/traceFlow.test.ts ✓
- tests/workflows/explainCodebase.test.ts ✓

Commits in git log:
- db6906b ✓
- 03dbfdc ✓

Build: succeeds ✓
Tests: 367 passed ✓

---
*Phase: 17-new-mcp-tools-and-workflows*
*Completed: 2026-04-03*
