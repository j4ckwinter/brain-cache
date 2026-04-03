---
phase: 24-compression-and-savings-accuracy
plan: 01
subsystem: retriever
tags: [retrieval, compression, keyword-boost, similarity-promotion, RET-01, RET-02]
dependency_graph:
  requires: []
  provides: [per-mode-keyword-boost, similarity-promotion-for-compression]
  affects: [src/services/retriever.ts, src/lib/types.ts, src/workflows/buildContext.ts, src/workflows/search.ts]
tech_stack:
  added: []
  patterns: [per-mode boost weight via SearchOptions, similarity promotion inside searchChunks before return]
key_files:
  created: []
  modified:
    - src/lib/types.ts
    - src/services/retriever.ts
    - src/workflows/buildContext.ts
    - src/workflows/search.ts
    - tests/services/retriever.test.ts
    - tests/services/compression.test.ts
    - tests/workflows/buildContext.test.ts
    - tests/workflows/search.test.ts
decisions:
  - Per-mode keywordBoostWeight stored in RETRIEVAL_STRATEGIES (co-located with limit/distanceThreshold) rather than a separate config section
  - Sort score computed using original chunk.similarity BEFORE promotion to avoid re-ranking distortion
  - Any name-match (boost > 0) triggers promotion — not a threshold — to protect partial filename matches
metrics:
  duration_seconds: 161
  completed_date: "2026-04-03"
  tasks_completed: 2
  tasks_total: 2
  files_modified: 8
requirements_satisfied: [RET-01, RET-02]
---

# Phase 24 Plan 01: Per-Mode Keyword Boost Weights and Similarity Promotion Summary

**One-liner:** Per-mode keyword boost (lookup: 0.40, trace: 0.20, explore: 0.10) with RET-02 similarity promotion to >= 0.85 for name-matched chunks, protecting them from compression.

---

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add keywordBoostWeight to SearchOptions and RETRIEVAL_STRATEGIES; implement per-mode boost and similarity promotion | 423c4ac | src/lib/types.ts, src/services/retriever.ts, tests/services/retriever.test.ts, tests/services/compression.test.ts |
| 2 | Pass query to searchChunks in buildContext.ts and search.ts lookup paths | c4183b7 | src/workflows/buildContext.ts, src/workflows/search.ts, tests/workflows/buildContext.test.ts, tests/workflows/search.test.ts |

---

## What Was Built

### RET-01: Per-Mode Keyword Boost Weights

`RETRIEVAL_STRATEGIES` now carries a `keywordBoostWeight` per mode:
- `lookup`: 0.40 — aggressive name-match ranking for explicit symbol lookups
- `trace`: 0.20 — moderate boosting for call-path tracing
- `explore`: 0.10 — conservative (preserves previous behavior for broad queries)

The `SearchOptions` interface in `src/lib/types.ts` gained an optional `keywordBoostWeight?: number` field. `searchChunks` reads this via `opts.keywordBoostWeight ?? 0.10` instead of the former hardcoded constant `KEYWORD_BOOST_WEIGHT = 0.10`.

Both `buildContext.ts` (lookup path, line 135) and `search.ts` (line 77) now pass `query` as the 4th argument to `searchChunks`, enabling the per-mode weights to take effect in production paths.

### RET-02: Similarity Promotion for Name-Matched Chunks

Inside `searchChunks`, after computing the blended sort score using the original `chunk.similarity`, name-matched chunks (where `computeKeywordBoost` returns > 0) have their `similarity` promoted to `Math.max(chunk.similarity, HIGH_RELEVANCE_SIMILARITY_THRESHOLD)` (= 0.85).

This ensures that chunks whose filename or symbol name matches a query term reach the 0.85 threshold and are protected by `compressChunk`'s middle-range high-relevance guard. No new code path in compression — the existing `chunk.similarity >= 0.85` check handles everything.

The critical ordering is: compute sort score using original similarity, THEN spread-update `similarity` to the promoted value. This avoids the re-ranking pitfall identified in RESEARCH.md.

---

## Decisions Made

1. **Store `keywordBoostWeight` in `RETRIEVAL_STRATEGIES`** — co-located with `limit` and `distanceThreshold` rather than a separate config section. All retrieval configuration stays in one place.

2. **Sort score computed on original similarity before promotion** — prevents low-vector-similarity chunks from artificially outranking high-similarity ones after promotion.

3. **Promote on `boost > 0`, not a threshold** — any query token matching a filename or symbol name triggers promotion. Partial matches (e.g., one of three query tokens) are still name matches and deserve compression protection.

4. **Updated existing `search.test.ts` assertions** — three tests that used exact `toHaveBeenCalledWith` matching needed the 4th `query` argument added. This is expected test maintenance, not a deviation.

---

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated existing search.test.ts call assertions to include query argument**
- **Found during:** Task 2
- **Issue:** Three existing tests in `search.test.ts` used exact `toHaveBeenCalledWith` with 3 arguments. After adding `query` as 4th arg to `searchChunks` call in `search.ts`, these assertions failed.
- **Fix:** Added the query string as 4th expected argument in `calls searchChunks with the strategy`, `applies custom limit option`, and `uses explore strategy for general queries` tests.
- **Files modified:** tests/workflows/search.test.ts
- **Commit:** c4183b7

---

## Test Coverage Added

| Test file | New tests | Coverage |
|-----------|-----------|----------|
| tests/services/retriever.test.ts | 8 new tests | RET-01 per-mode weights; RET-02 promotion for name-matched and non-matched chunks |
| tests/services/compression.test.ts | 2 new tests | Promoted chunk (0.85, 600 tokens) not compressed; non-promoted (0.60, 600 tokens) is compressed |
| tests/workflows/buildContext.test.ts | 1 new test | 4th argument to searchChunks is query string |
| tests/workflows/search.test.ts | 1 new test + 3 updated | 4th argument is query string; existing assertions updated |

Full suite: **472 tests, all passing** (was 461 before phase 24).

---

## Known Stubs

None. All new behavior is wired end-to-end: `RETRIEVAL_STRATEGIES` carries weights → `searchChunks` reads them → similarity promotion is applied → `compressChunk` respects the promoted value.

---

## Self-Check: PASSED

- src/lib/types.ts — `keywordBoostWeight` field present
- src/services/retriever.ts — `keywordBoostWeight: 0.40/0.20/0.10` in RETRIEVAL_STRATEGIES, `promotedSimilarity` logic present, `HIGH_RELEVANCE_SIMILARITY_THRESHOLD` imported
- src/workflows/buildContext.ts — `searchChunks(table, queryVector, strategy, query)` at lookup path
- src/workflows/search.ts — `searchChunks(table, queryVector, strategy, query)` present
- Commits 423c4ac and c4183b7 exist in git log
