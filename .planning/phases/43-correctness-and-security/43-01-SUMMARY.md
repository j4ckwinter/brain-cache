---
phase: 43-correctness-and-security
plan: 01
subsystem: embedder, retriever, indexLock, workflows/index
tags: [correctness, zero-vector, locking, concurrency, tdd]
dependency_graph:
  requires: []
  provides:
    - zeroVectorIndices in embedBatchWithRetry return value
    - zero-vector chunk skip in runIndex before insertChunks
    - zero-vector row filter in searchChunks at query time
    - PID lockfile service (acquireIndexLock / releaseIndexLock)
    - cross-process index serialization in runIndex
  affects:
    - src/services/embedder.ts
    - src/services/retriever.ts
    - src/services/indexLock.ts (new)
    - src/workflows/index.ts
tech_stack:
  added: []
  patterns:
    - TDD with vitest (RED-GREEN per task)
    - process.kill(pid, 0) for PID liveness detection
    - zero-vector detection via vector.every(v => v === 0)
key_files:
  created:
    - src/services/indexLock.ts
    - tests/services/indexLock.test.ts
  modified:
    - src/services/embedder.ts
    - src/services/retriever.ts
    - src/workflows/index.ts
    - tests/services/embedder.test.ts
    - tests/services/retriever.test.ts
    - tests/workflows/index.test.ts
decisions:
  - embedBatchWithRetry returns zeroVectorIndices Set (not a schema column) to avoid breaking existing LanceDB indexes
  - Zero-vector filter added to retriever as belt-and-suspenders for old indexes that may already contain zero vectors
  - PID lockfile uses fail-fast semantics per D-01 — no waiting, immediate error on live lock
  - Lock acquired after rootDir resolved, before try block body; released in finally to always clean up
metrics:
  duration_seconds: 289
  completed_date: "2026-04-06"
  tasks_completed: 2
  tasks_total: 2
  files_modified: 8
---

# Phase 43 Plan 01: Zero-vector Exclusion and Cross-process Index Locking Summary

**One-liner:** PID lockfile service for cross-process index serialization and zero-vector chunk exclusion via Set-based index tracking with belt-and-suspenders query-time filter.

## What Was Built

### Task 1: Zero-vector Exclusion (COR-01)

**Problem:** Un-embeddable chunks (too large for model context) were stored as zero vectors in LanceDB and appeared in search results as noise.

**Solution (three-layer):**

1. **embedder.ts** — `embedBatchWithRetry` return type extended to include `zeroVectorIndices: Set<number>`. When the context-length fallback loop creates a zero vector for a text at index `i`, it calls `zeroVectorIndices.add(i)`. All return paths now include this field (empty Set on success path).

2. **workflows/index.ts** — After receiving `zeroVectorIndices` from `embedBatchWithRetry`, the batch→row builder filters out entries where `zeroVectorIndices.has(i)`. Zero-vector chunks are never stored in LanceDB.

3. **retriever.ts** — Added filter in `searchChunks()` pipeline between the distance threshold filter and the row→chunk mapping: `!vec || !vec.every(v => v === 0)`. This handles any zero vectors that may exist in pre-existing user indexes.

**Critical constraint respected:** `chunkSchema()` in `lancedb.ts` was NOT modified — adding a new Arrow column would break all existing user LanceDB indexes on open.

### Task 2: Cross-process Index Locking (COR-03)

**Problem:** The existing `withWriteLock()` in `lancedb.ts` is an in-process Promise-chain mutex. It does not protect against two OS-level processes (e.g., CLI + MCP server) indexing the same project concurrently, which can corrupt the LanceDB table.

**Solution:** New `src/services/indexLock.ts` with two exported functions:

- `acquireIndexLock(projectRoot)`: Reads lockfile at `<project>/.brain-cache/index.lock`. If file contains a live PID (`process.kill(pid, 0)` succeeds), throws immediately. If file contains a dead PID (ESRCH), overwrites with current PID (stale lock cleanup). If no file exists, creates it.
- `releaseIndexLock(projectRoot)`: Unlinks the lockfile, no-op if already gone.

**Integration in `runIndex`:** Lock is acquired after `rootDir = resolve(...)` but before the `try` block. The existing `finally` block (which restores log level and stderr) also calls `releaseIndexLock(rootDir)` — ensuring the lock is always released even on errors or cancellation.

## Test Coverage

| Test File | Tests | New Tests Added |
|-----------|-------|-----------------|
| tests/services/embedder.test.ts | 9 (was 7) | 2 new: zeroVectorIndices assertions |
| tests/services/retriever.test.ts | 64 (was 62) | 2 new: zero-vector filter |
| tests/services/indexLock.test.ts | 5 | 5 new (file created) |
| tests/workflows/index.test.ts | 22 (was 19) | 3 new: lock acquire/release |
| **Total suite** | **456** | **12 new** |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Existing embedder tests used toEqual with the return value**
- **Found during:** Task 1 GREEN phase
- **Issue:** Existing tests expected `{ embeddings, skipped: 0 }` with `toEqual`, which fails when the return type gains `zeroVectorIndices`. 
- **Fix:** Updated `toEqual` to `toMatchObject` and added explicit `zeroVectorIndices` assertions in the tests that needed them.
- **Files modified:** tests/services/embedder.test.ts
- **Commit:** 9230c83

**2. [Rule 1 - Bug] index.test.ts mock returned object without zeroVectorIndices**
- **Found during:** Task 1 post-implementation verification
- **Issue:** The mock for `embedBatchWithRetry` in `index.test.ts` returned `{ embeddings, skipped: 0 }` without `zeroVectorIndices`, causing `undefined.size` errors in the workflow code.
- **Fix:** Updated both `mockResolvedValue` and `mockImplementation` calls to include `zeroVectorIndices: new Set()`.
- **Files modified:** tests/workflows/index.test.ts
- **Commit:** 9230c83

**3. [Rule 1 - Bug] retriever zero-vector filter crashed when vector field absent from mock rows**
- **Found during:** Task 1 GREEN phase — existing retriever tests failed
- **Issue:** Initial filter `!(r.vector as number[]).every(v => v === 0)` crashed with "Cannot read properties of undefined (reading 'every')" because existing mock rows don't include a `vector` field (they only have `RawChunkRow` fields).
- **Fix:** Changed filter to safely handle absent vector: `const vec = (r as unknown as { vector?: number[] }).vector; return !vec || !vec.every(v => v === 0)`.
- **Files modified:** src/services/retriever.ts
- **Commit:** 9230c83

## Known Stubs

None — all implemented functionality is fully wired.

## Self-Check: PASSED
