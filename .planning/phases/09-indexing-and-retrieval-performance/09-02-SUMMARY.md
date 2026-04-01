---
plan: "09-02"
title: "LanceDB IVF-PQ vector index and separator token cache"
status: complete
completed_at: "2026-04-01T04:43:00.000Z"
tests_before: 224
tests_after: 228
---

# Plan 09-02 Execution Summary

## What Was Done

All 5 tasks executed successfully in order.

### T1: VECTOR_INDEX_THRESHOLD constant (src/lib/config.ts)
Added `export const VECTOR_INDEX_THRESHOLD = 10_000` after `DEFAULT_BATCH_SIZE`.

### T2: createVectorIndexIfNeeded function (src/services/lancedb.ts)
- Added `Index` import from `@lancedb/lancedb`
- Added `VECTOR_INDEX_THRESHOLD` and `EMBEDDING_DIMENSIONS` to the config import
- Implemented `createVectorIndexIfNeeded(table, embeddingModel)` that:
  - Skips if row count < 10,000
  - Skips if a vector index already exists on the `vector` column
  - Creates IVF-PQ index with `numPartitions=256`, `numSubVectors=dim/8`

### T3: Wire into runIndex (src/workflows/index.ts)
- Added `createVectorIndexIfNeeded` to the lancedb import
- Called it after all chunks are inserted (Step 9) and before `writeIndexState` (now Step 10)
- Updated step numbering: writeIndexState→Step 10, summary→Step 11
- Updated `tests/workflows/index.test.ts` to mock the new export

### T4: Hoist separator token count (src/services/tokenCounter.ts)
- Added `const separatorTokens = countChunkTokens(separator)` before the loop
- Changed `sepCost` to use `separatorTokens` instead of calling `countChunkTokens(separator)` each iteration
- Eliminates repeated tokenizer calls (one per chunk) for a constant string

### T5: Unit tests for createVectorIndexIfNeeded (tests/services/lancedb.test.ts)
Created new test file with 4 tests covering:
1. Skips when row count below threshold
2. Skips when vector index already exists
3. Creates IVF-PQ index when above threshold and no index exists
4. Handles 1024-dim model (mxbai-embed-large)

## Verification

- `npm test`: 228 tests passed (16 test files) — 4 new tests added
- `npx tsc --noEmit`: Pre-existing error in `table.add(rows)` type mismatch (present before this plan, not introduced by 09-02)
- All acceptance criteria met for each task

## Notes

The TypeScript error (`ChunkRow[]` not assignable to `Data`) at `src/services/lancedb.ts:116` was present before this plan. It is not introduced by 09-02 and is tracked separately.
