---
phase: 48-incremental-index-io
plan: 03
subsystem: index-workflow
tags: [incremental-indexing, stat-fingerprint, typescript, testing, tempdir]

# Dependency graph
requires:
  - phase: 48-02
    provides: statAllFiles, partitionByStatChange, FileHashManifest.stats, CLI --verify wiring
provides:
  - runIndex stat fast-path fully implemented (O(changed) reads)
  - verifyEffective semantics (D-48-05: force wins over verify)
  - filesNeedingRead policy (D-48-06: backfill missing tokenCounts)
  - CLI --verify tests (2 cases: flag pass-through, both-flags)
  - Controlled-mtime tempdir tests using real fs.stat + utimes (5 cases)
affects: [49-file-watcher, index-workflow, test-coverage]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "controlled-mtime tempdir: write file + utimes to produce deterministic stat entries"
    - "partitionByStatChange tested against real filesystem (no mocking)"

key-files:
  created:
    - tests/workflows/statFastPath.test.ts
  modified:
    - src/workflows/index.ts
    - tests/cli/cli.test.ts

key-decisions:
  - "D-48-05 confirmed: verifyEffective = verify && !force — both flags pass to runIndex, workflow decides"
  - "Controlled-mtime tempdir tests exercise partitionByStatChange via utimes without mocking stat"
  - "Cherry-picked 48-02 commits (1ab39dd, 6fed1c7, 1c39a89) — 00e35b1 was skipped due to conflict, re-implemented inline"

requirements-completed: [DAILY-01]

# Metrics
duration: 15min
completed: 2026-04-06
---

# Phase 48 Plan 03: CLI --verify, Workflow + CLI Tests, Controlled-mtime Tempdir Summary

**runIndex stat fast-path fully implemented with controlled-mtime tempdir tests and CLI --verify coverage**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-04-06T17:26:54Z
- **Completed:** 2026-04-06T17:28:25Z
- **Tasks:** 3 (stat fast-path implementation, CLI tests, tempdir tests)
- **Files modified:** 3

## Accomplishments

- Implemented `runIndex` stat fast-path (the GREEN from 48-02 was lost due to cherry-pick conflict):
  - `verifyEffective = (verify && !force)` per D-48-05
  - `filesNeedingRead` computed as stat-changed + no-stored-hash + missing-tokenCounts (D-48-06)
  - `freshHashes` vs `storedHashes` mixed to build `currentHashes`
  - `mergedStats` built from `currentStats` for manifest write
  - `outTokenCounts` initialized from `existingTokenCounts`, overwritten by `processFileGroup`
  - `allFilesTotalTokens` sums `outTokenCounts` for all crawled files
- Added CLI tests for `--verify` option (2 new tests covering flag pass-through and both-flags)
- Added `tests/workflows/statFastPath.test.ts` with 5 controlled-mtime tempdir tests:
  - Unchanged: size + mtime match → statUnchanged
  - Content changed: size differs → statChanged
  - mtime bumped (utimes): same size, different mtime → statChanged
  - Mixed: multiple files with mixed results
  - Clock-skew: stored mtime differs from current → statChanged (safe fallback)
- All 151 workflow + CLI tests pass

## Task Commits

1. **Task 1: stat fast-path implementation** - `0e77ee6` (feat)
2. **Task 2: CLI --verify tests** - `72f8c33` (test)
3. **Task 3: controlled-mtime tempdir tests** - `480f707` (test)

## Files Created/Modified

- `src/workflows/index.ts` — Stat fast-path in runIndex, verifyEffective semantics
- `tests/cli/cli.test.ts` — Added --verify and --force --verify CLI tests
- `tests/workflows/statFastPath.test.ts` — 5 controlled-mtime tempdir integration tests

## Decisions Made

- `verifyEffective = (opts?.verify ?? false) && !force` — force wins per D-48-05; both flags passed to runIndex, only workflow applies the policy
- Controlled-mtime tests use `utimes` from `node:fs/promises` to advance mtime without modifying file content — exercises the mtime-only-changes path
- Cherry-pick deviation: 48-02 commit `00e35b1` was skipped during cherry-pick due to conflict on `src/workflows/index.ts`; re-implemented from the referenced commit's content

## Deviations from Plan

### Non-plan work required

**1. Cherry-picked 48-02 commits (3 of 4 commits)**
- **Found during:** Execution start
- **Issue:** Worktree `worktree-agent-a2d153e7` was based on master before 48-02 commits. `statAllFiles`, `partitionByStatChange`, `--verify` CLI, and stat fast-path tests were not present.
- **Fix:** Cherry-picked `1ab39dd`, `6fed1c7`, `1c39a89` into worktree. Commit `00e35b1` (GREEN implementation) was skipped due to conflict on `index.ts` which already had partial changes from the test commit's setup.
- **Impact:** The stat fast-path implementation was re-applied from scratch as Task 1 of this plan.

**2. [Rule 3 - Blocking] Re-implemented missing GREEN commit**
- **Found during:** Task 1 (reading workflow file after cherry-picks)
- **Issue:** `runIndex` signature still showed `opts?: { force?: boolean }` without `verify`, and the function still read all files unconditionally (no stat fast-path). The `00e35b1` GREEN commit was lost.
- **Fix:** Implemented the full stat fast-path from the reference commit's code, including verifyEffective, filesNeedingRead, freshHashes/currentHashes mix, mergedStats, outTokenCounts with carry-forward.
- **Files modified:** `src/workflows/index.ts`
- **Commit:** `0e77ee6`

## Issues Encountered

- WASM files not present in worktree (`tree-sitter.wasm`) — causes failures in chunker, e2e, and distribution tests. Pre-existing environment issue; all 151 tests for modified files (workflows + CLI) pass.

## User Setup Required

None.

## Next Phase Readiness

- All 3 success criteria for Phase 48 are met:
  1. Manifest records per-file stat (size + mtimeMs) — `FileHashManifest.stats`
  2. Full re-read+hash path exists: `--verify` bypasses stat cache; `--force` full reindex
  3. Controlled-mtime tempdir tests cover the stat fast-path behavior
- Phase 49 (File Watcher) can proceed: `runIndex` accepts `{ force, verify }` and the stat fast-path reduces I/O per incremental call

## Self-Check: PASSED

- `tests/workflows/statFastPath.test.ts` — FOUND
- `.planning/phases/48-incremental-index-io/48-03-SUMMARY.md` — FOUND
- Commit `0e77ee6` (feat: stat fast-path) — FOUND
- Commit `72f8c33` (test: CLI --verify) — FOUND
- Commit `480f707` (test: controlled-mtime tempdir) — FOUND

---
*Phase: 48-incremental-index-io*
*Completed: 2026-04-06*
