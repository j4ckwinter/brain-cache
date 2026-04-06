---
phase: 49-file-watcher
plan: "02"
subsystem: cli
tags: [commander, watch, cli-registration, vitest]

dependency_graph:
  requires:
    - phase: 49-01
      provides: src/workflows/watch.ts with runWatch export
  provides:
    - "brain-cache watch [path] CLI command registered in Commander"
    - "CLI tests verifying watch command argument passing"
  affects: [phase-50-service-install]

tech-stack:
  added: []
  patterns: [lazy-import-in-action, vi-hoisted-mock, commander-optional-argument]

key-files:
  created: []
  modified:
    - src/cli/index.ts
    - tests/cli/cli.test.ts

key-decisions:
  - "Lazy import of runWatch inside .action() handler — matches existing CLI pattern for all other commands"
  - "No options added to watch command — runWatch handles defaults internally"

patterns-established:
  - "CLI watch command: no options, single optional [path] argument, lazy import in action"

requirements-completed: [DAILY-02]

duration: 5min
completed: "2026-04-06"
---

# Phase 49 Plan 02: CLI Watch Registration Summary

**`brain-cache watch [path]` command registered in Commander with lazy `runWatch` import and two CLI tests covering default undefined path and explicit path argument.**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-04-06T17:41:28Z
- **Completed:** 2026-04-06T17:42:20Z
- **Tasks:** 1
- **Files modified:** 2

## Accomplishments

- Registered `brain-cache watch [path]` command in `src/cli/index.ts` following the exact lazy-import pattern used by all other commands
- Added `mockRunWatch` to `vi.hoisted` block and `vi.mock` for `../../src/workflows/watch.js` in CLI test file
- Two new test cases verify `watch` calls `runWatch` with `undefined` when no path given and with the explicit path when provided
- Full test suite: 526 tests pass (524 pre-existing + 2 new)

## Task Commits

1. **Task 1: Register watch command in CLI and add test** - `383ee7d` (feat)

**Plan metadata:** (docs commit to follow)

## Files Created/Modified

- `src/cli/index.ts` - Added `watch` command block with lazy import of `runWatch` from `workflows/watch.js`
- `tests/cli/cli.test.ts` - Added `mockRunWatch` to hoisted block, `vi.mock` for watch.js, and two watch test cases

## Decisions Made

None — followed plan as specified. The watch command intentionally has no options (no `--force`, no `--verify`) since `runWatch` is a long-running process that manages its own lifecycle.

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `brain-cache watch [path]` is now fully wired: workflow (Plan 01) + CLI registration (Plan 02)
- Phase 50 (service install) can wrap this CLI command directly
- DAILY-02 requirement satisfied

---
*Phase: 49-file-watcher*
*Completed: 2026-04-06*
