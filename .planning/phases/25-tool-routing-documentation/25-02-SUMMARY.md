---
phase: 25-tool-routing-documentation
plan: 02
subsystem: documentation
tags: [claude-md, routing, mcp-tools, testing, vitest]

# Dependency graph
requires:
  - phase: 25-01
    provides: routing table routing table updated with 6 tools and correct NOT-this column values
provides:
  - Negative routing examples ("Do NOT use") in all 4 query-routing tool sections of CLAUDE.md
  - Matching negative examples in claude-md-section.ts template (sync enforced)
  - Test asserting >=4 Do NOT use lines in template
  - Test asserting CLAUDE_MD_SECTION content matches CLAUDE.md section character-for-character
affects: [new-project-init, mcp-tool-routing, claude-instructions]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Content-sync test: extract CLAUDE.md section by heading boundary, compare to template with toBe()"
    - "ESM imports for node:fs/node:path/node:url in vitest test files"

key-files:
  created: []
  modified:
    - src/lib/claude-md-section.ts
    - CLAUDE.md
    - tests/lib/claude-md-section.test.ts

key-decisions:
  - "Moved GSD:workflow-start comment inside GSD section so Brain-Cache section boundary is clean for content-sync test"
  - "Used ESM imports (node:fs, node:path, node:url) in test to match existing test file style"
  - "Do NOT use lines placed immediately after the description/Use-for line in each per-tool section"

patterns-established:
  - "Content-sync pattern: test extracts CLAUDE.md section by heading boundary and compares to exported template string"

requirements-completed: [ROUTE-01]

# Metrics
duration: 3min
completed: 2026-04-03
---

# Phase 25 Plan 02: Tool Routing Documentation Summary

**Negative routing examples added to all 4 per-tool MCP sections; CLAUDE.md and template kept in sync by content-comparison test**

## Performance

- **Duration:** 3 min
- **Started:** 2026-04-03T15:10:00Z
- **Completed:** 2026-04-03T15:12:32Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Added "Do NOT use for..." negative guidance to search_codebase, trace_flow, and explain_codebase sections (build_context already had one)
- Synced CLAUDE.md Brain-Cache MCP Tools section to match claude-md-section.ts template exactly
- Added two new test assertions: count check (>=4 Do NOT use lines) and character-for-character content-sync check

## Task Commits

Each task was committed atomically:

1. **Task 1: Update claude-md-section.ts and CLAUDE.md with negative examples** - `3f397f6` (feat)
2. **Task 2: Add negative-example and content-sync assertions** - `bd2ce00` (test)

**Plan metadata:** (see final commit below)

## Files Created/Modified
- `src/lib/claude-md-section.ts` - Added Do NOT use lines for search_codebase, trace_flow, explain_codebase sections
- `CLAUDE.md` - Matching Do NOT use lines in Brain-Cache MCP Tools section; moved GSD:workflow-start comment inside GSD section
- `tests/lib/claude-md-section.test.ts` - Added ESM imports for fs/path/url; two new test assertions for negative examples and content sync

## Decisions Made
- Moved `<!-- GSD:workflow-start source:GSD defaults -->` comment from before `## GSD Workflow Enforcement` to inside the GSD section. This keeps the heading boundary clean so the content-sync test can extract the Brain-Cache section by finding `\n## ` and get exactly the template content without trailing comment noise.
- Used ESM imports (`node:fs`, `node:path`, `node:url`) in the test file to match the existing ESM import style, rather than `require()` as mentioned in the plan's fallback note.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed content-sync test boundary — GSD comment caused trailing content mismatch**
- **Found during:** Task 2 (adding content-sync assertion)
- **Issue:** `<!-- GSD:workflow-start source:GSD defaults -->` appeared between the Brain-Cache section's last line and the `\n## GSD Workflow Enforcement` heading, causing the extracted section to include the comment while the template did not
- **Fix:** Moved the GSD HTML comment to inside the GSD Workflow Enforcement section (on the line after the heading)
- **Files modified:** CLAUDE.md
- **Verification:** All 10 tests pass including content-sync assertion
- **Committed in:** bd2ce00 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - bug in section boundary extraction)
**Impact on plan:** Minimal — fix was structural (comment relocation), no content change to any section. Enabled the test-as-specced to work correctly.

## Issues Encountered
- vitest initially reported 8 tests when running from `/workspace` (main checkout); the worktree-specific changes were only visible when running from `/workspace/.claude/worktrees/agent-afb68af1`. This is expected worktree behavior.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 25 complete: routing table updated (plan 01) and negative examples added with sync enforcement (plan 02)
- ROUTE-01 requirement satisfied
- CLAUDE_MD_SECTION template now produces full routing guidance including negative examples for new-project init

---
*Phase: 25-tool-routing-documentation*
*Completed: 2026-04-03*
