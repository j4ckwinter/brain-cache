---
phase: 24-compression-and-savings-accuracy
plan: "02"
subsystem: workflows
tags: [token-savings, traceFlow, mcp, compression]

requires:
  - phase: 24-01
    provides: compression accuracy fixes for buildContext

provides:
  - Real token savings computation in runTraceFlow (tokensSent, estimatedWithoutBraincache, reductionPct, filesInContext)
  - MCP trace_flow handler reading savings from result.metadata via formatTokenSavings
  - computeHopSavings() helper in traceFlow.ts mirroring buildContext.ts savings pattern

affects: [trace_flow MCP handler, traceFlow workflow, server tests]

tech-stack:
  added: []
  patterns:
    - "computeHopSavings() helper: count tokensSent from hop content, estimate without = file tokens + toolCallOverhead, reductionPct via Math.round(1 - sent/estimated)"
    - "MCP handler destructures savings fields from result.metadata and passes to formatTokenSavings — no fabrication in handler layer"

key-files:
  created: []
  modified:
    - src/workflows/traceFlow.ts
    - src/mcp/index.ts
    - tests/workflows/traceFlow.test.ts
    - tests/mcp/server.test.ts

key-decisions:
  - "computeHopSavings uses same BODY_STRIPPED_MARKER + readFile per file pattern as buildContext.ts — consistent savings methodology across tools"
  - "Zero-hop path short-circuits with all-zero savings inline (no helper call needed)"
  - "MCP handler uses destructuring pattern matching buildContext handler, not direct property access"

patterns-established:
  - "Savings fields (tokensSent, estimatedWithoutBraincache, reductionPct, filesInContext) are workflow-layer concerns — computed in runTraceFlow, not in MCP handler"

requirements-completed: [OUT-02]

duration: 2min
completed: 2026-04-03
---

# Phase 24 Plan 02: Compression and Savings Accuracy Summary

**Real token savings computed from file content in runTraceFlow, replacing hardcoded reductionPct:67 and tokensSent*3 in the MCP trace_flow handler**

## Performance

- **Duration:** 2 min
- **Started:** 2026-04-03T06:46:30Z
- **Completed:** 2026-04-03T06:48:50Z
- **Tasks:** 1 (TDD: RED + GREEN)
- **Files modified:** 4

## Accomplishments
- Added `computeHopSavings()` helper to `traceFlow.ts` mirroring `buildContext.ts` savings pattern
- Extended `TraceFlowResult.metadata` with `tokensSent`, `estimatedWithoutBraincache`, `reductionPct`, `filesInContext`
- Updated `trace_flow` MCP handler to read savings from `result.metadata` and format with `formatTokenSavings`
- All 403 tests pass (6 new tests added)

## Task Commits

Each task was committed atomically:

1. **Task 1 RED: Failing tests for token savings** - `3237658` (test)
2. **Task 1 GREEN: Implement savings computation** - `0e06e58` (feat)

**Plan metadata:** (docs commit — see below)

_Note: TDD task had RED + GREEN commits_

## Files Created/Modified
- `src/workflows/traceFlow.ts` - Added readFile/countChunkTokens/TOOL_CALL_OVERHEAD_TOKENS imports, extended TraceFlowResult.metadata type, added computeHopSavings() helper, updated both return paths with savings
- `src/mcp/index.ts` - Updated trace_flow handler to destructure savings from result.metadata and pass to formatTokenSavings
- `tests/workflows/traceFlow.test.ts` - Added vi.mock for node:fs/promises, added 6 tests in 'token savings computation (OUT-02)' describe block
- `tests/mcp/server.test.ts` - Fixed trace_flow success mock to include new metadata savings fields

## Decisions Made
- `computeHopSavings` uses same `BODY_STRIPPED_MARKER` + `readFile` per unique file pattern as `buildContext.ts` — maintains consistent savings methodology
- Zero-hop path short-circuits with inline zeros rather than calling helper — clean and clear
- MCP handler uses destructuring then passes to `formatTokenSavings` — matches buildContext handler pattern exactly

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed server.test.ts mock missing new metadata savings fields**
- **Found during:** Task 1 GREEN (full suite run)
- **Issue:** `tests/mcp/server.test.ts` trace_flow success test mocked `runTraceFlow` without `metadata` containing savings fields; destructuring in updated handler threw, causing `isError: true`
- **Fix:** Added `metadata` object with all savings fields to the mock return value in `server.test.ts`
- **Files modified:** `tests/mcp/server.test.ts`
- **Verification:** Full test suite passes: 403/403
- **Committed in:** `0e06e58` (Task 1 GREEN commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Required fix — test mock was incomplete for the new contract. No scope creep.

## Issues Encountered
None beyond the auto-fixed mock update.

## Next Phase Readiness
- OUT-02 complete: trace_flow now reports accurate token savings
- All three MCP context tools (build_context, search_codebase, trace_flow) now report real savings via formatTokenSavings
- No blockers for subsequent phases

---
*Phase: 24-compression-and-savings-accuracy*
*Completed: 2026-04-03*
