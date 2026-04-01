---
phase: 10-incremental-indexing-and-intent-classification
plan: 01
subsystem: indexing
tags: [lancedb, sha256, hashing, incremental, embeddings, cli]

requires:
  - phase: 09-indexing-and-retrieval-performance
    provides: LanceDB service, chunker, embedder, index workflow foundation

provides:
  - SHA-256 content hashing for file change detection (readFileHashes, writeFileHashes in lancedb service)
  - deleteChunksByFilePath for stale chunk cleanup on re-index
  - FILE_HASHES_FILENAME constant in config.ts
  - Incremental runIndex with new/changed/removed/unchanged diff logic
  - --force/-f CLI flag for full reindex bypass

affects:
  - 10-02-intent-classification (uses same index workflow)
  - Any future phase touching the index pipeline

tech-stack:
  added: [node:crypto createHash]
  patterns:
    - "Hash manifest pattern: .brain-cache/file-hashes.json persists SHA-256 per file path"
    - "Incremental diff: new/changed/removed sets computed from stored vs current hashes"
    - "Delete-before-reinsert: changed/removed file chunks deleted before new chunks inserted"

key-files:
  created:
    - tests/services/lancedb.test.ts
  modified:
    - src/lib/config.ts
    - src/services/lancedb.ts
    - src/workflows/index.ts
    - src/cli/index.ts
    - tests/workflows/index.test.ts

key-decisions:
  - "Hash manifest stored separately from index_state.json at .brain-cache/file-hashes.json (keeps concerns separate)"
  - "Content hashed with SHA-256 via node:crypto (built-in, no extra dep)"
  - "All file content read upfront into a Map to avoid double-reads during chunking"
  - "force=true sets storedHashes={} rather than skipping manifest read (simpler code path)"
  - "table.countRows() used for chunkCount in index state to reflect actual DB state after delta ops"

patterns-established:
  - "readFileHashes/writeFileHashes follow same pattern as readIndexState/writeIndexState"
  - "SQL predicate single-quote escaping: filePath.replace(/'/g, \"''\")"
  - "TDD: write failing tests first, implement to green, verify with npx vitest run"

requirements-completed: [DEBT-01]

duration: 3min
completed: 2026-04-01
---

# Phase 10 Plan 01: Incremental Indexing Summary

**SHA-256 content-hash diffing for brain-cache index: only new and changed files re-embedded, stale chunks deleted, with --force flag for full reindex escape hatch**

## Performance

- **Duration:** 3 min
- **Started:** 2026-04-01T12:22:38Z
- **Completed:** 2026-04-01T12:26:05Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- Added `FILE_HASHES_FILENAME` constant and three new exported functions to lancedb service: `readFileHashes`, `writeFileHashes`, `deleteChunksByFilePath`
- Implemented incremental diff logic in `runIndex`: computes new/changed/removed/unchanged file sets via SHA-256 content hashing, skips unchanged files entirely
- Added `--force` flag to CLI `index` command that bypasses the hash manifest for a full reindex
- 17 new tests added (8 lancedb service tests + 9 incremental workflow tests); all 241 tests pass

## Task Commits

Each task was committed atomically:

1. **Task 1: Add hash manifest functions and deleteChunksByFilePath** - `a9d780f` (feat)
2. **Task 2: Implement incremental indexing logic and --force CLI flag** - `3e34899` (feat)

## Files Created/Modified

- `src/lib/config.ts` - Added `FILE_HASHES_FILENAME = 'file-hashes.json'` constant
- `src/services/lancedb.ts` - Added `readFileHashes`, `writeFileHashes`, `deleteChunksByFilePath`
- `src/workflows/index.ts` - Incremental diff logic, `createHash` usage, updated `runIndex` signature
- `src/cli/index.ts` - Added `--force` / `-f` option to `index` command
- `tests/services/lancedb.test.ts` - New test file: 8 tests for hash manifest functions
- `tests/workflows/index.test.ts` - Extended with lancedb mock updates and 9 new incremental test cases

## Decisions Made

- Hash manifest at `.brain-cache/file-hashes.json` kept separate from `index_state.json` — single-responsibility
- `node:crypto` SHA-256 used (built-in, zero new dependency)
- All file content pre-loaded into a `Map<filePath, content>` to avoid re-reading during chunking
- `force=true` sets `storedHashes = {}` so all files appear as "new" — simplest correct implementation
- `table.countRows()` used for `chunkCount` to get accurate post-delta count from LanceDB

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 10-01 complete. Incremental indexing is fully operational.
- Plan 10-02 (intent classification) can proceed — it touches separate files and the same index workflow.
- All 241 tests passing; codebase in clean state.

---
*Phase: 10-incremental-indexing-and-intent-classification*
*Completed: 2026-04-01*

## Self-Check: PASSED

All created files found on disk. Both task commits (a9d780f, 3e34899) confirmed in git log. All 241 tests passing.
