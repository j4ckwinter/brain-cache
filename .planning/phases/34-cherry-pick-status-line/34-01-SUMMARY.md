---
phase: 34-cherry-pick-status-line
plan: 01
subsystem: services
tags: [sessionStats, statusline, token-savings, mcp, mutex, atomic-write]

# Dependency graph
requires:
  - phase: 33-v3-reset
    provides: v3.0-skill-reshape branch with v1.0 core + incremental indexing
provides:
  - sessionStats service with mutex-serialized atomic writes and configLoader-free TTL config
  - statusline.mjs standalone ESM renderer for status line output
  - statusline-script.ts embedded content for init workflow deployment
  - SESSION_STATS_FILENAME constant in config.ts
  - 33 tests: 8 sessionStats unit + 19 statusline unit + 6 statusline integration
affects:
  - 34-02 (MCP handler wiring — imports accumulateStats from sessionStats)
  - 35-skill-packaging (skill init deploys statusline-script.ts content)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Module-level mutex pattern for serializing async fire-and-forget calls"
    - "Atomic write via .tmp rename to prevent partial file reads"
    - "Standalone ESM .mjs script with stdin/stdout protocol for shell integration"
    - "Embedded script string in .ts file for deployment without file copying"

key-files:
  created:
    - src/services/sessionStats.ts
    - src/scripts/statusline.mjs
    - src/lib/statusline-script.ts
    - tests/services/sessionStats.test.ts
    - tests/scripts/statusline.test.ts
    - tests/scripts/statusline.integration.test.ts
  modified:
    - src/lib/config.ts

key-decisions:
  - "Replaced loadUserConfig import with inline readFile for config.json — removes configLoader dependency on v3.0 branch"
  - "Test 8 uses real config.json on disk in temp dir rather than mocking configLoader — simpler, more realistic"

patterns-established:
  - "sessionStats: mutex prevents concurrent overwrites, errors always swallowed (fire-and-forget safe)"
  - "statusline.mjs: import.meta.url guard separates test imports from subprocess execution"

requirements-completed: [SKILL-03]

# Metrics
duration: 3min
completed: 2026-04-04
---

# Phase 34 Plan 01: Cherry-Pick Status Line Summary

**sessionStats service with mutex/atomic-write + statusline renderer ported to v3.0-skill-reshape with configLoader dependency removed and all 33 tests passing**

## Performance

- **Duration:** 3 min
- **Started:** 2026-04-04T10:24:54Z
- **Completed:** 2026-04-04T10:28:07Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments

- Ported sessionStats.ts to v3.0-skill-reshape with inline config.json read replacing configLoader import
- Added SESSION_STATS_FILENAME constant to config.ts on the reset branch
- Ported statusline.mjs, statusline-script.ts, and all 3 test files verbatim (with adapted Test 8)
- All 33 tests pass: 8 sessionStats unit + 19 statusline unit + 6 integration subprocess tests
- Build succeeds on v3.0-skill-reshape after all ports

## Task Commits

Each task was committed atomically:

1. **Task 1: Port sessionStats service and config constant** - `50022a0` (feat)
2. **Task 2: Port statusline script, embedded content, and tests** - `8be3bd2` (feat)

## Files Created/Modified

- `src/lib/config.ts` - Added SESSION_STATS_FILENAME constant
- `src/services/sessionStats.ts` - Token savings accumulation with mutex, atomic writes, inline TTL config
- `src/scripts/statusline.mjs` - Standalone ESM status line renderer (stdin/stdout protocol)
- `src/lib/statusline-script.ts` - Embedded script content string for init deployment
- `tests/services/sessionStats.test.ts` - 8 unit tests (create, accumulate, concurrent, TTL, no-throw, JSON keys, custom TTL)
- `tests/scripts/statusline.test.ts` - 19 unit tests for formatTokenCount, _readStatsFromPath, renderOutput
- `tests/scripts/statusline.integration.test.ts` - 6 subprocess integration tests for stdin/stdout protocol

## Decisions Made

- Replaced `loadUserConfig` import with inline `readFile(join(GLOBAL_CONFIG_DIR, 'config.json'))` — configLoader was a v2.0+ service not present on the v3.0 reset branch; inline read preserves identical behavior
- Test 8 adapted to write a real `config.json` file to the temp directory rather than mocking loadUserConfig — simpler approach that matches the new implementation

## Deviations from Plan

None - plan executed exactly as written. The two adaptations (inline config read, Test 8 file-based approach) were specified in the plan itself.

## Issues Encountered

None — all tests passed on first run for both tasks.

## Next Phase Readiness

- sessionStats service ready for wiring into MCP tool handlers (Plan 02)
- statusline-script.ts ready for init workflow to deploy on `brain-cache init`
- All 33 tests green, build clean

---
*Phase: 34-cherry-pick-status-line*
*Completed: 2026-04-04*
