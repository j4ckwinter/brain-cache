---
phase: 35-skill-packaging
plan: 02
subsystem: docs
tags: [readme, claude-md, documentation, mcp-tools, skill-packaging]

requires:
  - phase: 35-01
    provides: skill directory at .claude/skills/brain-cache/ created by init

provides:
  - README.md rewritten with focused "save money" pitch and 3-tool surface area
  - CLAUDE.md simplified to 3-tool routing table (search_codebase, build_context, index_repo + doctor)
  - Skill install instructions in README referencing .claude/skills/brain-cache/

affects: [documentation, skill-distribution, user-onboarding]

tech-stack:
  added: []
  patterns:
    - "Documentation matches product: 3 tools only, no removed-feature references"
    - "README v1.0 copy style: punchy, developer-focused, no corporate language"

key-files:
  created: []
  modified:
    - README.md
    - CLAUDE.md

key-decisions:
  - "README uses v1.0 copy style: 'GPU finally has a job', 'mortgage payment' — punchy developer tone over marketing language"
  - "CLAUDE.md has dual-table structure (Developer Profile table + Brain-Cache MCP Tools section) — both simplified to 4 rows"
  - "brain-cache watch command removed from CLI list — feature cut in v3.0 reset"
  - "Node.js requirement updated from >=20 to >=22 to match current LTS constraint"

patterns-established:
  - "Documentation-first: README and CLAUDE.md must reflect actual shipped tool surface, not planned features"

requirements-completed: [SKILL-06]

duration: 3min
completed: 2026-04-04
---

# Phase 35 Plan 02: Documentation Cleanup Summary

**README rewritten with v1.0 punchy pitch (3 MCP tools, skill install instructions, mortgage payment copy) and CLAUDE.md simplified to 3-tool routing table removing trace_flow and explain_codebase**

## Performance

- **Duration:** 3 min
- **Started:** 2026-04-04T10:50:57Z
- **Completed:** 2026-04-04T10:53:30Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- README now leads with "Your local GPU finally has a job" and "mortgage payment" — the v1.0 copy that actually sells the value prop
- README lists exactly 3 MCP tools (build_context, search_codebase, index_repo) plus doctor as a diagnostic tool
- README includes new skill installation section referencing `.claude/skills/brain-cache/`
- CLAUDE.md tool routing table reduced from 6 rows to 4 (removed trace_flow and explain_codebase)
- CLAUDE.md's two duplicate tool sections both cleaned up — no more trace_flow or explain_codebase subsections
- Removed all "planned features" status section, "Built with GSD" section, "Why it's different" section from README

## Task Commits

Each task was committed atomically:

1. **Task 1: Rewrite README.md with focused pitch** - `90e1af0` (docs)
2. **Task 2: Simplify CLAUDE.md to 3-tool routing** - `7f4e837` (docs)

## Files Created/Modified

- `README.md` — Rewritten with v1.0 copy style, 3-tool MCP section, skill install instructions, status line mention, removed cut features
- `CLAUDE.md` — Simplified tool routing table (4 rows), removed trace_flow and explain_codebase subsections from both duplicate sections

## Decisions Made

- README uses v1.0 copy style: "GPU finally has a job" and "mortgage payment" — these came from the project's own session notes calling out the v1.0 pitch as correct
- CLAUDE.md has two tool routing areas (one in Developer Profile section, one in Brain-Cache MCP Tools section) — both cleaned up, not just one
- `brain-cache watch` removed from CLI commands list — this feature was cut in the v3.0 reset
- Node.js requirement bumped from `>= 20` to `>= 22` to match the actual tech stack constraint in CLAUDE.md

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Phase 35 plan 02 complete — documentation matches the simplified product
- Both README and CLAUDE.md are consistent with the 3-tool surface area
- Ready for phase 35 completion / skill distribution

---
*Phase: 35-skill-packaging*
*Completed: 2026-04-04*
