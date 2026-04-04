---
phase: 32-init-integration
plan: 01
subsystem: cli
tags: [init, statusline, settings.json, idempotent, nodejs, typescript]

# Dependency graph
requires:
  - phase: 31-status-line-rendering
    provides: statusline.mjs script that is installed by this plan
provides:
  - STATUSLINE_SCRIPT_CONTENT string constant in src/lib/statusline-script.ts
  - brain-cache init Step 12: install ~/.brain-cache/statusline.mjs with chmod 755
  - brain-cache init Step 13: merge statusLine entry into ~/.claude/settings.json
  - 8 new unit tests covering statusline install and settings.json merge edge cases
affects: [init-integration, v2.4-milestone]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Embed file content as TypeScript string constant (escape backticks + template literals)"
    - "Read-parse-merge-write pattern for JSON config files with idempotency guard"
    - "Try/catch around optional config step: warn and continue, never crash init"

key-files:
  created:
    - src/lib/statusline-script.ts
    - .planning/phases/32-init-integration/32-01-SUMMARY.md
  modified:
    - src/workflows/init.ts
    - tests/workflows/init.test.ts

key-decisions:
  - "Use tilde notation in command path ('~/.brain-cache/statusline.mjs') — Claude Code expands ~ at runtime, not hardcoded absolute path"
  - "Warn and skip on custom statusline.mjs content — preserve user changes, never overwrite"
  - "Try/catch wraps entire settings.json block — invalid JSON or FS errors warn to stderr, init continues"
  - "STATUSLINE_SCRIPT_CONTENT embedded as template literal with escaped backticks — not a runtime import"

patterns-established:
  - "Idempotency pattern: check existing content === expected content, skip if identical, warn if different"
  - "JSON config merge pattern: read-parse-add key-write, skipping if key already present"

requirements-completed: [STAT-05, STAT-06]

# Metrics
duration: 4min
completed: 2026-04-04
---

# Phase 32 Plan 01: Init Integration Summary

**brain-cache init now auto-installs statusline.mjs and configures ~/.claude/settings.json with a statusLine command entry, completing the v2.4 Status Line milestone installation flow**

## Performance

- **Duration:** 4 min
- **Started:** 2026-04-04T04:19:35Z
- **Completed:** 2026-04-04T04:23:30Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Created `src/lib/statusline-script.ts` embedding the full verbatim content of `statusline.mjs` as an exported TypeScript string constant with proper template literal escaping
- Added Step 12 to `init.ts`: installs `~/.brain-cache/statusline.mjs` with chmod 755, idempotent (skip identical, warn custom)
- Added Step 13 to `init.ts`: merges `statusLine` entry into `~/.claude/settings.json`, safe merge preserving all existing keys, try/catch on JSON errors
- Extended test suite from 35 to 43 tests in `init.test.ts`: 3 statusline installation tests + 5 settings.json management tests (idempotency, merge, invalid JSON, tilde path)
- Full test suite passes: 597 tests across 29 test files

## Task Commits

Each task was committed atomically:

1. **Task 1: Create statusline-script.ts string constant** - `2289ba8` (feat)
2. **Task 2: Add statusline install and settings.json merge steps** - `a8e7da5` (feat)

_Note: Task 2 was TDD — tests written first (RED), implementation added (GREEN), full suite verified_

## Files Created/Modified

- `src/lib/statusline-script.ts` - STATUSLINE_SCRIPT_CONTENT string constant with verbatim statusline.mjs content, backticks escaped
- `src/workflows/init.ts` - Added Steps 12 and 13: statusline install + settings.json merge
- `tests/workflows/init.test.ts` - 8 new tests for statusline installation and settings.json management, existing tests updated to handle new paths idempotently

## Decisions Made

- Tilde notation (`~/.brain-cache/statusline.mjs`) in the command string: Claude Code expands `~` at runtime, so absolute paths would hardcode the install user's home directory
- Warn-and-skip for custom statusline.mjs: preserves user modifications without silently overwriting
- Try/catch wraps the entire settings.json block: if `~/.claude/` doesn't exist or JSON is invalid, init warns but does not throw — status line is a convenience, not a hard requirement
- STATUSLINE_SCRIPT_CONTENT uses template literal embedding with escaped `\`` and `\${...}` sequences — no runtime FS reads, no import-time side effects

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None - TDD cycle was clean: RED (8 failures), GREEN (43 passing), full suite (597 passing).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- v2.4 Status Line milestone is complete: stats accumulation (Phase 30), statusline rendering (Phase 31), init integration (Phase 32)
- STAT-05 and STAT-06 are now validated
- `brain-cache init` is now the single install command that sets up GPU profiling, Ollama, embeddings, MCP server, CLAUDE.md, and status line

## Self-Check: PASSED

- src/lib/statusline-script.ts: FOUND
- src/workflows/init.ts: FOUND
- tests/workflows/init.test.ts: FOUND
- 32-01-SUMMARY.md: FOUND
- Commit 2289ba8: FOUND
- Commit a8e7da5: FOUND

---
*Phase: 32-init-integration*
*Completed: 2026-04-04*
