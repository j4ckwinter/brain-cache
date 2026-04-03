---
phase: 28-trace-output-quality
plan: "02"
subsystem: workflows
tags: [traceFlow, confidence, cli-bias, tdd, mcp]

requires:
  - phase: 28-01
    provides: "TRACE-01/TRACE-02 test-file exclusion and stdlib symbol filtering in traceFlow"

provides:
  - "LOW_CONFIDENCE_THRESHOLD = 0.5 constant and confidence warning in vector seed path"
  - "isCLIQuery and isCLIFile helpers for CLI seed bias reranking"
  - "confidenceWarning field in TraceFlowResult.metadata (optional string | null)"
  - "MCP trace_flow handler prepends Warning: line when confidenceWarning is set"

affects: [29-explain-depth, mcp-trace-flow-output]

tech-stack:
  added: []
  patterns:
    - "Confidence threshold pattern: similarity < 0.5 triggers warning in vector seed path"
    - "CLI bias: isCLIQuery + isCLIFile pair used to rerank seeds before BFS"
    - "Optional metadata field pattern: confidenceWarning uses ?:  so empty-seed path omits it"

key-files:
  created: []
  modified:
    - src/workflows/traceFlow.ts
    - src/mcp/index.ts
    - tests/workflows/traceFlow.test.ts

key-decisions:
  - "LOW_CONFIDENCE_THRESHOLD = 0.5 — matches Plan 02 spec, same awareness as PREC boost threshold"
  - "isCLIQuery checks space-delimited 'cli' or 'command' keyword — avoids false positives on words containing 'cli' as substring (e.g. 'click')"
  - "confidenceWarning is optional (?: string | null) in interface — empty-seed early return omits it entirely, exact-name path sets it to null, vector path sets string or null"
  - "selectedSeed variable introduced in vector path — replaces seeds[0] for both traceFlow call and seedChunkId metadata"

patterns-established:
  - "CLI bias reranking: seeds.find(s => isCLIFile(s.filePath)) called only when isCLIQuery returns true"
  - "MCP warning prepend: warningLine ternary inserted between summary and formatTraceFlow output"

requirements-completed: [TRACE-03, TRACE-04]

duration: 12min
completed: 2026-04-03
---

# Phase 28 Plan 02: Trace Output Quality — Confidence Warning and CLI Seed Bias Summary

**confidence warning when seed similarity < 0.5 and CLI seed bias promoting src/cli/ seeds for CLI-flavored trace_flow queries**

## Performance

- **Duration:** 12 min
- **Started:** 2026-04-03T11:57:00Z
- **Completed:** 2026-04-03T12:09:00Z
- **Tasks:** 2 (TDD: RED + GREEN)
- **Files modified:** 3

## Accomplishments
- TRACE-03: Low-confidence seed warning surfaces in metadata.confidenceWarning when vector seed similarity < 0.5, including seed name, file, line, and similarity score
- TRACE-04: CLI-flavored queries (containing 'command' or space-delimited 'cli') promote src/cli/ seeds over higher-scoring mid-stack seeds
- MCP handler prepends "Warning: ..." line before trace hops when confidenceWarning is present
- Exact-name path always sets confidenceWarning = null (implicit 1.0 confidence)
- All 518 tests pass with no regressions

## Task Commits

1. **Task 1: RED — Add failing tests for TRACE-03 and TRACE-04** - `9159c4e` (test)
2. **Task 2: GREEN — Implement confidence warning and CLI seed bias** - `2e42371` (feat)

## Files Created/Modified
- `src/workflows/traceFlow.ts` - Added LOW_CONFIDENCE_THRESHOLD, isCLIQuery, isCLIFile, selectedSeed bias, confidenceWarning computation in vector path; confidenceWarning: null in exact-name path
- `src/mcp/index.ts` - Added warningLine construction and prepended to formatToolResponse body
- `tests/workflows/traceFlow.test.ts` - Added 2 new describe blocks (8 tests total): "low-confidence seed warning (TRACE-03)" and "CLI seed bias (TRACE-04)"

## Decisions Made
- LOW_CONFIDENCE_THRESHOLD = 0.5 (matches spec, same awareness as PREC boost threshold from Phase 26)
- isCLIQuery checks ' cli ' (space-bounded), 'cli ' (start), startsWith('cli'), and 'command' — 'cli' as start-of-string included to catch queries like "cli command to storage"
- confidenceWarning uses optional field (?:) so empty-seed early return omits it naturally; exact-name path explicitly sets null; vector path sets string or null based on threshold
- selectedSeed variable replaces seeds[0] in vector path BFS call and seedChunkId metadata — maintains single source of truth for selected seed

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None — worktree was behind master and required a merge before starting. Plan 01 changes merged cleanly via fast-forward before execution.

## Next Phase Readiness
- Phase 28 complete: TRACE-01 through TRACE-04 all satisfied
- Phase 29 (explain-depth) can proceed — depends on compression protection (Phase 27, complete)
- trace_flow now has complete output quality: test file filtering, stdlib filtering, confidence warnings, CLI seed bias

---
*Phase: 28-trace-output-quality*
*Completed: 2026-04-03*

## Self-Check: PASSED

- src/workflows/traceFlow.ts: FOUND — contains LOW_CONFIDENCE_THRESHOLD (line 69), isCLIQuery (line 71), confidenceWarning logic
- src/mcp/index.ts: FOUND — contains confidenceWarning and Warning: line (lines 397-398)
- tests/workflows/traceFlow.test.ts: FOUND
- 28-02-SUMMARY.md: FOUND
- Commit 9159c4e: FOUND
- Commit 2e42371: FOUND
- All 518 tests pass: VERIFIED
