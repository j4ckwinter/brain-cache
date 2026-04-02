---
phase: 15-storage-foundation-and-index-pipeline
plan: "02"
subsystem: indexing
tags: [ignore, crawler, braincacheignore, gitignore, exclusion]

requires:
  - phase: 15-01
    provides: storage foundation and index pipeline base (if applicable)

provides:
  - loadIgnorePatterns function reading .braincacheignore from any rootDir
  - crawlSourceFiles updated to accept extraIgnorePatterns via opts param
  - Barrel export for loadIgnorePatterns in src/services/index.ts

affects:
  - phase: 15-03 (if the indexing workflow now needs to pass .braincacheignore patterns to crawlSourceFiles)
  - Any workflow calling crawlSourceFiles that may want to load and pass .braincacheignore patterns

tech-stack:
  added: []
  patterns:
    - "loadIgnorePatterns: readFile .braincacheignore + split + filter blank/comment lines, return [] on ENOENT"
    - "crawlSourceFiles opts pattern: optional object with extraIgnorePatterns array, applied to ignore instance after .gitignore"

key-files:
  created:
    - src/services/ignorePatterns.ts
    - tests/services/ignorePatterns.test.ts
  modified:
    - src/services/crawler.ts
    - src/services/index.ts
    - tests/services/crawler.test.ts

key-decisions:
  - "opts object pattern for crawlSourceFiles (not positional arg) — keeps signature clean for future optional params"
  - "loadIgnorePatterns is a standalone service, not merged into crawler — single responsibility, testable in isolation"
  - "Pre-existing test failures (retriever + buildContext) confirmed out-of-scope — same failures exist before our changes"

patterns-established:
  - "Ignore file loader pattern: readFile + split('\\n') + filter(trim !== '' && !startsWith('#'))"
  - "Crawler opts pattern: opts?: { extraIgnorePatterns?: string[] } — optional object allows future opts without breaking callers"

requirements-completed: [EXC-01]

duration: 3min
completed: "2026-04-02"
---

# Phase 15 Plan 02: .braincacheignore Support Summary

**.braincacheignore file loader service and crawler integration — users can now exclude files from indexing without modifying .gitignore**

## Performance

- **Duration:** 3 min
- **Started:** 2026-04-02T19:00:15Z
- **Completed:** 2026-04-02T19:03:00Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- New `loadIgnorePatterns` service reads `.braincacheignore` from any rootDir, returns parsed patterns (skips comments and blank lines), returns `[]` on ENOENT
- Updated `crawlSourceFiles` to accept `opts?: { extraIgnorePatterns?: string[] }` — extra patterns applied to the existing `ignore` instance after `.gitignore` loading
- 7 new tests: 4 for `loadIgnorePatterns` (ENOENT, valid file, comments, all-comment file) + 3 for crawler integration (pattern exclusion, directory exclusion, backward compat)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create ignorePatterns service and tests** - `3ad0c3a` (feat)
2. **Task 2: Add extraIgnorePatterns to crawler and test .braincacheignore integration** - `7776600` (feat)

**Plan metadata:** (docs commit — see final_commit)

_Note: TDD tasks committed as single feat commits (test + implementation combined after GREEN phase)_

## Files Created/Modified
- `src/services/ignorePatterns.ts` - New service: `loadIgnorePatterns(rootDir)` reads `.braincacheignore`
- `tests/services/ignorePatterns.test.ts` - 4 tests for loadIgnorePatterns
- `src/services/crawler.ts` - Updated signature with `opts?: { extraIgnorePatterns?: string[] }`
- `src/services/index.ts` - Added barrel export for `loadIgnorePatterns`
- `tests/services/crawler.test.ts` - 3 new integration tests for extraIgnorePatterns

## Decisions Made
- Used opts object pattern (`opts?: { extraIgnorePatterns?: string[] }`) rather than positional arg — enables future options without breaking backward compat
- `loadIgnorePatterns` is a standalone service (not merged into crawler) — clean separation, testable in isolation
- Whitespace-only lines filtered via `line.trim() !== ''` to handle lines with spaces/tabs

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
Pre-existing test failures in `retriever.test.ts` and `buildContext.test.ts` (23 tests) were present before this plan's changes. Verified via git stash check. Out of scope per SCOPE BOUNDARY rule — logged here for awareness. Not related to indexing/crawler changes.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `loadIgnorePatterns` and updated `crawlSourceFiles` are ready for use in the indexing workflow
- The indexing workflow (next plan or existing) can call `loadIgnorePatterns(rootDir)` then pass result as `extraIgnorePatterns` to `crawlSourceFiles`
- Requirement EXC-01 (custom exclusion patterns via `.braincacheignore`) is now satisfied at the service layer

## Self-Check: PASSED

All files exist, all commits verified.

---
*Phase: 15-storage-foundation-and-index-pipeline*
*Completed: 2026-04-02*
