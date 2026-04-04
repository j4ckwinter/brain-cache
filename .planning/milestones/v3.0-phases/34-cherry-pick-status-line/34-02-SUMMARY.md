---
phase: 34-cherry-pick-status-line
plan: 02
subsystem: mcp, workflows
tags: [accumulateStats, sessionStats, statusline, init, mcp-handlers, settings.json]

# Dependency graph
requires:
  - phase: 34-01
    provides: sessionStats service (accumulateStats) + statusline-script.ts (STATUSLINE_SCRIPT_CONTENT)
provides:
  - MCP handlers (search_codebase, build_context) fire-and-forget accumulateStats after each call
  - brain-cache init installs statusline.mjs to ~/.brain-cache/ with chmod 755
  - brain-cache init merges statusLine entry into ~/.claude/settings.json (idempotent)
affects:
  - 35-skill-packaging (status line fully wired — skill can reference init command)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Static top-level import for embedded script content (vs dynamic import) — avoids esbuild bundling issues"
    - "Unicode escape \\u0060 for backtick in embedded template content — esbuild template-literal parse compatibility fix"
    - "Fire-and-forget accumulateStats after MCP handler computes results — no await, errors swallowed by service"

key-files:
  created: []
  modified:
    - src/mcp/index.ts
    - src/workflows/init.ts
    - src/lib/statusline-script.ts

key-decisions:
  - "Used static import (not dynamic await import) for STATUSLINE_SCRIPT_CONTENT — dynamic import caused esbuild to bundle statusline-script.ts which it could not parse due to escaped backticks in template literal"
  - "Replaced escaped backticks (\\`) with unicode escapes (\\u0060) in statusline-script.ts — esbuild treats \\` as template literal terminator, \\u0060 is the correct workaround for embedded script content"

patterns-established:
  - "accumulateStats wiring: fire-and-forget after results computed, before return — no await, no try/catch"
  - "init idempotency: check file content equality before skipping, warn on custom content, merge not replace"

requirements-completed: [SKILL-03, SKILL-04]

# Metrics
duration: 4min
completed: 2026-04-04
---

# Phase 34 Plan 02: Wire accumulateStats and Status Line Init Summary

**MCP handlers accumulate token savings via fire-and-forget accumulateStats, and brain-cache init deploys statusline.mjs + configures ~/.claude/settings.json, with esbuild compatibility fix for embedded backtick content**

## Performance

- **Duration:** 4 min
- **Started:** 2026-04-04T10:31:21Z
- **Completed:** 2026-04-04T10:35:03Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Wired accumulateStats (fire-and-forget) into search_codebase and build_context MCP handlers
- Added STATUSLINE_SCRIPT_CONTENT static import to init.ts workflow
- Implemented idempotent statusline.mjs installation to ~/.brain-cache/ with chmod 755
- Implemented idempotent statusLine merge into ~/.claude/settings.json with warning on existing entry
- Fixed esbuild template-literal parse bug in statusline-script.ts (escaped backticks → unicode escapes)
- All 259 tests pass, npm run build succeeds

## Task Commits

Each task was committed atomically:

1. **Task 1: Wire accumulateStats into MCP handlers** - `985f304` (feat)
2. **Task 2: Add status line installation to init workflow** - `1ff3708` (feat)

## Files Created/Modified

- `src/mcp/index.ts` - Added accumulateStats import + fire-and-forget calls in search_codebase and build_context handlers
- `src/workflows/init.ts` - Added fs/path/os imports, STATUSLINE_SCRIPT_CONTENT import, statusline install step (Step 9), settings.json merge step (Step 10)
- `src/lib/statusline-script.ts` - Fixed escaped backticks → unicode escapes (\u0060) for esbuild compatibility

## Decisions Made

- Used static import for STATUSLINE_SCRIPT_CONTENT (vs plan's `await import(...)`) — dynamic import caused tsup/esbuild to include statusline-script.ts in the bundle, where the escaped backtick syntax (`\``) caused an "Unterminated string literal" parse error. Static import has the same runtime effect and triggers the same bundling, so the fix was in the source file itself.
- Replaced `\`` with `\u0060` in statusline-script.ts — this is the minimal, semantically-identical fix. Runtime output of the embedded script is byte-identical: `\u0060` is the Unicode escape for backtick (U+0060), producing the same character in the deployed statusline.mjs file.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed esbuild template-literal parse error in statusline-script.ts**
- **Found during:** Task 2 (when init.ts imported statusline-script.ts, bringing it into the bundle)
- **Issue:** `statusline-script.ts` used `\`` (escaped backtick) inside a template literal to embed backtick characters in the script content. esbuild (via tsup) incorrectly treated `\`` as a template literal terminator, producing "Unterminated string literal at line 92". The file was not previously in the bundle's import chain, so the bug was latent.
- **Fix:** Replaced all inner `\`` with `\u0060` (Unicode escape for U+0060, backtick). Runtime output is byte-identical — `\u0060` produces the same character. The fix also updates the comment to document the encoding choice.
- **Files modified:** `src/lib/statusline-script.ts`
- **Commit:** `1ff3708`

**2. [Rule 3 - Blocking] Changed dynamic import to static import for STATUSLINE_SCRIPT_CONTENT**
- **Found during:** Task 2
- **Issue:** Plan specified `await import('../lib/statusline-script.js')` (dynamic import). Both static and dynamic imports cause tsup to bundle the file — the fix was needed regardless of import style. Switched to static import for simplicity and conventional style (no functional difference given tsup bundles both).
- **Fix:** Added `import { STATUSLINE_SCRIPT_CONTENT } from '../lib/statusline-script.js';` at top of init.ts.
- **Files modified:** `src/workflows/init.ts`
- **Commit:** `1ff3708`

## Known Stubs

None — all implemented features are fully wired with real data.

---
*Phase: 34-cherry-pick-status-line*
*Completed: 2026-04-04*

## Self-Check: PASSED

- FOUND: src/mcp/index.ts
- FOUND: src/workflows/init.ts
- FOUND: src/lib/statusline-script.ts
- FOUND: .planning/phases/34-cherry-pick-status-line/34-02-SUMMARY.md
- FOUND commit: 985f304
- FOUND commit: 1ff3708
