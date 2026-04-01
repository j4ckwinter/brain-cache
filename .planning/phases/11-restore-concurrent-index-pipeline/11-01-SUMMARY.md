---
phase: 11-restore-concurrent-index-pipeline
plan: 01
subsystem: indexing
tags: [concurrent-io, streaming, pipeline, file-read, embeddings, token-counting]

# Dependency graph
requires:
  - phase: 10-incremental-indexing-and-intent-classification
    provides: incremental hash-diff logic, contentMap pre-loading, filesToProcess subset
  - phase: 09-indexing-and-retrieval-performance
    provides: FILE_READ_CONCURRENCY constant, group-based concurrent pipeline pattern
provides:
  - Concurrent file reads in Step 6b via Promise.all groups of FILE_READ_CONCURRENCY (20)
  - Group-based streaming chunk+embed pipeline over filesToProcess using contentMap
  - totalChunkTokens accumulated during embed loop — no post-loop reduce
affects: [indexing performance, memory usage, token savings reporting]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Group-based Promise.all concurrency: slice array into FILE_READ_CONCURRENCY groups, read concurrently, merge results sequentially"
    - "Streaming chunk pipeline: process filesToProcess in groups, flush groupChunks to embed+store per group — never accumulate all chunks"
    - "Inline token accumulation: totalChunkTokens += reduce during embed loop — eliminates post-loop O(n) reduce pass"

key-files:
  created: []
  modified:
    - src/workflows/index.ts

key-decisions:
  - "Group-based pipeline iterates over filesToProcess (incremental subset) using content from contentMap — no re-reading from disk"
  - "Step 6b concurrent reads apply to all files (hash computation); chunk pipeline applies to filesToProcess only (embed processing)"
  - "writeIndexState uses table.countRows() not totalChunks — reflects full accumulated count across all incremental runs"

patterns-established:
  - "Concurrent file I/O pattern: for groupStart loop + Promise.all(group.map(async filePath => readFile)) — no external semaphore needed"
  - "Token accumulation in embed loop: totalChunkTokens += texts.reduce(...countChunkTokens...) per batch — avoids second full scan"

requirements-completed: [PERF-01, PERF-02, DEBT-06]

# Metrics
duration: 2min
completed: 2026-04-01
---

# Phase 11 Plan 01: Restore Concurrent Index Pipeline Summary

**Concurrent file I/O (Promise.all groups of 20) and streaming group-based chunk pipeline restored in index workflow, eliminating allChunks accumulator and redundant post-loop token counting**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-04-01T13:12:06Z
- **Completed:** 2026-04-01T13:13:50Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments

- Restored `FILE_READ_CONCURRENCY` import and replaced sequential Step 6b file-read loop with `Promise.all` group-based concurrent reads (PERF-01)
- Replaced `allChunks` accumulator + sequential embed loop with group-based streaming pipeline that chunks and flushes per group via `groupChunks` (PERF-02)
- Eliminated `allChunks.reduce(countChunkTokens)` in summary by accumulating `totalChunkTokens` during the embed loop (DEBT-06)
- All 265 existing tests pass without modification

## Task Commits

Each task was committed atomically:

1. **Task 1: Restore concurrent file reads in Step 6b** - `bfbe20a` (feat)
2. **Task 2: Replace allChunks accumulator with group-based streaming pipeline** - `5513e8a` (feat)

## Files Created/Modified

- `src/workflows/index.ts` - Concurrent Step 6b reads, group-based chunk+embed pipeline, inline token accumulation

## Decisions Made

- Group-based chunk pipeline iterates over `filesToProcess` (incremental subset) using content already in `contentMap` — no disk I/O needed in the chunk loop, only in Step 6b
- `writeIndexState` continues to use `await table.countRows()` for `chunkCount`, not `totalChunks` — the table reflects the full accumulated index across all incremental runs, not just this run's subset
- No external concurrency library needed — group-slice + `Promise.all` pattern established in Phase 9 is sufficient

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- PERF-01, PERF-02, DEBT-06 requirements satisfied
- Phase 12 (integration gap cleanup) can proceed
- Index workflow is now back to the Phase 9 performance baseline with Phase 10 incremental logic intact

---
*Phase: 11-restore-concurrent-index-pipeline*
*Completed: 2026-04-01*
