# Phase 09 Verification Report

**Phase:** 09 — Indexing and Retrieval Performance
**Goal:** Indexing a large repo is significantly faster and uses bounded memory regardless of repo size
**Date:** 2026-04-01

---

## Requirement Results

### PERF-01 — File reads use concurrency limiter

**Status: PASS**

- `FILE_READ_CONCURRENCY = 20` is defined in `src/lib/config.ts` (line 14).
- `src/workflows/index.ts` imports `FILE_READ_CONCURRENCY` from `../lib/config.js` (line 16).
- Files are sliced into groups of `FILE_READ_CONCURRENCY` starting at line 82:
  ```
  for (let groupStart = 0; groupStart < files.length; groupStart += FILE_READ_CONCURRENCY) {
    const group = files.slice(groupStart, groupStart + FILE_READ_CONCURRENCY);
    ...
    const results = await Promise.all(group.map(async (filePath) => { ... }));
  ```
- `Promise.all` is used to read files concurrently within each bounded group (line 87).

---

### PERF-02 — No `allChunks` accumulator — chunks processed and flushed in groups

**Status: PASS**

- There is no `allChunks` array that spans the full file list.
- Chunks are collected into `groupChunks` (scoped per loop iteration, line 85), which is re-created on every group iteration.
- After collecting the group's chunks, they are immediately embedded and stored in `DEFAULT_BATCH_SIZE` batches (lines 109–132) before the next group begins.
- Memory is therefore bounded to `FILE_READ_CONCURRENCY * chunksPerFile * DEFAULT_BATCH_SIZE` at any point.

---

### PERF-03 — LanceDB IVF-PQ index with threshold check

**Status: PASS**

- `VECTOR_INDEX_THRESHOLD = 10_000` is defined in `src/lib/config.ts` (line 15).
- `createVectorIndexIfNeeded` in `src/services/lancedb.ts` (lines 133–172):
  - Counts rows with `table.countRows()` and returns early if below `VECTOR_INDEX_THRESHOLD` (lines 137–145).
  - Calls `table.listIndices()` and skips creation if a vector index already exists (lines 148–156).
  - Creates an IVF-PQ index via `Index.ivfPq({ numPartitions: 256, numSubVectors })` where `numSubVectors = Math.floor(dim / 8)` (768→96 for nomic-embed-text, 1024→128 for mxbai-embed-large).
- The function is called from `runIndex` after all chunks are inserted (line 140 of `src/workflows/index.ts`).

---

### PERF-04 — Separator token count hoisted outside loop

**Status: PASS**

- In `src/services/tokenCounter.ts`, `assembleContext` function (lines 37–63):
  ```
  const separator = '\n\n---\n\n';
  const separatorTokens = countChunkTokens(separator); // compute once (4 tokens)

  for (const chunk of chunks) {
    ...
    const sepCost = kept.length > 0 ? separatorTokens : 0;
  ```
- `countChunkTokens(separator)` is called once before the loop (line 44).
- The pre-computed `separatorTokens` value is reused inside the loop (line 49).

---

## Test Suite Results

**Status: ALL PASS**

```
Test Files  16 passed (16)
     Tests  245 passed (245)
  Duration  1.55s
```

### LanceDB tests (4 tests in `tests/services/lancedb.test.ts`)

All 4 tests pass:

| Test | Result |
|------|--------|
| skips index creation when row count is below threshold | PASS |
| skips index creation when vector index already exists | PASS |
| creates IVF-PQ index when above threshold and no index exists | PASS |
| uses correct numSubVectors for 1024-dim model | PASS |

---

## Summary

| Requirement | Description | Status |
|-------------|-------------|--------|
| PERF-01 | File reads use `FILE_READ_CONCURRENCY` limiter with `Promise.all` | PASS |
| PERF-02 | No `allChunks` accumulator — per-group flush keeps memory bounded | PASS |
| PERF-03 | LanceDB IVF-PQ index created via `createVectorIndexIfNeeded` with threshold check | PASS |
| PERF-04 | Separator token count hoisted before loop in `assembleContext` | PASS |
| Tests | All 245 tests pass; 4 new lancedb tests exist and pass | PASS |

**Phase 09 verification: COMPLETE — all requirements met.**
