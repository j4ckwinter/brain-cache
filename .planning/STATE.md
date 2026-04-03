---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: executing
stopped_at: Completed 20-02-PLAN.md
last_updated: "2026-04-03T08:57:08.306Z"
last_activity: 2026-04-03
progress:
  total_phases: 7
  completed_phases: 5
  total_plans: 14
  completed_plans: 13
  percent: 0
---

# Project State: Brain-Cache

**Last updated:** 2026-04-03
**Updated by:** roadmapper (v2.1 roadmap created)

---

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-03)

**Core value:** Reduce Claude token usage and improve response quality by running embeddings, retrieval, and context building locally — Claude only sees what matters.
**Current focus:** Phase 20 — Formatter Foundation

---

## Current Position

Phase: 20 (Formatter Foundation) — EXECUTING
Plan: 2 of 2
Status: Ready to execute
Last activity: 2026-04-03

Progress: [█████████░] 93% (13/14 plans complete)

---

## Accumulated Context

### Active Blockers

None.

### Key Decisions (Phase 20, Plan 02 — result-list formatters)

- Use parentheses `(function)` for chunkType in formatSearchResults — plan spec showed `[function]` but behavior spec requires no JSON brackets; parentheses resolve the conflict
- formatContext is intentional passthrough returning ContextResult.content as-is — token savings footer deferred to Phase 21 (META-01 scope)
- formatTraceFlow zero-hop message explicitly references index_repo to guide user recovery
- depth displayed as `depth:N` prefix (not `[depth N]`) to avoid square brackets violating no-JSON-output constraint

### Key Decisions (v2.1 Roadmap — from research)

- Formatter layer is pure functions in `src/lib/format.ts` only — no workflow or service changes
- `src/mcp/index.ts` is the only other file that changes — replaces 6 `JSON.stringify()` calls with formatter calls
- No ANSI escape codes in any formatter — MCP text content is consumed by Claude, not displayed in a terminal; ANSI inflates token count by 50-80%
- No markdown tables — pipe characters render as raw `|---|---|` in MCP tool panels
- Token savings footer belongs only on `build_context` and `explain_codebase` for retrieval tools; META-01 scopes it to all 4 retrieval tools (search_codebase, build_context, trace_flow, explain_codebase)
- Pipeline labels (META-03) appear on the same 4 retrieval tools as the savings footer
- Zero-result responses must be a single clean sentence — not an empty structured frame
- `dedent` 1.7.2 is the only new npm dependency (tagged template literal dedenting for clean formatter source)
- Phase 20 is a hard dependency for Phase 21 — handlers cannot call formatters that do not exist
- `formatTokenSavings` must be redesigned in Phase 20 to eliminate `padEnd(27)` column alignment before any handler calls it

### Key Decisions (Prior milestones)

- Phase 19: 6-tool routing table added to CLAUDE_MD_SECTION and project CLAUDE.md
- Phase 17: trace_flow and explain_codebase MCP tools registered; buildContext routes by intent
- Phase 16: Three-mode intent classifier (lookup/trace/explore) with RETRIEVAL_STRATEGIES
- Phase 15: LanceDB edges table, .braincacheignore, write mutex, chunker returns { chunks, edges }
- Phase 14: Reverted DEFAULT_DISTANCE_THRESHOLD to 0.3; tree-sitter chunker test excluded via vitest.config.ts
- Phase 13: MCP tool descriptions rewritten with directive tone and explicit cross-references

### Session Notes

v2.1 Presentation Magic roadmap defined: 2 phases (20-21), 9 requirements, all mapped.
Phase ordering: 20 (pure formatter functions, no MCP behavior change) → 21 (wire handlers, behavior visible to Claude).
Phase 20 is a hard dependency for Phase 21.
Only 2 files change across the entire milestone: src/lib/format.ts and src/mcp/index.ts.
No workflow, service, or CLI changes — presentation layer only.

### Quick Tasks Completed

See prior STATE.md entries for v1.x and v2.0 quick tasks (archived).

---

## Session Continuity

**Last session:** 2026-04-03T08:57:08.302Z

**Stopped at:** Completed 20-02-PLAN.md

**Next action:** `/gsd:execute-phase 21`

---
*State initialized: 2026-03-31*
