---
phase: 46-missing-features
plan: 02
subsystem: workflows
tags: [staleness, status, doctor, mtime]
---

# Plan 46-02 Summary

## Outcome

Index staleness is detected by comparing each crawled source file’s `mtime` to `indexState.indexedAt`. When any file is newer, `brain-cache status` and `brain-cache doctor` print a staleness warning with the newest offending file and its mtime. No time-based threshold beyond that comparison.

## Key changes

- Added `src/lib/staleness.ts` (`checkIndexStaleness`, `StalenessResult`).
- `src/workflows/status.ts` — staleness check after the status block.
- `src/workflows/doctor.ts` — optional `targetPath`, `readIndexState` + staleness at end when an index exists.
- Tests: `tests/lib/staleness.test.ts` (mocked crawl + stat).

## Verification

- `npx vitest run` — green
