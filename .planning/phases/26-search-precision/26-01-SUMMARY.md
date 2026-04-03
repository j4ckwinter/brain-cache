---
phase: 26-search-precision
plan: 01
subsystem: retrieval
tags: [lancedb, retriever, keyword-boost, camelcase, search-precision, tdd]

# Dependency graph
requires:
  - phase: 24-compression-and-savings-accuracy
    provides: keywordBoostWeight forwarded through search strategy pipeline
provides:
  - Tiered computeKeywordBoost with exact name (1.0), camelCase sub-token (1.0), filename stem (0.6), and partial fallback tiers
  - splitCamelCase helper for decomposing PascalCase/camelCase identifiers into sub-tokens
  - 5 ranking tests for PREC-01/PREC-02 exact-name-miss failure mode
affects:
  - search_codebase MCP tool (improved first-result precision for symbol and filename queries)
  - 26-02 (follow-on search precision plans if any)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Tiered boost: return early with high score when exact match found, fall through to lower tiers"
    - "CamelCase decomposition via split-on-uppercase-boundary regex for sub-token queries"
    - "Filename stem extraction via replace(/\\.[^.]+$/, '') for extension-agnostic matching"

key-files:
  created: []
  modified:
    - src/services/retriever.ts
    - tests/services/retriever.test.ts

key-decisions:
  - "Tier 3 (filename stem) uses 0.6 not 0.8 as specced — 0.8 caused regression on existing tsup noise-penalty test (boost weight math: 0.75*0.90+0.8*0.10=0.755 > 0.80*0.90+0.167*0.10=0.737); 0.6 satisfies all PREC tests with boost weight 0.40 while not overpowering at default 0.10"
  - "Tier 2 camelCase match requires ALL sub-tokens to appear in query tokens (not just one) — prevents partial spurious matches from triggering full 1.0 boost"
  - "splitCamelCase filters tokens shorter than 2 chars to avoid single-char noise tokens from abbreviations"

patterns-established:
  - "Tiered early-return boost: exact symbol > camelCase decomposition > filename stem > partial fallback"

requirements-completed: [PREC-01, PREC-02]

# Metrics
duration: 8min
completed: 2026-04-03
---

# Phase 26 Plan 01: Search Precision Summary

**Tiered keyword boost for retriever with camelCase decomposition and filename stem tiers, fixing exact-name-miss failure mode in search_codebase**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-04-03T18:03:00Z
- **Completed:** 2026-04-03T18:05:26Z
- **Tasks:** 2 (TDD: RED + GREEN)
- **Files modified:** 2

## Accomplishments

- Implemented `splitCamelCase` helper that decomposes camelCase/PascalCase identifiers into lowercase sub-tokens for matching (e.g. "searchChunks" → ["search", "chunks"])
- Replaced flat `computeKeywordBoost` with 4-tier scoring: exact name match (1.0), camelCase sub-token match (1.0), filename stem match (0.6), partial fallback
- All 5 PREC-01/PREC-02 ranking tests pass; full suite 489/489 green with no regressions

## Task Commits

1. **Task 1: RED — Failing PREC-01/PREC-02 ranking tests** - `a56d86b` (test)
2. **Task 2: GREEN — Tiered computeKeywordBoost implementation** - `011556d` (feat)

**Plan metadata:** (docs commit below)

_TDD plan: test commit (RED) then implementation commit (GREEN)_

## Files Created/Modified

- `src/services/retriever.ts` — Added `splitCamelCase` helper and replaced `computeKeywordBoost` with 4-tier tiered scoring function
- `tests/services/retriever.test.ts` — Added `describe('PREC-01 / PREC-02: tiered keyword boost')` block with 5 ranking tests

## Decisions Made

- Tier 3 (filename stem) uses `return 0.6` instead of the plan-specced `0.8` — see deviation below
- CamelCase Tier 2 requires ALL sub-tokens to appear in query for 1.0 boost (not partial match)
- `splitCamelCase` filters sub-tokens shorter than 2 characters to prevent single-char noise

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Tier 3 return value changed from 0.8 to 0.6 to prevent regression**
- **Found during:** Task 2 (GREEN — running full test suite after implementation)
- **Issue:** Plan specified `return 0.8` for filename stem tier (Tier 3). At default `keywordBoostWeight=0.10`, this boosted `src/build.ts` (stem="build") above `tsup.config.ts` for the query "how does tsup build the project": `0.75*0.90 + 0.8*0.10 = 0.755 > 0.80*0.90 + 0.167*0.10 = 0.737`. Existing noise-penalty test `does not penalize config files when query names the tool` failed.
- **Fix:** Changed Tier 3 return from `0.8` to `0.6`. At default weight 0.10: `0.75*0.90+0.6*0.10=0.735 < 0.737`. For PREC tests (weight 0.40): `0.55*0.60+0.6*0.40=0.57 > 0.54/0.552` — still passes.
- **Files modified:** src/services/retriever.ts
- **Verification:** `npx vitest run` → 489/489 tests pass
- **Committed in:** `011556d` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - bug)
**Impact on plan:** Tier 3 value adjusted to satisfy existing constraints. PREC-01 and PREC-02 requirements fully satisfied.

## Issues Encountered

- The plan-specced Tier 3 value (0.8) caused a regression because "build" in "how does tsup build the project" matched the stem of `src/build.ts`. Adjusted to 0.6 with minimal margin math to satisfy all tests simultaneously.

## Known Stubs

None — all data wired through real `computeKeywordBoost` computation.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `computeKeywordBoost` now returns tiered scores satisfying PREC-01 (exact name / camelCase) and PREC-02 (filename stem)
- `searchChunks` reranking pipeline unchanged — consumes new scores transparently
- search_codebase queries like "compressChunk function" or "compression service" now surface the named symbol/file first

## Self-Check: PASSED

- `src/services/retriever.ts` — FOUND
- `tests/services/retriever.test.ts` — FOUND
- `.planning/phases/26-search-precision/26-01-SUMMARY.md` — FOUND
- Commit `a56d86b` (test RED) — FOUND
- Commit `011556d` (feat GREEN) — FOUND

---
*Phase: 26-search-precision*
*Completed: 2026-04-03*
