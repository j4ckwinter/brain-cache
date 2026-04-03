---
phase: 30-stats-infrastructure
plan: 01
subsystem: stats
tags: [sessionStats, mutex, atomic-write, TTL, configLoader, vitest, TDD]

# Dependency graph
requires:
  - phase: 17-new-mcp-tools-and-workflows
    provides: MCP handler layer that will call accumulateStats fire-and-forget
  - phase: 19-claude.md-refinements
    provides: configLoader with UserConfig pattern that sessionStats extends

provides:
  - accumulateStats() function with module-level mutex for concurrent safety
  - StatsDelta and SessionStats interfaces
  - SESSION_STATS_PATH and STATS_TTL_MS constants
  - SESSION_STATS_FILENAME constant in config.ts
  - UserConfig.stats.ttlHours field in configLoader.ts (STAT-02)
  - Full test coverage in tests/services/sessionStats.test.ts

affects: [30-02-PLAN, MCP handler wiring, status-line rendering]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Module-level mutex via Promise chain (replicate withWriteLock from lancedb.ts)"
    - "Atomic file write via tmp+rename (no write-file-atomic dependency)"
    - "TTL check inline: Date.now() - Date.parse(existing.lastUpdatedAt) > effectiveTtlMs"
    - "loadUserConfig() per call (no caching) for config-driven TTL override"
    - "ttlMs parameter takes precedence over config for test isolation"
    - "_resetMutexForTesting() export for inter-test mutex isolation"
    - "ENOTDIR path for simulating write failure in tests (avoids vi.spyOn on node:fs/promises)"

key-files:
  created:
    - src/services/sessionStats.ts
    - tests/services/sessionStats.test.ts
  modified:
    - src/lib/config.ts
    - src/services/configLoader.ts

key-decisions:
  - "ttlMs parameter takes precedence over loadUserConfig TTL — enables test override without mocking loadUserConfig"
  - "loadUserConfig call wrapped in try/catch inside _doAccumulate — config read failure must not break stats"
  - "ENOTDIR path (/etc/passwd/subpath) used to simulate write failure in tests — vi.spyOn on node:fs/promises fails (non-configurable property)"
  - "mutex chain uses then(() => undefined, () => undefined) pattern exactly matching lancedb.ts withWriteLock"
  - "SESSION_STATS_PATH is computed at import time from GLOBAL_CONFIG_DIR constant"

patterns-established:
  - "Stats file: 4 keys only (tokensSent, estimatedWithoutBraincache, callCount, lastUpdatedAt)"
  - "Atomic write: writeFile to .tmp then rename to final path"
  - "Error swallowing: catch in _doAccumulate + log.warn, accumulateStats always resolves"

requirements-completed: [STAT-01, STAT-02]

# Metrics
duration: 3min
completed: 2026-04-03
---

# Phase 30 Plan 01: Stats Infrastructure Summary

**Session stats service with module-level mutex, atomic tmp+rename writes, and config-driven TTL — fire-and-forget safe accumulation of tokensSent and estimatedWithoutBraincache to ~/.brain-cache/session-stats.json**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-04-03T13:12:25Z
- **Completed:** 2026-04-03T13:15:03Z
- **Tasks:** 1 (TDD: RED commit + GREEN commit)
- **Files modified:** 4

## Accomplishments

- Created `src/services/sessionStats.ts` exporting `accumulateStats`, `StatsDelta`, `SessionStats`, `SESSION_STATS_PATH`, `STATS_TTL_MS`, and `_resetMutexForTesting`
- Mutex serializes concurrent calls (same pattern as `withWriteLock` in lancedb.ts) — concurrent test confirms sum not overwrite
- TTL reads `stats.ttlHours` from `loadUserConfig()` per STAT-02 when no `ttlMs` override provided
- Atomic write via tmp+rename eliminates partial-write corruption risk
- Extended `UserConfig` interface in `configLoader.ts` with `stats?: { ttlHours?: number }` (STAT-02)
- Added `SESSION_STATS_FILENAME = "session-stats.json"` to `src/lib/config.ts`
- 8 tests covering: create, accumulate, concurrent, TTL-expired reset, TTL-within accumulate, write failure swallow, JSON key shape, and configurable TTL via config.json
- Full suite: 557 tests passing across 27 test files (0 regressions)

## Task Commits

1. **RED: Failing tests** - `6824ca7` (test)
2. **GREEN + implementation** - `48bba53` (feat)

## Files Created/Modified

- `src/services/sessionStats.ts` — Core stats service with accumulateStats, mutex, atomic write, TTL logic
- `tests/services/sessionStats.test.ts` — 8 TDD tests covering all STAT-01/STAT-02 behaviors
- `src/lib/config.ts` — Added SESSION_STATS_FILENAME constant
- `src/services/configLoader.ts` — Extended UserConfig with stats.ttlHours field

## Decisions Made

- `ttlMs` parameter takes precedence over `loadUserConfig()` TTL — clean test isolation without mocking loadUserConfig for TTL tests
- `loadUserConfig()` wrapped in try/catch inside `_doAccumulate` — config read failure must never break stats accumulation
- Used ENOTDIR path (`/etc/passwd/subpath`) to simulate write failure — `vi.spyOn` on `node:fs/promises` properties is non-configurable and throws
- Mutex uses `then(() => undefined, () => undefined)` pattern exactly matching `withWriteLock` in lancedb.ts for consistency
- `SESSION_STATS_PATH` computed at module import time from `GLOBAL_CONFIG_DIR`

## Deviations from Plan

None — plan executed exactly as written. One test implementation adjustment (Test 6: write failure simulation) was required due to Node.js native module property non-configurability, but the test behavior and assertion remained identical to the plan spec.

## Issues Encountered

- `vi.spyOn(fsPromises, 'writeFile')` threw "Cannot redefine property: writeFile" — node:fs/promises exports are non-configurable. Resolved by using `/etc/passwd/subpath` as `GLOBAL_CONFIG_DIR` which causes `mkdir` to fail immediately with ENOTDIR.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `accumulateStats` is ready for MCP handler wiring in Plan 30-02
- `SESSION_STATS_PATH` is the agreed location for the status line script to read
- `STATS_TTL_MS` (2h default) and `stats.ttlHours` config key are established contracts for Plan 30-02 status line rendering

## Self-Check: PASSED

- FOUND: src/services/sessionStats.ts
- FOUND: tests/services/sessionStats.test.ts
- FOUND: .planning/phases/30-stats-infrastructure/30-01-SUMMARY.md
- FOUND commit: 6824ca7 (RED: failing tests)
- FOUND commit: 48bba53 (GREEN: implementation)

---
*Phase: 30-stats-infrastructure*
*Completed: 2026-04-03*
