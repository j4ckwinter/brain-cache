---
plan: "09-01"
title: "Concurrent file I/O and streaming chunk pipeline"
status: complete
completed_at: "2026-04-01T04:42:00.000Z"
---

# Plan 09-01 Execution Summary

## Objective

Restructure the index workflow so file reads run with a concurrency limiter (up to 20 concurrent) and chunks are embedded and stored in batches as they are produced, rather than accumulating all chunks in memory before embedding begins.

## Tasks Completed

### T1: Add FILE_READ_CONCURRENCY constant to config.ts

Added `export const FILE_READ_CONCURRENCY = 20;` after `DEFAULT_BATCH_SIZE` in `src/lib/config.ts`.

**Commit:** `feat(09-01): add FILE_READ_CONCURRENCY constant to config.ts`

### T2: Implement concurrent file read + streaming embed pipeline in index.ts

Replaced the sequential Steps 7 and 8 (chunk-all-then-embed pattern) with a concurrent group-based pipeline:

- Files are processed in groups of `FILE_READ_CONCURRENCY` (20) using `Promise.all`
- Within each group, files are read concurrently
- After each group, chunks are embedded and stored in `DEFAULT_BATCH_SIZE` batches
- `allChunks` accumulator removed entirely — memory is now bounded
- `totalChunkTokens` computed during flush, not after completion
- Progress logging retained (per-group chunking progress + per-batch embedding progress)
- Token savings stats still reported in summary

**Commit:** `feat(09-01): implement concurrent file read + streaming embed pipeline in index.ts`

### T3: Update index workflow tests

No test modifications were required. All 224 existing tests pass with the new pipeline because:
- The same service functions are called (readFile, chunkFile, embedBatchWithRetry, insertChunks, writeIndexState)
- Pipeline order invariant is preserved (crawl -> chunk -> embed -> store -> writeState)
- Test mocks are function-call-based, not order-sensitive within concurrent groups

## Verification

- `grep -n 'allChunks' src/workflows/index.ts` — zero matches
- `grep -n 'FILE_READ_CONCURRENCY' src/lib/config.ts` — 1 match (value 20)
- `grep -n 'FILE_READ_CONCURRENCY' src/workflows/index.ts` — multiple matches (import + usage)
- `grep -n 'Promise.all' src/workflows/index.ts` — 1 match (concurrent file reads)
- `grep -n 'groupChunks' src/workflows/index.ts` — multiple matches (per-group buffer)
- `npm test` — 224 tests passing (15 test files)
- `npx tsc --noEmit` — pre-existing error in `src/services/lancedb.ts` (unrelated to this plan)

## Files Modified

- `src/lib/config.ts` — added `FILE_READ_CONCURRENCY = 20`
- `src/workflows/index.ts` — replaced sequential pipeline with concurrent group-based pipeline
