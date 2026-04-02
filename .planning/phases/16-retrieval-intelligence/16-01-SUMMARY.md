---
phase: 16-retrieval-intelligence
plan: 01
subsystem: retrieval
tags: [intent-classification, vector-search, lancedb, typescript]

requires:
  - phase: 15-data-foundation
    provides: edges table, chunker pipeline, LanceDB write mutex

provides:
  - QueryIntent type with three modes: lookup, trace, explore
  - classifyRetrievalMode function with multi-word keyword matching
  - RETRIEVAL_STRATEGIES map with mode-specific limits and thresholds
  - FlowHop interface for Phase 16 Plan 02 flow tracer
  - Deprecated classifyQueryIntent re-export alias for backward compat

affects:
  - 16-02 (flow tracer — uses FlowHop and QueryIntent)
  - 17-mcp-tools (trace_flow, explain_codebase tools use retrieval modes)

tech-stack:
  added: []
  patterns:
    - "Multi-word phrase matching for trace keywords (array + regex)"
    - "Exclusion guard pattern: lookup keyword + explore exclusion = explore"
    - "Ambiguity guard: trace prefix + broad architectural terms = explore wins"

key-files:
  created: []
  modified:
    - src/lib/types.ts
    - src/lib/config.ts
    - src/lib/index.ts
    - src/services/retriever.ts
    - src/workflows/buildContext.ts
    - src/workflows/search.ts
    - tests/services/retriever.test.ts
    - tests/workflows/buildContext.test.ts
    - tests/workflows/search.test.ts

key-decisions:
  - "TRACE_KEYWORDS use multi-word phrases only (not single tokens like 'trace') to avoid false positives"
  - "Ambiguity guard added: 'trace the architecture' -> explore (not trace) because broad terms win"
  - "classifyQueryIntent kept as deprecated re-export alias to avoid breaking external callers"
  - "DIAGNOSTIC_DISTANCE_THRESHOLD and DIAGNOSTIC_SEARCH_LIMIT removed from config — inline in RETRIEVAL_STRATEGIES"

patterns-established:
  - "Retrieval modes: lookup={limit:5, distanceThreshold:0.25}, trace={limit:3, distanceThreshold:0.30}, explore={limit:20, distanceThreshold:0.45}"

requirements-completed: [INTENT-01]

duration: 4min
completed: 2026-04-02
---

# Phase 16 Plan 01: Three-Mode Intent Classifier Summary

**Keyword-based intent classifier expanded from 2 modes (diagnostic/knowledge) to 3 modes (lookup/trace/explore) with mode-specific retrieval parameters and 28 passing tests**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-04-02T19:38:24Z
- **Completed:** 2026-04-02T19:42:30Z
- **Tasks:** 1
- **Files modified:** 9

## Accomplishments

- QueryIntent type changed to `'lookup' | 'trace' | 'explore'` in `src/lib/types.ts`
- `classifyRetrievalMode` implemented with TRACE_KEYWORDS, TRACE_REGEX, LOOKUP_BIGRAMS, LOOKUP_KEYWORDS, EXPLORE_EXCLUSIONS, and ambiguity guard
- RETRIEVAL_STRATEGIES updated: lookup={5,0.25}, trace={3,0.30}, explore={20,0.45}
- FlowHop interface added to `src/lib/types.ts` for Phase 16 Plan 02
- buildContext.ts and search.ts updated to use `classifyRetrievalMode`
- 254 total tests passing (no regressions)

## Task Commits

1. **Task 1: Update types and implement three-mode classifier with strategy map** - `b1406a3` (feat)

**Plan metadata:** (see final commit)

## Files Created/Modified

- `src/lib/types.ts` - QueryIntent changed to 3 modes; FlowHop interface added
- `src/lib/config.ts` - DIAGNOSTIC_DISTANCE_THRESHOLD and DIAGNOSTIC_SEARCH_LIMIT removed
- `src/lib/index.ts` - Removed deprecated DIAGNOSTIC_* re-exports; added FlowHop export
- `src/services/retriever.ts` - classifyRetrievalMode with 3-mode logic; RETRIEVAL_STRATEGIES updated; deprecated alias
- `src/workflows/buildContext.ts` - Imports classifyRetrievalMode; uses mode variable
- `src/workflows/search.ts` - Imports classifyRetrievalMode; uses mode variable
- `tests/services/retriever.test.ts` - Full rewrite for 3-mode tests (28 tests)
- `tests/workflows/buildContext.test.ts` - Updated mocks for new function name and strategy keys
- `tests/workflows/search.test.ts` - Updated mocks for new function name and strategy keys

## Decisions Made

- Multi-word `TRACE_KEYWORDS` (not single token `'trace'`) to prevent false positives on phrases like "trace the error"
- Ambiguity guard: queries containing broad/architectural terms (`architecture`, `pipeline`, `codebase`, etc.) default to `explore` even if TRACE_KEYWORDS match
- `classifyQueryIntent` kept as a deprecated re-export alias — avoids breaking external callers not yet updated
- Removed DIAGNOSTIC_* constants from config — they were only used in retriever and are now inlined in RETRIEVAL_STRATEGIES

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated workflow test mocks for renamed function and new strategy keys**
- **Found during:** Task 1 (full test suite run after implementation)
- **Issue:** `tests/workflows/buildContext.test.ts` and `tests/workflows/search.test.ts` mocked `classifyQueryIntent` with `diagnostic`/`knowledge` strategy keys; after rename these were undefined exports
- **Fix:** Updated vi.mock factories to export `classifyRetrievalMode` with `lookup`/`trace`/`explore` strategy keys; updated all mock.mockReturnValue calls accordingly
- **Files modified:** tests/workflows/buildContext.test.ts, tests/workflows/search.test.ts
- **Verification:** All 254 tests pass
- **Committed in:** b1406a3 (task commit)

**2. [Rule 1 - Bug] Fixed embedBatchWithRetry mock return shape in workflow tests**
- **Found during:** Task 1 (full test suite run)
- **Issue:** Workflow test mocks returned `[queryVector]` (plain array) but `embedBatchWithRetry` returns `{ embeddings: number[][], skipped: number }` — destructuring `{ embeddings: vectors }` produced undefined
- **Fix:** Updated both workflow test mocks to return `{ embeddings: [queryVector], skipped: 0 }`
- **Files modified:** tests/workflows/buildContext.test.ts, tests/workflows/search.test.ts
- **Verification:** All 254 tests pass
- **Committed in:** b1406a3 (task commit)

**3. [Rule 1 - Bug] Removed DIAGNOSTIC_* re-exports from src/lib/index.ts**
- **Found during:** Task 1 (TypeScript check after config.ts changes)
- **Issue:** `src/lib/index.ts` re-exported `DIAGNOSTIC_DISTANCE_THRESHOLD` and `DIAGNOSTIC_SEARCH_LIMIT` which no longer exist in config.ts
- **Fix:** Removed the two deleted constants from index.ts exports; added `FlowHop` export
- **Files modified:** src/lib/index.ts
- **Verification:** `npx tsc --noEmit` exits 0
- **Committed in:** b1406a3 (task commit)

---

**Total deviations:** 3 auto-fixed (3 Rule 1 bugs)
**Impact on plan:** All auto-fixes required for TypeScript compilation and test correctness. No scope creep.

## Issues Encountered

None beyond the deviations documented above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Three-mode intent classifier is ready; Phase 16 Plan 02 (flow tracer) can import `QueryIntent` and `FlowHop` from types.ts
- RETRIEVAL_STRATEGIES[mode] lookup pattern is consistent across buildContext and search workflows
- No blockers

## Self-Check: PASSED

- src/lib/types.ts: FOUND
- src/services/retriever.ts: FOUND
- 16-01-SUMMARY.md: FOUND
- commit b1406a3: FOUND

---
*Phase: 16-retrieval-intelligence*
*Completed: 2026-04-02*
