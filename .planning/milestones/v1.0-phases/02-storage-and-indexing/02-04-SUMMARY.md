---
phase: 02-storage-and-indexing
plan: 04
subsystem: indexing
tags: [workflow, crawler, chunker, embedder, lancedb, ollama, cli, commander, pipeline]

dependency_graph:
  requires:
    - phase: 02-01
      provides: CodeChunk, IndexState, CapabilityProfile types, EMBEDDING_DIMENSIONS, DEFAULT_BATCH_SIZE
    - phase: 02-02
      provides: crawlSourceFiles, chunkFile
    - phase: 02-03
      provides: openDatabase, openOrCreateChunkTable, insertChunks, writeIndexState, ChunkRow, embedBatchWithRetry
    - phase: 01-01
      provides: readProfile, isOllamaRunning, childLogger, pino logging
  provides:
    - runIndex (src/workflows/index.ts) — full crawl -> chunk -> embed -> store pipeline
    - brain-cache index [path] CLI command (src/cli/index.ts)
    - tests/workflows/index.test.ts — 15 integration tests for runIndex workflow
  affects:
    - 03 (retrieval workflow uses same LanceDB index written by runIndex)
    - 04 (MCP server exposes index_repo tool backed by runIndex)

tech-stack:
  added: []
  patterns:
    - Workflow orchestrates services in strict order: crawlSourceFiles -> chunkFile per file -> embedBatchWithRetry in batches -> insertChunks -> writeIndexState
    - Batch processing with DEFAULT_BATCH_SIZE (32) to avoid N+1 embed pattern
    - Progress reporting every 10 files and every batch to stderr
    - Graceful zero-file handling: return (not exit) when no source files found
    - All output via process.stderr.write (zero stdout — D-16)

key-files:
  created:
    - tests/workflows/index.test.ts
  modified:
    - src/workflows/index.ts
    - src/cli/index.ts

key-decisions:
  - "runIndex calls process.exit(1) on missing profile or Ollama not running — fatal conditions with clear error messages to stderr"
  - "Zero-file case is non-fatal: return early without writeIndexState (nothing to index is not an error)"
  - "openOrCreateChunkTable called with (db, rootDir, model, dim) — projectRoot required as 4th param per Phase 02-03 decision"

patterns-established:
  - "Pattern: workflow integration tests mock all services at module level, dynamically import workflow in beforeEach after mocks set up"
  - "Pattern: process.exit spy throws Error('process.exit(N)') so tests can use rejects.toThrow without process actually exiting"

requirements-completed: [IDX-01, IDX-05]

duration: 12min
completed: 2026-03-31
---

# Phase 02 Plan 04: Index Pipeline Summary

**runIndex workflow wires crawl -> chunk -> embed -> store into `brain-cache index [path]` with zero-config defaults from capability profile**

## Performance

- **Duration:** 12 min
- **Started:** 2026-03-31T10:50:00Z
- **Completed:** 2026-03-31T11:02:00Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- runIndex workflow orchestrates the full 4-service pipeline: crawler, chunker, embedder, LanceDB storage
- CLI exposes `brain-cache index [path]` with optional path argument defaulting to cwd
- Progress reporting to stderr at every batch (embedding) and every 10 files (chunking)
- Index state written after successful indexing with model, dimension, file count, chunk count
- 15 integration tests verify pipeline ordering, error handling, and edge cases
- Full test suite: 131 tests passing across 8 test files, zero regressions

## Task Commits

1. **Task 1: Build runIndex workflow** - `b7db556` (feat)
2. **Task 2: Wire CLI index command and create workflow integration test** - `a0ef6a7` (feat)

## Files Created/Modified
- `src/workflows/index.ts` - runIndex workflow orchestrating crawl -> chunk -> embed -> store
- `src/cli/index.ts` - Added `brain-cache index [path]` command with dynamic import
- `tests/workflows/index.test.ts` - 15 integration tests for runIndex workflow

## Decisions Made
- openOrCreateChunkTable called with 4 params including rootDir — the plan's interface section showed 3 params but the actual implementation (from 02-03) requires projectRoot as the 4th param; used the actual signature
- Graceful zero-file return (not exit) because "no files to index" is a valid state for empty directories

## Deviations from Plan

**1. [Rule 1 - Bug] Corrected openOrCreateChunkTable call signature**
- **Found during:** Task 1 (Build runIndex workflow)
- **Issue:** Plan's `<interfaces>` section showed `openOrCreateChunkTable(db, model, dim)` with 3 params, but the actual lancedb.ts from Plan 02-03 takes 4 params: `(db, projectRoot, model, dim)`
- **Fix:** Called `openOrCreateChunkTable(db, rootDir, profile.embeddingModel, dim)` matching the actual signature
- **Files modified:** src/workflows/index.ts
- **Verification:** TypeScript compiles without errors; full test suite passes
- **Committed in:** b7db556 (Task 1 commit)

**2. [Rule 3 - Blocking] Tests must run from worktree root, not /workspace**
- **Found during:** Task 2 (verification step)
- **Issue:** `npm test` from /workspace uses /workspace/tests/ — worktree tests are at .claude/worktrees/agent-aa2f1409/tests/ and not found by the main vitest config
- **Fix:** Used `NODE_PATH=/workspace/node_modules /workspace/node_modules/.bin/vitest run --root /workspace/.claude/worktrees/agent-aa2f1409` for test verification in the worktree
- **Impact:** Worktree tests verified correctly; orchestrator merges worktree branch which includes the test file

---

**Total deviations:** 2 auto-fixed (1 bug/signature mismatch, 1 blocking/test-runner path)
**Impact on plan:** Both fixes necessary for correct operation. No scope creep.

## Issues Encountered
- tsx `-e` flag in the plan's verify command failed when run from worktree (no local node_modules, CWD resolution issues). Verified compilation via `npx tsc --noEmit` (zero new errors) and test suite instead.

## Next Phase Readiness
- Phase 02 complete: all 4 services built, index workflow wired, CLI has init/doctor/index commands
- Phase 03 (retrieval) can now open the LanceDB index written by runIndex and run vector similarity search
- Index state JSON at .brain-cache/index_state.json carries model/dimension metadata needed for query embedding alignment

## Self-Check: PASSED

- FOUND: src/workflows/index.ts
- FOUND: src/cli/index.ts
- FOUND: tests/workflows/index.test.ts
- FOUND: 02-04-SUMMARY.md
- FOUND: commit b7db556 (Task 1 - runIndex workflow)
- FOUND: commit a0ef6a7 (Task 2 - CLI + tests)

---
*Phase: 02-storage-and-indexing*
*Completed: 2026-03-31*
