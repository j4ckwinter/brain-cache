---
phase: 59-missing-functionality
plan: 02
subsystem: cli
tags: [commander, fs, pathValidator, clean, watch, skill]

# Dependency graph
requires:
  - phase: 58-security
    provides: validateIndexPath with resolve-then-blocklist path validation
provides:
  - brain-cache clean CLI command that removes .brain-cache/ with path validation
  - validateIndexPath blocks filesystem root (/) and home directory root
  - SKILL.md documents watch mode as CLI-only with rationale and clean command
affects: [cli-users, documentation, skill-consumers]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Clean workflow: access-check before rm with stdout-only output"
    - "validateIndexPath guards runClean via explicit root+homedir rejection"

key-files:
  created:
    - src/workflows/clean.ts
    - tests/workflows/clean.test.ts
  modified:
    - src/cli/index.ts
    - src/lib/pathValidator.ts
    - .agents/skills/brain-cache/SKILL.md

key-decisions:
  - "validateIndexPath extended to reject / and homedir root — plan expected this behavior but implementation only blocked sensitive subdirs"
  - "SKILL.md clean and watch-mode sections appended (not modified) to preserve existing content"

patterns-established:
  - "Clean workflow outputs to stdout only (no stderr/logging); destructive ops are CLI-only"

requirements-completed: [FEAT-02, FEAT-03]

# Metrics
duration: 12min
completed: 2026-04-07
---

# Phase 59 Plan 02: Clean Command and Watch Mode Documentation Summary

**brain-cache clean CLI command using rm + validateIndexPath, with watch-mode CLI-only rationale documented in SKILL.md**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-04-07T05:35:00Z
- **Completed:** 2026-04-07T05:47:00Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- New `brain-cache clean [path]` command removes `.brain-cache/` with safety validation
- `validateIndexPath` now also blocks `/` and home directory root (previously only blocked sensitive subdirs)
- SKILL.md documents watch mode as CLI-only with rationale, and adds clean command entry
- TDD: 5 tests written (failing), then implementation made them pass (all green)

## Task Commits

Each task was committed atomically:

1. **TDD RED: Failing tests for clean workflow** - `b71db5e` (test)
2. **Task 1: Clean workflow + CLI command implementation** - `b3b9d28` (feat)
3. **Task 2: SKILL.md watch-mode and clean documentation** - `65a2fa6` (docs, main repo)

## Files Created/Modified
- `src/workflows/clean.ts` - runClean workflow function with validateIndexPath + rm
- `tests/workflows/clean.test.ts` - 5 unit tests covering remove, no-op, root rejection, homedir rejection, default path
- `src/cli/index.ts` - Added `.command('clean')` with dynamic import
- `src/lib/pathValidator.ts` - Added root (/) and homedir rejection before existing sensitive-dir checks
- `.agents/skills/brain-cache/SKILL.md` - Appended Watch mode (CLI-only) and clean command sections

## Decisions Made
- Extended `validateIndexPath` with root and homedir guards rather than adding standalone checks in `runClean` — keeps all path safety in one place
- Watch mode docs added to SKILL.md (not a separate file) — keeps agent skill knowledge co-located

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] validateIndexPath did not actually block / and homedir as plan required**
- **Found during:** Task 1 (clean workflow implementation)
- **Issue:** Plan specified "validateIndexPath rejects home directory root, filesystem root" but implementation only blocked specific sensitive subdirectories (`.ssh`, `.aws`, etc.). Tests for root/homedir rejection would fail.
- **Fix:** Added explicit / check and homedir() check at top of `validateIndexPath` before the sensitive-dir loop
- **Files modified:** src/lib/pathValidator.ts
- **Verification:** All 17 existing pathValidator tests still pass; 5 new clean tests pass including root/homedir rejection
- **Committed in:** b3b9d28 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - bug: validateIndexPath incomplete vs plan spec)
**Impact on plan:** Required for correct behavior. No scope creep.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- brain-cache clean command is fully functional and tested
- Watch mode CLI-only decision documented in agent skill
- Ready for Phase 60 (Dependency Upgrades)

---
*Phase: 59-missing-functionality*
*Completed: 2026-04-07*
