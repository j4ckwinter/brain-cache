---
phase: 15-storage-foundation-and-index-pipeline
plan: "01"
subsystem: storage
tags: [lancedb, edges-table, write-mutex, types, tdd]
dependency_graph:
  requires: []
  provides: [edge-table-schema, write-mutex, CallEdge-type, ChunkResult-type]
  affects: [src/services/lancedb.ts, src/lib/types.ts, src/services/index.ts]
tech_stack:
  added: []
  patterns: [Promise-chain write mutex, LanceDB non-vector table, Apache Arrow schema]
key_files:
  created: []
  modified:
    - src/lib/types.ts
    - src/services/lancedb.ts
    - src/services/index.ts
    - tests/services/lancedb.test.ts
decisions:
  - Write mutex uses Promise-chain serialization (module-level) — no deadlock on error via always-advancing _writeMutex
  - edgeSchema has no vector column — stable schema, never needs model-mismatch recreation
  - openOrCreateEdgesTable accepts shouldReset flag — triggered by chunks table model-change handler
  - insertEdges and deleteChunksByFilePath both wrapped in withWriteLock — protects all write operations
metrics:
  duration: "~3 minutes"
  completed: "2026-04-02"
  tasks_completed: 2
  files_modified: 4
---

# Phase 15 Plan 01: Storage Foundation — Edges Table and Write Mutex Summary

**One-liner:** LanceDB edges table with 6-field Arrow schema plus Promise-chain write mutex serializing all insert/delete operations for concurrent-safe indexing.

## What Was Built

Added the data foundation for v2.0 flow tracing:

1. **`src/lib/types.ts`** — New `CallEdge` interface (fromChunkId, fromFile, fromSymbol, toSymbol, toFile, edgeType) and `ChunkResult` interface (`{ chunks: CodeChunk[], edges: CallEdge[] }`).

2. **`src/services/lancedb.ts`** — Added:
   - `withWriteLock<T>()` — module-level Promise-chain mutex that serializes write operations without deadlocking on error
   - `EdgeRow` interface — snake_case mirror of `CallEdge` for LanceDB storage
   - `edgeSchema()` — 6-field Apache Arrow Schema (all Utf8, no vector column)
   - `openOrCreateEdgesTable()` — creates or opens the edges table; accepts `shouldReset` flag
   - `insertEdges()` — maps `CallEdge[]` to `EdgeRow[]` and adds via `table.add()` under write lock
   - `queryEdgesFrom()` — SQL predicate query via `query().where()` (not deprecated `filter()`)
   - Updated `insertChunks()` and `deleteChunksByFilePath()` to use `withWriteLock`
   - `openOrCreateChunkTable()` now also drops edges table on model-mismatch reset

3. **`src/services/index.ts`** — Barrel re-exports updated with `edgeSchema`, `openOrCreateEdgesTable`, `insertEdges`, `queryEdgesFrom`, `withWriteLock`, and `type EdgeRow`.

4. **`tests/services/lancedb.test.ts`** — 11 new tests across 5 describe blocks:
   - `edgeSchema` — field count and names
   - `openOrCreateEdgesTable` — create/open/reset behaviors
   - `insertEdges` — empty no-op and row insertion
   - `queryEdgesFrom` — match filtering and empty results
   - `withWriteLock` — serialization order and error recovery without deadlock

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| Task 1 | fb4c1e4 | feat(15-01): add CallEdge/ChunkResult types, EdgeRow, edge table functions, write mutex |
| Task 2 | 1936a48 | test(15-01): add unit tests for edge table functions and write mutex |

## Test Results

- All 262 tests pass (251 pre-existing + 11 new)
- `npx tsc --noEmit` exits 0

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — all functions are fully implemented. Edges table is ready for use by the chunker (Phase 15 plans 02-03) and flow tracer (Phase 16).

## Self-Check: PASSED

- `src/lib/types.ts` — FOUND: `export interface CallEdge`, `export interface ChunkResult`
- `src/services/lancedb.ts` — FOUND: `edgeSchema`, `openOrCreateEdgesTable`, `insertEdges`, `queryEdgesFrom`, `withWriteLock`, `EdgeRow`
- `tests/services/lancedb.test.ts` — FOUND: all 5 describe blocks
- Commits fb4c1e4 and 1936a48 — verified in git log
