---
phase: 31-status-line-rendering
plan: 01
subsystem: ui
tags: [statusline, mjs, esmscript, token-savings, rendering]

# Dependency graph
requires:
  - phase: 30-stats-infrastructure
    provides: SessionStats interface shape, STATS_TTL_MS constant, session-stats.json IPC file

provides:
  - src/scripts/statusline.mjs: standalone ESM status line script with formatTokenCount, readStats, _readStatsFromPath, renderOutput exports
  - tests/scripts/statusline.test.ts: 19 unit tests covering all pure functions

affects:
  - 31-02-stdin-protocol-wiring
  - 32-init-integration

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Standalone .mjs script with exported pure functions guarded by import.meta.url for main-module detection"
    - "TDD: write failing tests first, then implement to pass"
    - "_readStatsFromPath(filePath) test helper pattern — export a path-parameterized function so tests can inject temp paths without mocking os.homedir"

key-files:
  created:
    - src/scripts/statusline.mjs
    - tests/scripts/statusline.test.ts
  modified: []

key-decisions:
  - "_readStatsFromPath(filePath) exported as test helper — tests inject temp paths directly instead of mocking os.homedir"
  - "Unicode arrow is ↓ (U+2193), not ← (U+2190) — plan spec confirmed down-arrow for savings indicator"
  - "Stdin/stdout protocol guarded with import.meta.url === file://${process.argv[1]} so script is importable by tests without executing protocol code"
  - "Script has zero relative imports from project — standalone constraint enforced (no ../lib/ or ../services/ imports)"
  - "STATS_TTL_MS duplicated inline in script (not imported from sessionStats.ts) to maintain standalone constraint"

patterns-established:
  - "Standalone .mjs scripts export pure functions for testability, guard I/O with import.meta.url check"
  - "_readStatsFromPath pattern: export path-parameterized variant for unit testing without mocking"

requirements-completed:
  - STAT-03
  - STAT-04

# Metrics
duration: 2min
completed: 2026-04-04
---

# Phase 31 Plan 01: Status Line Rendering Summary

**Standalone ESM statusline.mjs script with formatTokenCount (k/M suffixes), readStats (2h TTL + validation), and renderOutput (savings or idle fallback), fully TDD with 19 unit tests**

## Performance

- **Duration:** 2 min
- **Started:** 2026-04-04T03:48:39Z
- **Completed:** 2026-04-04T03:50:21Z
- **Tasks:** 1
- **Files modified:** 2

## Accomplishments
- Created `src/scripts/statusline.mjs` as a standalone ESM Node.js script with no project imports
- Implemented `formatTokenCount` (handles < 1k, k suffix, M suffix with 1 decimal)
- Implemented `_readStatsFromPath` (path-parameterized for testing) with TTL check, null/missing/malformed/non-positive guards
- Implemented `readStats` delegating to `_readStatsFromPath(STATS_PATH)`
- Implemented `renderOutput` producing `brain-cache  ↓{pct}%  {n} saved` or `brain-cache  idle` fallback
- Guarded stdin/stdout protocol with `import.meta.url` check so script is importable without executing I/O
- Added 19 unit tests (6 formatTokenCount, 7 _readStatsFromPath, 6 renderOutput) — all pass
- Full suite: 582 tests pass (563 pre-existing + 19 new)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create statusline.mjs script and unit tests (TDD)** - `c6a1d44` (feat)

**Plan metadata:** _(committed below)_

_Note: TDD task — test file written first (RED), then implementation (GREEN), unicode fix in tests applied as Rule 1 auto-fix._

## Files Created/Modified
- `src/scripts/statusline.mjs` - Standalone ESM status line script with pure function exports
- `tests/scripts/statusline.test.ts` - 19 unit tests covering formatTokenCount, _readStatsFromPath, renderOutput

## Decisions Made
- `_readStatsFromPath(filePath)` exported as test helper so tests inject temp paths without needing to mock `os.homedir` — cleaner than the alternative mocking approach
- `STATS_TTL_MS` duplicated inline (not imported from sessionStats.ts) to maintain the standalone-no-project-imports constraint
- Unicode `↓` is U+2193 (down arrow) — confirmed from plan spec; test file initially used U+2190 (left arrow) which was auto-fixed

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed wrong unicode codepoint in test expectations**
- **Found during:** Task 1 (GREEN phase — tests failed)
- **Issue:** Test file used `\u2190` (← left arrow) instead of `\u2193` (↓ down arrow) in renderOutput assertions
- **Fix:** Updated three `toBe` expectations in tests to use `\u2193` — matching the plan spec (`↓{pct}%`)
- **Files modified:** tests/scripts/statusline.test.ts
- **Verification:** All 19 tests pass after fix
- **Committed in:** c6a1d44 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug — wrong unicode codepoint in test expectations)
**Impact on plan:** Trivial fix — codepoint typo during test authoring. No scope creep.

## Issues Encountered
None beyond the unicode codepoint typo (auto-fixed above).

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `src/scripts/statusline.mjs` is ready for Phase 31 Plan 02 (stdin protocol wiring and shell integration)
- All pure functions tested and stable
- Script standalone constraint maintained — safe to copy/install independently

## Self-Check: PASSED
- src/scripts/statusline.mjs: FOUND
- tests/scripts/statusline.test.ts: FOUND
- 31-01-SUMMARY.md: FOUND
- commit c6a1d44: FOUND

---
*Phase: 31-status-line-rendering*
*Completed: 2026-04-04*
