---
phase: 28-trace-output-quality
plan: "01"
subsystem: workflows/traceFlow
tags: [tdd, trace, filtering, noise-reduction, TRACE-01, TRACE-02]
dependency_graph:
  requires: []
  provides: [TRACE-01, TRACE-02]
  affects: [src/workflows/traceFlow.ts]
tech_stack:
  added: []
  patterns: [post-BFS filter, isTestFile helper inlined per-workflow, STDLIB_SYMBOLS blocklist]
key_files:
  created: []
  modified:
    - src/workflows/traceFlow.ts
    - tests/workflows/traceFlow.test.ts
decisions:
  - TEST_FILE_PATTERNS and isTestFile inlined in traceFlow.ts (not shared) per Phase 27 key decision — avoid cross-service coupling
  - STDLIB_SYMBOLS blocklist covers Array, Set/Map, Promise, Object, String methods as a Set for O(1) lookup
  - productionHops filter applied before map() in both exact-name and vector fallback paths so totalHops reflects filtered count
metrics:
  duration_seconds: 129
  completed_date: "2026-04-03"
  tasks_completed: 2
  files_changed: 2
---

# Phase 28 Plan 01: Trace Output Quality Summary

**One-liner:** Post-BFS filters strip test file hops (TRACE-01) and native JS method names from callsFound (TRACE-02) in both exact-name and vector fallback paths.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | RED — Add failing TRACE-01 and TRACE-02 tests | b80de02 | tests/workflows/traceFlow.test.ts |
| 2 | GREEN — Implement post-BFS hop and callsFound filtering | b067610 | src/workflows/traceFlow.ts |

## What Was Built

Added two post-BFS filters to `runTraceFlow` in `src/workflows/traceFlow.ts`:

**TRACE-01 — Test file hop exclusion:**
- Added `TEST_FILE_PATTERNS = ['.test.', '.spec.', '/__tests__/', '/tests/']` constant
- Added `isTestFile(filePath)` helper function
- Applied `flowHops.filter(hop => !isTestFile(hop.filePath))` as `productionHops` in both code paths before hop mapping
- `metadata.totalHops` correctly reflects filtered count

**TRACE-02 — Stdlib symbol filtering:**
- Added `STDLIB_SYMBOLS` Set (Array, Set/Map, Promise, Object, String methods — 60+ symbols)
- Applied `.filter(s => !STDLIB_SYMBOLS.has(s))` on `hop.callsFound` during hop mapping in both exact-name and vector paths

**Test coverage:** 9 new tests across 2 describe blocks; all 510 tests pass.

## Decisions Made

| Decision | Rationale |
|----------|-----------|
| isTestFile inlined (not imported from buildContext.ts) | Phase 27 key decision: helpers inlined per-workflow to avoid cross-service coupling |
| STDLIB_SYMBOLS as Set (not array) | O(1) lookup per callsFound entry — applied on every hop |
| productionHops variable name before map() | Makes filter explicit and keeps the hop-mapping step clean |
| Covers both exact-name and vector paths | Both paths produce the same output interface — filter must apply uniformly |

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None.

## Self-Check: PASSED

- src/workflows/traceFlow.ts: FOUND
- tests/workflows/traceFlow.test.ts: FOUND
- Commit b80de02: FOUND (test(28-01): add failing TRACE-01 and TRACE-02 tests)
- Commit b067610: FOUND (feat(28-01): implement post-BFS test file and stdlib filtering)
- All 510 tests pass: VERIFIED
