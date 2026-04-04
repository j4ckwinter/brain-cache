---
phase: 35-skill-packaging
plan: 03
subsystem: infra
tags: [npm-packaging, skill, init, mcp, claude-code]

# Dependency graph
requires:
  - phase: 35-01
    provides: .claude/skills/brain-cache/SKILL.md with tool routing guidance
  - phase: 35-02
    provides: README and CLAUDE.md updated for 3-tool surface area
provides:
  - brain-cache init copies SKILL.md from package root to user's project .claude/skills/brain-cache/
  - npm package ships .claude/skills/ directory so skill is available globally after install
  - .gitignore updated to allow .claude/skills/ tracking while excluding .claude/settings.local.json
affects: [35-packaging, npm-publish]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "ESM module resolution: fileURLToPath(import.meta.url) + dirname() to find package root at runtime"
    - "Idempotent skill install: skip if target exists, warn if source missing"
    - "Selective .claude/ packaging: use .claude/skills/ in files array, not .claude/"

key-files:
  created:
    - .claude/skills/brain-cache/SKILL.md
  modified:
    - src/workflows/init.ts
    - package.json
    - README.md
    - .gitignore

key-decisions:
  - "Use .claude/skills/ (not .claude/) in package.json files array to avoid shipping settings.local.json"
  - "Skill install step uses copyFileSync for atomic single-file copy from package root to user project"
  - "Fallback warning if skill source not found in package — graceful degradation, does not throw"

patterns-established:
  - "Package root resolution: fileURLToPath(import.meta.url) + dirname + join('..', '..')"
  - "Idempotent file install: check target first, check source second, create dir + copy"

requirements-completed: [SKILL-05, SKILL-06]

# Metrics
duration: 8min
completed: 2026-04-04
---

# Phase 35 Plan 03: Skill Packaging Gap Closure Summary

**init.ts installs SKILL.md to user project via ESM package-root resolution; npm package ships .claude/skills/ with SKILL.md included**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-04-04T11:09:00Z
- **Completed:** 2026-04-04T11:16:57Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- brain-cache init now copies SKILL.md from the installed package to the user's `.claude/skills/brain-cache/SKILL.md` (idempotent with skip message if already present, warning if source missing)
- npm package now includes `.claude/skills/brain-cache/SKILL.md` via `files` array entry `.claude/skills/`
- `.gitignore` updated to allow `.claude/skills/` to be tracked while keeping `.claude/*` otherwise ignored
- README updated to accurately describe that `brain-cache init` installs the skill

## Task Commits

Each task was committed atomically:

1. **Task 1: Add installSkill step to init.ts and fix README** - `cb1e912` (feat)
2. **Task 2: Add .claude/skills/ to package.json files array** - `4d72420` (feat)

**Plan metadata:** (docs commit created after this summary)

## Files Created/Modified
- `src/workflows/init.ts` - Added Step 11b: idempotent skill install with ESM package-root resolution
- `.claude/skills/brain-cache/SKILL.md` - Skill file shipped with npm package and copied to user projects
- `package.json` - Added `.claude/skills/` to files array
- `README.md` - Updated init description to mention skill install
- `.gitignore` - Changed `.claude/` to `.claude/*` + `!.claude/skills/` to allow skill tracking

## Decisions Made
- Used `.claude/skills/` instead of `.claude/` in files array — avoids shipping `settings.local.json` (private local file) in the npm package. More precise targeting with identical functional outcome.
- Used `copyFileSync` from existing `node:fs` imports rather than read+write — atomic, idiomatic
- SKILL.md content matches the canonical version at `/workspace/.claude/skills/brain-cache/SKILL.md`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Used .claude/skills/ instead of .claude/ in files array**
- **Found during:** Task 2 (package.json files array)
- **Issue:** Plan specified `".claude/"` but this would include `.claude/settings.local.json` (local dev-only settings) in the published npm package
- **Fix:** Used `.claude/skills/` instead — ships only the skills directory, excludes private settings
- **Files modified:** package.json
- **Verification:** `npm pack --dry-run` confirms SKILL.md included, settings.local.json excluded
- **Committed in:** 4d72420 (Task 2 commit)

**2. [Rule 3 - Blocking] Updated .gitignore to allow .claude/skills/ tracking**
- **Found during:** Task 1 (staging .claude/skills/brain-cache/SKILL.md)
- **Issue:** `.gitignore` had `.claude/` which blocked staging SKILL.md
- **Fix:** Changed to `.claude/*` + `!.claude/skills/` (same pattern used by 35-01 commit on other branches)
- **Files modified:** .gitignore
- **Verification:** `git add .claude/skills/brain-cache/SKILL.md` succeeded
- **Committed in:** cb1e912 (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (1 missing critical, 1 blocking)
**Impact on plan:** Both auto-fixes necessary for correctness. No scope creep.

## Issues Encountered
- The 35-01 SKILL.md creation commit was on `master` and other branches but had not been merged into this worktree branch — created SKILL.md fresh from the canonical content at `/workspace/.claude/skills/brain-cache/SKILL.md`

## Known Stubs

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Phase 35 gap closure complete: skill install wired in init.ts, npm package ships .claude/skills/
- Users who run `npm install -g brain-cache && brain-cache init` now get SKILL.md automatically
- Phase 35 verification can be re-run — both verification gaps are now closed

---
*Phase: 35-skill-packaging*
*Completed: 2026-04-04*

## Self-Check: PASSED

- FOUND: `/workspace/.claude/worktrees/agent-a06b2f9a/.claude/skills/brain-cache/SKILL.md`
- FOUND: `/workspace/.planning/phases/35-skill-packaging/35-03-SUMMARY.md`
- FOUND: commit `cb1e912` (Task 1 — installSkill step in init.ts)
- FOUND: commit `4d72420` (Task 2 — .claude/skills/ in package.json files)
