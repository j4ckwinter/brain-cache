---
phase: 25-tool-routing-documentation
plan: 01
subsystem: mcp
tags: [mcp, tool-descriptions, routing, claude-routing]

# Dependency graph
requires:
  - phase: 17-new-mcp-tools-and-workflows
    provides: trace_flow and explain_codebase tool registrations in src/mcp/index.ts
  - phase: 19-claude.md-refinements
    provides: CLAUDE.md routing table with tool selection guidance
provides:
  - Explicit "Do NOT use this tool" negative guards in all 4 query-routing tool descriptions
  - Removal of overconfident "Prefer this tool" framing from build_context
  - Test assertions locking the negative-example wording in server.test.ts
affects: [mcp, claude-routing, tool-selection, build_context, trace_flow, search_codebase, explain_codebase]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Negative-example pattern in MCP tool descriptions: 'Do NOT use this tool when X — use Y instead'"

key-files:
  created: []
  modified:
    - src/mcp/index.ts
    - tests/mcp/server.test.ts

key-decisions:
  - "Negative guards use imperative 'Do NOT use this tool when...' pattern — matches directive tone of CLAUDE.md routing table"
  - "build_context loses 'Prefer this tool' framing — replaced with neutral 'Use this tool' to avoid over-selection vs trace_flow"
  - "build_context gets 2 negative guards (trace_flow and explain_codebase); others each get 1"
  - "Test assertions use registeredTools.get(name).schema.description — same pattern as existing handler tests"

patterns-established:
  - "MCP tool descriptions carry both positive use-case and negative anti-pattern guards for query routing"

requirements-completed: [ROUTE-01]

# Metrics
duration: 3min
completed: 2026-04-03
---

# Phase 25 Plan 01: Tool Routing Documentation Summary

**Negative-example routing guards added to all 4 MCP tool descriptions, removing "Prefer" over-selection framing and locking with test assertions**

## Performance

- **Duration:** 3 min
- **Started:** 2026-04-03T14:59:41Z
- **Completed:** 2026-04-03T15:02:41Z
- **Tasks:** 2 (TDD: test RED + implementation GREEN)
- **Files modified:** 2

## Accomplishments

- Added "Do NOT use this tool when..." negative guards to build_context (2), search_codebase (1), trace_flow (1), and explain_codebase (1)
- Replaced "Prefer this tool" framing in build_context with neutral "Use this tool" to prevent over-selection
- Added 4 test assertions in a new "tool description negative examples" describe block in server.test.ts
- Full test suite remains green: 482/482 tests pass

## Task Commits

Each task was committed atomically:

1. **Task 1: Add negative-example assertions to server.test.ts** - `d027a1d` (test)
2. **Task 2: Update MCP tool descriptions with negative examples** - `9b60d08` (feat)

## Files Created/Modified

- `src/mcp/index.ts` - Updated 4 tool description strings with negative guards and removed "Prefer" framing
- `tests/mcp/server.test.ts` - Added "tool description negative examples" describe block with 4 test cases

## Decisions Made

- Negative guards use the exact "Do NOT use this tool when..." pattern from CLAUDE.md routing table — consistent framing across both places Claude consults for routing
- build_context gets 2 negative guards because it is over-selected for both call-path tracing (trace_flow) and architecture overviews (explain_codebase)
- "Prefer this tool" removed from build_context because it creates a bias that causes Claude to route all multi-file questions there even when trace_flow is more appropriate

## Deviations from Plan

Minor: Plan acceptance criteria said `grep -c "Do NOT use this tool" src/mcp/index.ts` returns 6. Actual result: 5 matching lines (build_context's line has 2 occurrences but `grep -c` counts matching lines). The actual occurrence count via `grep -o | wc -l` is 5 (2 for build_context + 1 each for the other 3). The plan description was internally consistent (2+1+1+1 = 5), so the "6" in the criteria was a minor error. All test assertions pass and the intent is fully satisfied.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 25, Plan 02 can proceed (CLAUDE.md tool routing table update)
- All 4 query-routing tools now have explicit cross-tool negative guards at both the MCP description level and (after plan 02) the CLAUDE.md level

## Self-Check: PASSED

- FOUND: src/mcp/index.ts
- FOUND: tests/mcp/server.test.ts
- FOUND: .planning/phases/25-tool-routing-documentation/25-01-SUMMARY.md
- FOUND commit: d027a1d (test RED)
- FOUND commit: 9b60d08 (feat GREEN)

---
*Phase: 25-tool-routing-documentation*
*Completed: 2026-04-03*
