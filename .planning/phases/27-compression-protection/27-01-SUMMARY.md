---
phase: 27-compression-protection
plan: 01
subsystem: retrieval
tags: [compression, buildContext, primary-protection, peripheral-drop, tdd]

# Dependency graph
requires:
  - phase: 26-search-precision
    provides: computeKeywordBoost tiered ranking with splitCamelCase helper
  - phase: 24-compression-and-savings-accuracy
    provides: compressChunk structural compression service
provides:
  - isPrimaryMatch: 3-tier primary detection (exact name, camelCase sub-tokens, filename stem)
  - isTestFile: peripheral test file detection and drop
  - isConfigFile: peripheral build-config file detection and drop
  - Lookup pipeline: drop_peripheral step between parent_enrich and compress
affects: [build_context, compression, token-savings-accuracy]

# Tech tracking
tech-stack:
  added: []
  patterns: [TDD red-green, inline helpers (no cross-service coupling), peripheral-before-compression ordering]

key-files:
  created: []
  modified:
    - src/workflows/buildContext.ts
    - tests/workflows/buildContext.test.ts

key-decisions:
  - "splitCamelCase called on original (non-lowercased) name to preserve uppercase boundaries for camelCase detection"
  - "isPrimaryMatch helpers are inlined in buildContext.ts (not imported from retriever) to avoid cross-service coupling"
  - "Peripheral drop happens before compressChunk call — withoutPeripheral filter precedes the isPrimaryMatch map"
  - "isTestFile uses string includes patterns (.test., .spec., /__tests__/, /tests/) for simplicity over regex"
  - "isConfigFile uses regex array matching filename only (not full path) consistent with retriever CONFIG_NOISE_PATTERNS"

patterns-established:
  - "Primary protection: isPrimaryMatch(chunk, queryTokens) ? chunk : compressChunk(chunk) — guard at map level"
  - "Peripheral drop: enriched.filter(chunk => !isTestFile(...) && !isConfigFile(...)) before compression"

requirements-completed: [COMP-01, COMP-02]

# Metrics
duration: 3min
completed: 2026-04-03
---

# Phase 27 Plan 01: Compression Protection Summary

**Compression protection in build_context lookup path: primary chunks (name/path query match) bypass compressChunk, test and config file chunks dropped before any production file is compressed**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-04-03T18:27:31Z
- **Completed:** 2026-04-03T18:30:15Z
- **Tasks:** 2 (TDD: RED + GREEN)
- **Files modified:** 2

## Accomplishments

- Added `isPrimaryMatch` helper with 3-tier detection: exact symbol name, camelCase sub-tokens (all must match), filename stem exact match
- Added `isTestFile` (`.test.`, `.spec.`, `/__tests__/`, `/tests/`) and `isConfigFile` (vitest/tsup/tsconfig/jest/eslint config patterns) peripheral detectors
- Modified lookup path: `withoutPeripheral` filter (COMP-02) + `isPrimaryMatch` guard (COMP-01) inserted between `enrichWithParentClass` and `groupChunksByFile`
- `localTasksPerformed` now includes `'drop_peripheral'` step between `parent_enrich` and `compress`
- 40 buildContext tests pass; full suite 501/501 green

## Task Commits

Each task was committed atomically:

1. **Task 1: RED — Write failing COMP-01 and COMP-02 tests** - `3a2c942` (test)
2. **Task 2: GREEN — Implement peripheral drop and primary protection** - `dc505ec` (feat)

_Note: TDD tasks: test commit (RED) → feat commit (GREEN)_

## Files Created/Modified

- `src/workflows/buildContext.ts` — Added `splitCamelCase`, `extractQueryTokens`, `isPrimaryMatch`, `isTestFile`, `isConfigFile` helpers; modified lookup path with `withoutPeripheral` filter and `isPrimaryMatch` guard; updated `localTasksPerformed`
- `tests/workflows/buildContext.test.ts` — Added `describe('COMP-01: primary result protection')` (5 tests) and `describe('COMP-02: peripheral chunk drop')` (7 tests); updated `localTasksPerformed` assertion to include `'drop_peripheral'`; added `compressChunk` import and `mockCompressChunk`

## Decisions Made

- `splitCamelCase` must receive the original (non-lowercased) chunk name — lowercasing before splitting removes uppercase boundaries needed for camelCase detection. Fixed during GREEN phase as Rule 1 auto-fix.
- Helpers inlined in `buildContext.ts` to avoid coupling to `retriever.ts` — retriever functions are subject to change and the primary match logic here is a slightly different use case.
- Peripheral drop ordered strictly before compression: drop test/config chunks first, then apply `isPrimaryMatch` guard on the remaining production chunks.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed camelCase detection on lowercased chunk name**
- **Found during:** Task 2 (GREEN — implement primary protection)
- **Issue:** Plan specified `splitCamelCase(chunkName)` where `chunkName` was already `.toLowerCase()` — this prevented detection of camelCase boundaries like `runBuildContext` → `['run', 'build', 'context']`, since all letters were lowercase
- **Fix:** Changed to use `originalName = chunk.name ?? ''` (original case) for `splitCamelCase`, while keeping `chunkName` (lowercased) only for Tier 1 exact match comparison
- **Files modified:** `src/workflows/buildContext.ts`
- **Verification:** Camelcase sub-token test now passes; full suite green
- **Committed in:** `dc505ec` (Task 2 feat commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 — bug in plan-specified code)
**Impact on plan:** Fix essential for camelCase Tier 2 detection correctness. No scope creep.

## Issues Encountered

None beyond the auto-fixed camelCase bug above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- COMP-01 and COMP-02 satisfied — build_context now protects primary query results from compression and drops peripheral chunks first
- Ready for any subsequent compression or context assembly refinements
- No regressions in the full 501-test suite

---
*Phase: 27-compression-protection*
*Completed: 2026-04-03*
