---
phase: 23-search-noise-reduction
plan: 01
subsystem: retrieval
tags: [lancedb, search, scoring, noise-reduction, tdd]

# Dependency graph
requires:
  - phase: 22-isolated-trace-fixes
    provides: retriever.ts with searchChunks signature and existing scoring pipeline
provides:
  - computeNoisePenalty helper in retriever.ts
  - CONFIG_NOISE_PATTERNS array (vitest, tsup, tsconfig, jest, eslint)
  - CONFIG_FILE_NOISE_PENALTY constant (0.15) with JSDoc
  - extractQueryTokens and computeKeywordBoost helpers for blended scoring
  - Optional query param on searchChunks enabling blended score reranking
affects:
  - 24-compression-and-savings-accuracy (uses keyword boost weight per intent mode)
  - phase-24 (build_context blended scoring baseline is now established)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Named penalty constant pattern: module-level const with JSDoc, subtracted from ephemeral score not stored similarity"
    - "Bypass pattern: penalty skipped when query contains the tool name via simple includes() check"
    - "Ephemeral scoring: blended score computed in { chunk, score } tuple and discarded — chunk.similarity unchanged"

key-files:
  created: []
  modified:
    - src/services/retriever.ts
    - tests/services/retriever.test.ts

key-decisions:
  - "CONFIG_FILE_NOISE_PENALTY = 0.15 — small enough to not hard-exclude config files, large enough to push them below app code for generic queries"
  - "Bypass via query.toLowerCase().includes(toolName) — simple substring match is sufficient for short, unique tool name identifiers"
  - "Penalty applied inside if (queryTokens.length > 0) block only — no query means no bypass check is possible, so no penalty applies"
  - "chunk.similarity is NOT modified — ranking adjustments are ephemeral in the score computation only"
  - "extractQueryTokens and computeKeywordBoost added in same commit as noise penalty — they were uncommitted in main workspace and required as pipeline foundation"

patterns-established:
  - "Pattern: Config noise penalty — subtract named constant from blended score when filename matches build-tool pattern and query doesn't name the tool"
  - "Pattern: Blended scoring pipeline — similarity * 0.90 + keywordBoost * 0.10 - noisePenalty, sort by score, return chunks only"

requirements-completed:
  - NOISE-01

# Metrics
duration: 2min
completed: 2026-04-03
---

# Phase 23 Plan 01: Search Noise Reduction Summary

**Score penalty for build tool config files in searchChunks: vitest.config.ts, tsup.config.ts, tsconfig.json, jest.config.ts, and eslint config files receive a 0.15 penalty subtracted from the blended search score, bypassed when the query explicitly names the tool**

## Performance

- **Duration:** 2 min
- **Started:** 2026-04-03T13:23:33Z
- **Completed:** 2026-04-03T13:25:44Z
- **Tasks:** 2 (TDD: RED + GREEN)
- **Files modified:** 2

## Accomplishments
- Added `computeNoisePenalty` helper that returns 0.15 for build tool config file matches and 0 when query names the tool or file is not a config file
- Added `CONFIG_NOISE_PATTERNS` array mapping 6 build tool config patterns (vitest, tsup, tsconfig, jest, eslint, .eslintrc) to their tool name tokens
- Added `CONFIG_FILE_NOISE_PENALTY = 0.15` constant with JSDoc documentation explaining purpose and bypass behavior
- Wired noise penalty subtraction into the blended scoring pipeline inside `searchChunks`
- Also established blended scoring pipeline foundation: `extractQueryTokens`, `computeKeywordBoost`, optional `query` param on `searchChunks`
- 4 new test cases covering: generic query penalty, tool-name bypass, non-config file immunity, soft exclusion

## Task Commits

Each task was committed atomically:

1. **Task 1: RED — Add failing tests for config file noise penalty** - `7dec1e9` (test)
2. **Task 2: GREEN — Implement computeNoisePenalty and wire into searchChunks** - `107d63d` (feat)

**Plan metadata:** (docs commit follows)

_Note: TDD tasks — test commit (RED) followed by feat commit (GREEN)_

## Files Created/Modified
- `src/services/retriever.ts` — Added CONFIG_NOISE_PATTERNS, CONFIG_FILE_NOISE_PENALTY, computeNoisePenalty, extractQueryTokens, computeKeywordBoost; extended searchChunks with optional query param and blended scoring pipeline
- `tests/services/retriever.test.ts` — Added `describe('config file noise penalty')` block with 4 test cases

## Decisions Made
- CONFIG_FILE_NOISE_PENALTY set to 0.15: smaller than typical similarity gap between strong and weak matches, so explicit tool-name queries still surface config files via keyword boost
- Bypass uses simple `query.toLowerCase().includes(toolName)` — tool names (vitest, tsup, tsconfig, jest, eslint) are short, unique identifiers where substring match is reliable
- Penalty applies only inside the `if (queryTokens.length > 0)` block — without a query there is no bypass check and no penalty logic should run
- `chunk.similarity` field is not modified — it reflects the raw vector result; ranking adjustments are ephemeral in the blended score only
- extractQueryTokens and computeKeywordBoost were added alongside the noise penalty because they form the pipeline foundation and were not yet committed in the codebase

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added extractQueryTokens and computeKeywordBoost to retriever.ts**
- **Found during:** Task 2 (GREEN implementation)
- **Issue:** The plan's context assumed `computeKeywordBoost` and the blended scoring pipeline already existed (as per the interfaces section), but the worktree had the older committed version of retriever.ts without these additions. They were present as uncommitted changes in the main workspace.
- **Fix:** Implemented `extractQueryTokens`, `computeKeywordBoost`, and the `query` parameter extension to `searchChunks` in the same feat commit alongside the noise penalty, since they are required pipeline foundation for the noise penalty to wire into.
- **Files modified:** src/services/retriever.ts
- **Verification:** All 401 tests pass including the new noise penalty tests
- **Committed in:** `107d63d` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking — missing pipeline foundation in worktree)
**Impact on plan:** Essential prerequisite — noise penalty requires the blended scoring pipeline to wire into. No scope creep; these helpers were already designed and present in the main workspace as uncommitted work.

## Issues Encountered
None beyond the deviation above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- searchChunks now has full blended scoring: similarity * 0.90 + keywordBoost * 0.10 - noisePenalty
- Phase 24 (compression-and-savings-accuracy) can build on this — it needs per-intent keyword boost weights and compressed vs. uncompressed logic
- NOISE-01 requirement satisfied: config files rank below app code for generic queries, bypass works for tool-name queries

---
*Phase: 23-search-noise-reduction*
*Completed: 2026-04-03*
