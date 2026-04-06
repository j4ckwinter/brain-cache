---
phase: 43-correctness-and-security
plan: 02
subsystem: security
tags: [path-validation, token-savings, mcp, security, correctness]

# Dependency graph
requires: []
provides:
  - Path traversal protection in all 4 MCP tool handlers via resolve-then-blocklist
  - validateIndexPath utility with SENSITIVE_DIRS blocklist (/etc, /var, ~/.ssh, ~/.aws, ~/.gnupg, ~/.config)
  - computeTokenSavings utility replacing tokensSent * 3 magic multiplier
  - Token savings computation reads actual file content matching buildContext.ts canonical pattern
affects: [mcp-handlers, token-savings, search-results, security]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - resolve-then-blocklist path validation (resolve first, then check against SENSITIVE_DIRS)
    - precomputed savings pattern (compute once, pass to both stats and response formatter)
    - shared savings utility (computeTokenSavings mirrors buildContext.ts canonical pattern)

key-files:
  created:
    - src/lib/pathValidator.ts
    - src/lib/tokenSavings.ts
    - tests/lib/pathValidator.test.ts
    - tests/lib/tokenSavings.test.ts
  modified:
    - src/mcp/index.ts
    - tests/mcp/server.test.ts

key-decisions:
  - "resolve-then-blocklist for path validation (not cwd-anchoring) — MCP servers spawn from Claude Code cwd, not user project root"
  - "validateIndexPath inside try/catch blocks so errors return isError envelope, not unhandled exceptions"
  - "precomputed savings passed to buildSearchResponse to avoid double computeTokenSavings call per request"
  - "leave buildContext.ts as-is (already correct) — unification scope is search handler only per plan"

patterns-established:
  - "Path validation: resolve path first, then check startsWith(sensitive + '/') for prefix matching"
  - "Token savings: compute once per request, pass precomputed result to both stats accumulator and response formatter"

requirements-completed: [COR-02, COR-04]

# Metrics
duration: 5min
completed: 2026-04-06
---

# Phase 43 Plan 02: Correctness and Security (Path + Token Savings) Summary

**MCP path traversal protection via resolve-then-blocklist (COR-02) and real file-content token savings replacing magic multiplier (COR-04)**

## Performance

- **Duration:** 5 min
- **Started:** 2026-04-06T07:43:28Z
- **Completed:** 2026-04-06T07:48:15Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments

- Created `src/lib/pathValidator.ts` with `validateIndexPath` that blocks /etc, /var, ~/.ssh, ~/.aws, ~/.gnupg, ~/.config — resolve-first catches traversal attacks like `../../etc/passwd`
- Wired `validateIndexPath` into all 4 MCP tool handlers (index_repo, search_codebase, build_context, doctor) inside existing try/catch blocks so errors return `isError: true` envelope
- Created `src/lib/tokenSavings.ts` with `computeTokenSavings` matching buildContext.ts canonical pattern — reads actual source files, computes real token counts, no magic multipliers
- Removed all 3 instances of `tokensSent * 3` from mcp/index.ts
- 456 total tests pass (17 pathValidator + 5 tokenSavings + 1 new server test + all existing)

## Task Commits

Each task was committed atomically:

1. **Task 1: Path validation blocklist for MCP tools (COR-02)** - `bfc9bc1` (feat)
2. **Task 2: Unified token savings computation replacing magic multiplier (COR-04)** - `a537510` (feat)

**Plan metadata:** _(pending)_

_Note: TDD tasks had test-then-implement pattern (RED then GREEN). No separate REFACTOR commits needed._

## Files Created/Modified

- `src/lib/pathValidator.ts` - validateIndexPath with SENSITIVE_DIRS blocklist; resolve-then-prefix-check
- `src/lib/tokenSavings.ts` - computeTokenSavings async utility; reads real file content via readFile
- `src/mcp/index.ts` - validateIndexPath in all 4 handlers; buildSearchResponse now async with precomputed savings; 3x tokensSent*3 removed
- `tests/lib/pathValidator.test.ts` - 17 tests covering all sensitive dirs, normal paths, traversal attacks
- `tests/lib/tokenSavings.test.ts` - 5 tests covering 2-file, 0-chunk, missing file, dedup, clamp-at-0 cases
- `tests/mcp/server.test.ts` - Added sensitive path rejection test for search_codebase handler

## Decisions Made

- **resolve-then-blocklist (not cwd-anchor):** MCP servers spawn from Claude Code's cwd, not user project root, so cwd-anchoring would be wrong. Resolving first handles relative traversal.
- **validateIndexPath inside try/catch:** Errors from path validation must return `isError: true` envelope to caller — not propagate as unhandled exceptions. Kept inside existing try block.
- **precomputed savings:** `computeTokenSavings` called once per search request; result passed to both `accumulateStats` and `buildSearchResponse(chunks, query, savings)` to avoid double I/O.
- **Leave buildContext.ts as-is:** It already computes savings correctly with the canonical pattern. Unifying it is REFAC-03 scope (Phase 47 per plan note).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] validateIndexPath placed outside try/catch in search handler**
- **Found during:** Task 1 (path validation integration)
- **Issue:** Initial placement put `resolvedPath` and `validateIndexPath` outside the try block. The search handler's catch block checked for "No index found" — but a validation error from outside try would throw unhandled, causing the test to fail with an uncaught error instead of `isError: true`
- **Fix:** Moved `resolvedPath = resolve(...)` to just before try block (hoisted for catch scope), moved `validateIndexPath(resolvedPath)` inside the try block as first statement
- **Files modified:** src/mcp/index.ts
- **Verification:** Test "returns isError when path points to a sensitive system directory" passes
- **Committed in:** bfc9bc1 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - Bug)
**Impact on plan:** Essential fix for correct error envelope behavior. No scope creep.

## Issues Encountered

None — aside from the auto-fixed deviation above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- COR-02 (path traversal protection) complete — all 4 MCP handlers protected
- COR-04 (token savings unification) complete — magic multiplier eliminated
- Zero regressions in full 456-test suite
- Phase 43-03 or remaining correctness items can proceed

## Self-Check: PASSED

All files exist and commits verified: bfc9bc1, a537510

---
*Phase: 43-correctness-and-security*
*Completed: 2026-04-06*
