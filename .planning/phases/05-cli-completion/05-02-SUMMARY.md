---
phase: 05-cli-completion
plan: "02"
subsystem: workflows
tags: [cli, init, index, embeddings, token-savings, progress]
dependency_graph:
  requires: ["05-01"]
  provides: ["CLI-01", "CLI-02"]
  affects: ["src/workflows/init.ts", "src/workflows/index.ts"]
tech_stack:
  added: []
  patterns: ["dynamic import for embedder warm-up", "carriage-return progress output", "token savings calculation"]
key_files:
  created: []
  modified:
    - src/workflows/init.ts
    - src/workflows/index.ts
    - tests/workflows/init.test.ts
    - tests/workflows/index.test.ts
decisions:
  - "Dynamic import() for embedBatchWithRetry in init.ts keeps warm-up isolated without circular dependency risk"
  - "Carriage-return progress (\r) for embedding loop enables single-line in-place update to stderr"
  - "Token reduction computed as (1 - chunkTokens/rawTokens) * 100 — raw tokens from full file content, chunk tokens summed from stored chunks"
metrics:
  duration: "5 min"
  completed_date: "2026-04-01"
  tasks_completed: 2
  files_modified: 4
---

# Phase 05 Plan 02: Init Warm-Up and Index Progress Summary

Model warm-up in `braincache init` and percentage-based embedding progress plus token savings stats in `braincache index`.

## What Was Built

### Task 1: Model warm-up in runInit (CLI-01)

Added a warm-up step between model pull and profile write in `src/workflows/init.ts`. After `pullModelIfMissing`, the workflow:
1. Writes `brain-cache: warming model {model} into VRAM...\n` to stderr
2. Calls `embedBatchWithRetry(model, ['warmup'])` via dynamic import
3. Writes `brain-cache: model warm.\n` to stderr

Steps renumbered: old Step 7 (writeProfile) became Step 8, old Step 8 (success summary) became Step 9.

### Task 2: Percentage progress and token savings in runIndex (CLI-02)

Updated `src/workflows/index.ts` with two improvements:

**Percentage progress:** Replaced flat `embedded N/total chunks\n` with carriage-return in-place update:
```
\rbrain-cache: embedding N/total chunks (XX%)
```
A `\n` flushes the line after the loop completes.

**Token savings stats:** Added `countChunkTokens` import. During the chunking loop, raw file content tokens are accumulated into `totalRawTokens`. After embedding, `totalChunkTokens` is computed by summing chunk content tokens. The final summary now outputs:
```
brain-cache: indexing complete
  Files:        N
  Chunks:       N
  Model:        model-name
  Raw tokens:   N,NNN
  Chunk tokens: N,NNN
  Reduction:    NN%
  Stored in:    /path/.brain-cache/
```

## Tests

- `tests/workflows/init.test.ts`: Added `vi.mock('../../src/services/embedder.js', ...)`, imported `embedBatchWithRetry` mock, added 2 new tests: "warms model into VRAM after pull" and "prints warming message to stderr". All 28 tests pass.
- `tests/workflows/index.test.ts`: Added `vi.mock('../../src/services/tokenCounter.js', ...)` returning 50 tokens per call. Added 2 new tests: "prints percentage progress during embedding" and "prints token savings stats on completion". All 17 tests pass.

## Commits

- `945c560`: feat(05-02): add model warm-up to runInit after model pull
- `abc5434`: feat(05-02): add percentage progress and token savings to runIndex

## Deviations from Plan

None - plan executed exactly as written.

## Known Stubs

None.

## Self-Check: PASSED

- [x] `src/workflows/init.ts` modified with warm-up step
- [x] `src/workflows/index.ts` modified with percentage progress and token stats
- [x] `tests/workflows/init.test.ts` updated with warm-up tests
- [x] `tests/workflows/index.test.ts` updated with progress and stats tests
- [x] Commit `945c560` exists
- [x] Commit `abc5434` exists
- [x] Full test suite: 224/224 tests passing
