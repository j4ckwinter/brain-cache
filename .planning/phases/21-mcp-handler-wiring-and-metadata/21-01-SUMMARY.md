---
phase: 21-mcp-handler-wiring-and-metadata
plan: "01"
subsystem: mcp-presentation
tags: [mcp, formatters, presentation, token-savings, pipeline-label]
dependency_graph:
  requires: [src/lib/format.ts, src/mcp/index.ts]
  provides: [formatPipelineLabel, formatted-mcp-responses]
  affects: [all-6-mcp-tools]
tech_stack:
  added: []
  patterns: [helper-function-extraction, formatter-delegation]
key_files:
  created: []
  modified:
    - src/lib/format.ts
    - src/mcp/index.ts
    - tests/lib/format.test.ts
decisions:
  - "formatErrorEnvelope imported but not used in handlers — error paths use inline string interpolation; consistent with existing pattern"
  - "ollamaStatus narrowed with 'as' type assertion to satisfy DoctorHealth literal union type"
  - "buildSearchResponse and buildContextResponse extracted as module-level helpers to avoid duplication across normal and auto-index-retry paths"
metrics:
  duration_minutes: 2
  tasks_completed: 2
  files_modified: 3
  completed_date: "2026-04-03"
---

# Phase 21 Plan 01: MCP Handler Wiring and Metadata Summary

**One-liner:** Wire all 6 MCP handlers to Phase 20 formatters replacing JSON.stringify, adding token savings footers and pipeline labels to 4 retrieval tools.

---

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add formatPipelineLabel to format.ts | 4f3f670 | src/lib/format.ts, tests/lib/format.test.ts |
| 2 | Wire all 6 MCP handlers to formatters | d2107f3 | src/mcp/index.ts |

---

## What Was Built

### formatPipelineLabel (format.ts)

Added `export function formatPipelineLabel(tasks: string[]): string` that joins task labels with ` -> ` separator. Handles empty array (returns `''`), single task (no separator), and multi-task arrays. Three test cases added to `tests/lib/format.test.ts`.

### MCP Handler Wiring (src/mcp/index.ts)

Replaced the single `formatTokenSavings` import with all 9 formatter functions from `../lib/format.js`. Added type imports for `ContextResult` and `RetrievedChunk`.

Two module-level helper functions extracted to avoid duplication across normal and auto-index-retry paths:
- `buildSearchResponse(chunks, query)` — used by both `search_codebase` success paths
- `buildContextResponse(result, query)` — used by both `build_context` success paths

Handler changes:
- **index_repo**: `JSON.stringify(result)` → `formatIndexResult(result)`
- **search_codebase**: `JSON.stringify(chunks)` → `formatToolResponse(summary, formatSearchResults + footer)` with token savings and pipeline label
- **build_context**: `JSON.stringify({...result, tokenSavings})` → `formatToolResponse(summary, formatContext + footer)` with token savings and pipeline label
- **doctor**: `JSON.stringify(health)` → `formatDoctorOutput(health)` directly (no `formatToolResponse` wrapper)
- **trace_flow**: `JSON.stringify(result)` → `formatToolResponse(summary, formatTraceFlow + footer)` with token savings and pipeline label
- **explain_codebase**: manual string concat → `formatToolResponse(summary, formatContext + footer)` with token savings and pipeline label

---

## Verification Results

1. `grep -c "JSON.stringify" src/mcp/index.ts` → **0** (zero remaining)
2. `grep "formatPipelineLabel" src/lib/format.ts` → exported function present
3. `grep "Pipeline:" src/mcp/index.ts` → **4 matches** (one per retrieval tool footer)
4. `npm run test -- tests/lib/format.test.ts` → **52 tests passed**
5. `npx tsc --noEmit` → **no errors**

---

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] ollamaStatus type narrowing for DoctorHealth**
- **Found during:** Task 2
- **Issue:** `health.ollamaStatus` was inferred as `string` from ternary expression, not assignable to `'not_installed' | 'running' | 'not_running'` literal union required by `DoctorHealth`
- **Fix:** Added `as 'not_installed' | 'running' | 'not_running'` type assertion on the ternary result
- **Files modified:** src/mcp/index.ts
- **Commit:** d2107f3

None other — plan executed with one auto-fix for a type narrowing issue.

---

## Known Stubs

None — all 6 handlers produce live formatted output. No hardcoded empty values or placeholder text.

---

## Self-Check: PASSED

- [x] src/lib/format.ts exists and exports formatPipelineLabel
- [x] src/mcp/index.ts exists with all 6 handlers wired
- [x] tests/lib/format.test.ts has formatPipelineLabel tests
- [x] Commit 4f3f670 exists (Task 1)
- [x] Commit d2107f3 exists (Task 2)
