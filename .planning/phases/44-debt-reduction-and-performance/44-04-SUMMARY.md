---
phase: 44-debt-reduction-and-performance
plan: 04
subsystem: database
tags: [lancedb, token-counting, connection-pool, batch-delete, file-hashes]

# Dependency graph
requires:
  - phase: 44-03
    provides: getConnection() connection pool in lancedb.ts
  - phase: 44-01
    provides: requireProfile/requireOllama guards, workflow guard integration
provides:
  - Batch deletion function deleteChunksByFilePaths() with single IN predicate
  - FileHashManifest interface extending file-hashes.json with per-file tokenCounts
  - All three workflow files (index, buildContext, search) using getConnection()
  - Single-pass token counting in index workflow (no duplicate countChunkTokens per chunk)
  - buildContext reads token counts from manifest instead of disk reads
affects: [future-phases, performance, incremental-reindex]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Batch SQL IN predicate for multi-row deletes: deleteChunksByFilePaths(table, paths[])"
    - "FileHashManifest: hashes + tokenCounts persisted in file-hashes.json"
    - "Backward-compatible migration: legacy Record<string,string> format detected by absence of .hashes key"
    - "Single-pass token counting: count once per chunk, store in embeddableBatch, reuse for sum"
    - "Token manifest lookup: buildContext reads cached counts from file-hashes.json, falls back to disk"

key-files:
  created: []
  modified:
    - src/services/lancedb.ts
    - src/workflows/index.ts
    - src/workflows/buildContext.ts
    - src/workflows/search.ts
    - tests/services/lancedb.test.ts
    - tests/workflows/index.test.ts
    - tests/workflows/buildContext.test.ts
    - tests/workflows/search.test.ts

key-decisions:
  - "Keep deleteChunksByFilePath (singular) alongside deleteChunksByFilePaths (plural) for backward compat — singular may be used by other callers"
  - "FileHashManifest backward compat: detect old format by checking absence of .hashes key, migrate gracefully with empty tokenCounts"
  - "buildContext fallback path: readFile from disk when tokenCounts[fp] not in manifest, for indexes built before this phase"
  - "Empty tokenCounts in test beforeEach: exercises fallback disk-read path to keep existing test assertions valid"

patterns-established:
  - "Batch IN predicate pattern: map paths with quote-escaping, join with comma, single DELETE call"
  - "Carry-forward pattern: after processing new/changed files, iterate existingTokenCounts to preserve unchanged file counts"

requirements-completed: [PERF-02, DEBT-06, PERF-03]

# Metrics
duration: 35min
completed: 2026-04-06
---

# Phase 44 Plan 04: Batch Deletions, Token Dedup, and Manifest Token Counts Summary

**Batch SQL IN predicate for chunk/edge deletion, single-pass token counting per chunk, and per-file token counts in file-hashes.json eliminating disk reads in buildContext**

## Performance

- **Duration:** 35 min
- **Started:** 2026-04-06T07:50:00Z
- **Completed:** 2026-04-06T08:25:01Z
- **Tasks:** 3
- **Files modified:** 8

## Accomplishments
- Added `deleteChunksByFilePaths()` with single SQL `IN (...)` predicate replacing N serial acquires (PERF-02)
- Extended `file-hashes.json` to `FileHashManifest { hashes, tokenCounts }` with graceful old-format migration (PERF-03)
- Replaced serial deletion loop in `index.ts` with batch chunk + edge deletions via single IN predicate each (PERF-02)
- Eliminated redundant `countChunkTokens` call per chunk (was called in filter + sum, now called once) (DEBT-06)
- Wire `getConnection()` into all three workflows (index, buildContext, search) replacing `openDatabase()` (PERF-01)
- `buildContext` reads per-file token counts from manifest for zero disk reads on recent indexes (PERF-03)

## Task Commits

Each task was committed atomically:

1. **Task 1: Add batch deletion function and extend file-hashes.json with token counts** - `4321a91` (feat)
2. **Task 2: Wire batch deletions, token dedup, getConnection, and token counts in index.ts** - `d02ebb7` (feat)
3. **Task 3: Optimize buildContext and search to use getConnection and token counts from manifest** - `99eae27` (feat)

**Plan metadata:** (pending docs commit)

## Files Created/Modified
- `src/services/lancedb.ts` - Added `deleteChunksByFilePaths()`, `FileHashManifest` interface, updated `readFileHashes`/`writeFileHashes` signatures
- `src/workflows/index.ts` - Replaced `openDatabase` with `getConnection`, serial delete loop with batch, double token count with single-pass, writes `tokenCounts` to manifest
- `src/workflows/buildContext.ts` - Replaced `openDatabase` with `getConnection`, reads `tokenCounts` from manifest with disk fallback
- `src/workflows/search.ts` - Replaced `openDatabase` with `getConnection`
- `tests/services/lancedb.test.ts` - Updated readFileHashes/writeFileHashes tests for FileHashManifest format, added legacy migration test
- `tests/workflows/index.test.ts` - Replaced `openDatabase`/`deleteChunksByFilePath` mocks with `getConnection`/`deleteChunksByFilePaths`, updated `readFileHashes` mock to return FileHashManifest
- `tests/workflows/buildContext.test.ts` - Replaced `openDatabase` mock with `getConnection`, added `readFileHashes` mock
- `tests/workflows/search.test.ts` - Replaced `openDatabase` mock with `getConnection`

## Decisions Made
- Kept `deleteChunksByFilePath` (singular) alongside the new batch version for backward compat
- FileHashManifest backward compat: detect legacy format by absence of `.hashes` key, migrate with empty `tokenCounts`
- buildContext: return empty `tokenCounts` in test default setup to exercise the fallback disk-read path and keep existing assertions valid
- Token count carry-forward: after processing new/changed files, iterate `existingTokenCounts` to preserve unchanged file token counts in the next manifest write

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated test mocks for renamed/replaced lancedb exports**
- **Found during:** Task 2 (index.ts changes)
- **Issue:** Tests in `index.test.ts`, `lancedb.test.ts`, `buildContext.test.ts`, and `search.test.ts` mocked `openDatabase` and `deleteChunksByFilePath` (singular) — both replaced. Also `readFileHashes` mock returned plain `{}` but now returns `FileHashManifest`.
- **Fix:** Updated all 4 test files to mock the new APIs (`getConnection`, `deleteChunksByFilePaths`, `readFileHashes` returning `{ hashes: {}, tokenCounts: {} }`)
- **Files modified:** All 4 test files
- **Verification:** 81 affected tests pass after update
- **Committed in:** d02ebb7 (Task 2 commit) and 99eae27 (Task 3 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - test mock updates required by API changes)
**Impact on plan:** Necessary correctness fix — tests directly test the changed APIs. No scope creep.

## Issues Encountered

- Worktree branch was behind master — Phase 44 plans 01-03 were committed to other worktree branches and merged to a detached HEAD. Had to `git merge 7589570` to fast-forward the branch before starting work. This is expected behavior for the parallel executor pattern.

## Next Phase Readiness
- All Phase 44 PERF-01/02/03 and DEBT-06 requirements complete
- Connection pool, batch deletions, and token manifest now in place
- Phase 45 (testing and guard extraction) can proceed without blocking dependencies

## Self-Check: PASSED

- FOUND: `/workspace/.planning/phases/44-debt-reduction-and-performance/44-04-SUMMARY.md`
- FOUND: `/workspace/.claude/worktrees/agent-a461475c/src/services/lancedb.ts`
- FOUND: `/workspace/.claude/worktrees/agent-a461475c/src/workflows/index.ts`
- FOUND: `/workspace/.claude/worktrees/agent-a461475c/src/workflows/buildContext.ts`
- FOUND: `/workspace/.claude/worktrees/agent-a461475c/src/workflows/search.ts`
- FOUND commits: `99eae27`, `d02ebb7`, `4321a91`

---
*Phase: 44-debt-reduction-and-performance*
*Completed: 2026-04-06*
