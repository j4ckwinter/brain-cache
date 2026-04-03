---
phase: 19-claude.md-refinements
plan: 01
subsystem: docs
tags: [claude-md, mcp, routing, brain-cache, documentation]

# Dependency graph
requires:
  - phase: 17-mcp-tools
    provides: trace_flow and explain_codebase MCP tools registered in src/mcp/index.ts
provides:
  - Updated CLAUDE_MD_SECTION template with 6-tool routing table and cross-references
  - Project CLAUDE.md updated to match v2.0 6-tool routing template
  - Test file validating template completeness for all 6 tools
affects: [all projects using brain-cache init, future CLAUDE.md updates]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Routing table pattern: | Query type | Tool | NOT this | for MCP tool disambiguation"
    - "Cross-reference pattern: 'Use X instead of build_context when...' for explicit redirection"

key-files:
  created:
    - tests/lib/claude-md-section.test.ts
  modified:
    - src/lib/claude-md-section.ts
    - CLAUDE.md

key-decisions:
  - "CLAUDE_MD_SECTION heading must remain exactly '## Brain-Cache MCP Tools' for idempotency — init.ts uses content.includes() check"
  - "Routing table uses NOT-this column to make tool disambiguation explicit and unambiguous"
  - "build_context trigger list explicitly excludes architecture/flow queries, redirecting each to the correct specialized tool"

patterns-established:
  - "TDD for template string content: import the constant and assert .toContain() for each tool name"

requirements-completed: [ADOPT-01]

# Metrics
duration: 12min
completed: 2026-04-03
---

# Phase 19 Plan 01: CLAUDE.md Routing Refinements Summary

**6-tool routing table added to CLAUDE_MD_SECTION template and project CLAUDE.md, with explicit cross-references steering trace/architecture queries away from build_context to trace_flow and explain_codebase**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-04-03T22:05:00Z
- **Completed:** 2026-04-03T22:07:00Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Rewrote CLAUDE_MD_SECTION template to cover all 6 v2.0 MCP tools with routing table and per-tool sections
- Added explicit cross-references: "Use trace_flow instead of build_context" and "Use explain_codebase instead of build_context"
- Replaced project CLAUDE.md Brain-Cache MCP Tools section with parity content matching the updated template
- Created tests/lib/claude-md-section.test.ts with 8 assertions validating all 6 tool names and cross-reference text
- All GSD marker blocks in CLAUDE.md left unchanged; idempotency heading preserved

## Task Commits

Each task was committed atomically:

1. **Task 1: Create template unit test and update CLAUDE_MD_SECTION template** - `33ccea2` (feat + test, TDD)
2. **Task 2: Update project CLAUDE.md routing section to match v2.0 template** - `ad6344c` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified
- `src/lib/claude-md-section.ts` - Rewritten with 6-tool routing table, per-tool sections, explicit cross-references
- `tests/lib/claude-md-section.test.ts` - 8 assertions: 6 tool names, idempotency heading, cross-reference text
- `CLAUDE.md` - Brain-Cache MCP Tools section replaced with v2.0 6-tool routing content

## Decisions Made
- CLAUDE_MD_SECTION heading kept exactly as `## Brain-Cache MCP Tools` — init.ts idempotency check uses `content.includes('## Brain-Cache MCP Tools')`, changing this would cause double-appends on existing projects
- Routing table uses NOT-this column so Claude knows which tool NOT to use for each query type
- build_context trigger list narrowed to specific-behavior questions only; architecture and flow queries explicitly redirected

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 19 Plan 01 complete
- Plan 02 can proceed (if any)
- All 6 MCP tools now documented with routing guidance in both the template (for new projects) and the project CLAUDE.md (for this project)

---
*Phase: 19-claude.md-refinements*
*Completed: 2026-04-03*
