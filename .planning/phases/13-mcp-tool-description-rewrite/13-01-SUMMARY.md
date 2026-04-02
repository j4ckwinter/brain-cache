---
phase: 13-mcp-tool-description-rewrite
plan: 01
subsystem: mcp
tags: [mcp, tool-descriptions, claude-steering, semantic-search]

# Dependency graph
requires:
  - phase: 12-integration-gap-cleanup
    provides: Working MCP server with 4 registered tools (index_repo, search_codebase, build_context, doctor)
provides:
  - Directive MCP tool descriptions that steer Claude toward brain-cache tools over built-in file search
  - Prerequisite signaling between index_repo, search_codebase, and build_context
  - Cross-references between search_codebase and build_context for query-type differentiation
  - Doctor proactive troubleshooting trigger ("Run this first when any brain-cache tool fails")
affects: [phase-14, future-mcp-phases]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Directive tool descriptions: tell Claude when/why to use each tool, not just what it does"
    - "Cross-referencing descriptions: tools point to each other for query-type routing"
    - "Prerequisite signaling: upstream tools declare themselves as requirements"

key-files:
  created: []
  modified:
    - src/mcp/index.ts

key-decisions:
  - "Directive tone over neutral/factual — descriptions explicitly steer Claude with 'use this instead of grep' and 'Requires: index_repo must have been run first'"
  - "Cross-references implemented: search_codebase points to build_context for deeper questions; build_context points to search_codebase for simple lookups"
  - "Advantages named without naming specific built-in tools — 'instead of grep or file-find' not 'instead of the Grep tool'"

patterns-established:
  - "Tool descriptions use directive tone with explicit when-to-use guidance"
  - "Prerequisite tools declare themselves in dependent tool descriptions"

requirements-completed: [DESC-01, DESC-02, DESC-03, DESC-04, POS-01, POS-02, ROLE-01, ROLE-02]

# Metrics
duration: 8min
completed: 2026-04-02
---

# Phase 13 Plan 01: MCP Tool Description Rewrite Summary

**Four MCP tool descriptions rewritten with directive tone, cross-references, prerequisite signaling, and advantage positioning to steer Claude toward brain-cache over built-in file search.**

## Performance

- **Duration:** 8 min
- **Started:** 2026-04-02T03:06:08Z
- **Completed:** 2026-04-02T03:07:31Z
- **Tasks:** 2 (1 code change, 1 verification)
- **Files modified:** 1

## Accomplishments
- Rewrote all 4 MCP tool descriptions with directive tone (D-01) and 2-3 sentence structure (D-02)
- index_repo now declares itself as prerequisite: "Must be run before search_codebase or build_context will work"
- search_codebase positions for finding WHERE code lives with semantic advantage: "by meaning, not just keyword match — use this instead of grep or file-find"
- build_context positions for HOW/WHY questions with token efficiency: "more efficient than reading multiple files individually"
- doctor uses proactive troubleshooting trigger: "Run this first when any brain-cache tool fails or returns unexpected results"
- All 17 MCP server tests pass; build succeeds

## Task Commits

Each task was committed atomically:

1. **Task 1: Rewrite all four MCP tool description strings** - `c8cb755` (feat)
2. **Task 2: Verify tests still pass and build succeeds** - no code changes, verification only

**Plan metadata:** (docs commit follows)

## Files Created/Modified
- `src/mcp/index.ts` - Updated description strings for all 4 registered tools (index_repo, search_codebase, build_context, doctor)

## Decisions Made
- Crafted descriptions to satisfy all 8 requirements (DESC-01 through DESC-04, POS-01, POS-02, ROLE-01, ROLE-02) as single string literals
- Preserved exact wording "instead of grep" per PLAN.md acceptance criteria while using "or file-find" to cover broader built-in tools
- No handler logic, input schemas, or error messages were modified

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None - description changes are pure string replacements; all 17 tests passed without modification.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 13 complete — all 8 requirements satisfied
- MCP tool descriptions now actively steer Claude toward brain-cache tools
- No blockers for subsequent work

---
*Phase: 13-mcp-tool-description-rewrite*
*Completed: 2026-04-02*
