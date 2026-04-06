---
phase: 48-incremental-index-io
plan: 02
subsystem: index-workflow
tags: [incremental-indexing, stat-fingerprint, typescript, performance, tdd]

# Dependency graph
requires:
  - phase: 48-01
    provides: FileStatEntry type and FileHashManifest.stats field
provides:
  - statAllFiles helper (batched fs.stat with FILE_READ_CONCURRENCY)
  - partitionByStatChange exported pure function (exact research §3 shape)
  - runIndex stat fast-path: O(changed) reads instead of O(all) when stat matches
  - runIndex --verify option: bypasses stat cache, keeps incremental embeds
  - D-48-05: --force wins over --verify (documented in JSDoc)
  - D-48-06: token backfill — stat-skip only when tokenCounts present in manifest
  - stats written to every writeFileHashes call with actual size+mtimeMs values
  - CLI --verify flag wired to runIndex
affects: [48-03, 49-file-watcher, index-workflow, cli]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "stat fast-path: statAllFiles + partitionByStatChange before readFile loop"
    - "filesNeedingRead = statChanged ∪ noStoredHash ∪ missingTokenCount"
    - "outTokenCounts: carried-forward from manifest, overwritten by fresh reads"
    - "mergedStats: built from currentStats for all crawled files; excludes removed files"

key-files:
  created: []
  modified:
    - src/workflows/index.ts
    - src/cli/index.ts
    - tests/workflows/index.test.ts

key-decisions:
  - "D-48-05: --force wins over --verify (verifyEffective = verify && !force)"
  - "D-48-06: stat-skip requires tokenCounts to be present; otherwise backfill by reading"
  - "mergedStats built from currentStats for all crawled files — removed files excluded naturally"
  - "outTokenCounts initialized from existingTokenCounts, then overwritten by processFileGroup for fresh reads"
  - "CLI --verify uses long-form only (no short alias) to avoid conflict with --verbose style flags"

patterns-established:
  - "filesNeedingRead computed before read loop using partitionByStatChange"
  - "currentHashes built by mixing freshHashes (reads) and storedHashes (stat-skip)"

requirements-completed: [DAILY-01]

# Metrics
duration: 20min
completed: 2026-04-06
---

# Phase 48 Plan 02: Stat Layer and runIndex Refactor Summary

**stat fast-path: O(changed) reads via statAllFiles + partitionByStatChange with D-48-05/D-48-06 policies and --verify CLI option**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-04-06T17:14:33Z
- **Completed:** 2026-04-06T17:20:30Z
- **Tasks:** 3 (Task 2 was TDD: RED commit + GREEN commit)
- **Files modified:** 3

## Accomplishments

- Added `statAllFiles` async helper using `FILE_READ_CONCURRENCY` batching pattern (stat failures silently excluded)
- Exported `partitionByStatChange` pure function (exact shape from research §3): size+mtimeMs comparison, missing entries go to statChanged
- Extended `runIndex` signature to `(targetPath?, opts?: { force?: boolean; verify?: boolean })`
- Implemented `verifyEffective = verify && !force` per D-48-05 (force wins)
- `filesNeedingRead` computed as union of stat-changed + no-stored-hash + missing-tokenCount (D-48-06 backfill)
- Read+hash only `filesNeedingRead`; `currentHashes` mixes fresh hashes and stored hashes for stat-skipped files
- Built `mergedStats` from `currentStats` for all crawled files; included in both `writeFileHashes` call sites
- Built `outTokenCounts` initialized from `existingTokenCounts`, overwritten by `processFileGroup` for processed files
- `allFilesTotalTokens` now sums `outTokenCounts` (not `contentMap`) — correct for stat-skipped files
- Nothing-to-re-index early return updated to use `mergedStats` and `outTokenCounts`
- Wired `--verify` CLI option with doc noting `--force` overrides it
- Cherry-picked 48-01 commits into worktree (worktree was based on pre-48-01 master)
- All 76 relevant tests pass (43 index workflow + 33 lancedb service)

## Task Commits

1. **Task 1: statAllFiles and partitionByStatChange** - `1ab39dd` (feat)
2. **Task 2 RED: failing tests for stat fast-path** - `740b5a2` (test)
3. **Task 2 GREEN: implement stat fast-path** - `00e35b1` (feat)
4. **Task 3: CLI wiring and manifest field verification** - `488f9be` (feat)

## Files Created/Modified

- `src/workflows/index.ts` — Added statAllFiles, partitionByStatChange, refactored runIndex pipeline
- `src/cli/index.ts` — Added --verify option to index command
- `tests/workflows/index.test.ts` — Added stat mock, partitionByStatChange unit tests, stat fast-path integration tests

## Decisions Made

- `verifyEffective = (opts?.verify ?? false) && !(opts?.force ?? false)` — force wins per D-48-05
- stat-skip backfill policy (D-48-06): if `existingTokenCounts[fp] === undefined` but stat matches, file goes to `filesNeedingRead` rather than treating token count as 0
- `outTokenCounts` initialized as shallow clone of `existingTokenCounts` before the read loop, then overwritten by `processFileGroup` calls — ensures every file has a count for `allFilesTotalTokens`
- `mergedStats` built exclusively from `currentStats` over the current `files` set — removed files are not included (correct: they shouldn't be in the manifest)

## Deviations from Plan

### Non-plan work required

**1. Cherry-picked 48-01 commits (3 commits)**
- **Found during:** Execution start
- **Issue:** Worktree `worktree-agent-a809483a` was based on `master` before 48-01 commits landed. `FileStatEntry` and `FileHashManifest.stats` were not present.
- **Fix:** Cherry-picked `08e9510`, `a5b0491`, `a702d48` (48-01 task commits) into worktree before starting 48-02 work.
- **Impact:** None — cherry-pick applied cleanly; all 33 lancedb tests still green.

**2. [Rule 2 - Missing Critical] Added --verify to CLI**
- **Found during:** Task 3 review
- **Issue:** Research §1 explicitly calls for `src/cli/index.ts` wiring of `--verify`; plan Task 3 references this indirectly via "Import wiring"
- **Fix:** Added `.option('--verify', ...)` to `index` command and passed to `runIndex`
- **Files modified:** `src/cli/index.ts`
- **Commit:** `488f9be`

## Issues Encountered

- WASM files not present in worktree (`tree-sitter.wasm`) — causes 22 test failures in chunker, e2e, and distribution tests. These are pre-existing environment issues unrelated to this plan's changes; all 76 tests for modified files pass.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `partitionByStatChange` exported and tested — 48-03 can write integration tests immediately
- `runIndex` stat fast-path live — 48-03 smoke test can verify second-run skips reads
- All locked decisions implemented: D-48-05, D-48-06, D-48-02 (token carry-forward)
- CLI `--verify` wired and documented

---
*Phase: 48-incremental-index-io*
*Completed: 2026-04-06*
