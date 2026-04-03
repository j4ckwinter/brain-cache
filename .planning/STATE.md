---
gsd_state_version: 1.0
milestone: v2.2
milestone_name: Retrieval Quality
status: executing
stopped_at: Completed 22-01-PLAN.md
last_updated: "2026-04-03T12:27:18.407Z"
last_activity: 2026-04-03
progress:
  total_phases: 11
  completed_phases: 7
  total_plans: 18
  completed_plans: 17
  percent: 0
---

# Project State: Brain-Cache

**Last updated:** 2026-04-03
**Updated by:** roadmapper (v2.2 roadmap created)

---

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-03)

**Core value:** Reduce Claude token usage and improve response quality by running embeddings, retrieval, and context building locally — Claude only sees what matters.
**Current focus:** Phase 22 — isolated-trace-fixes

---

## Current Position

Phase: 22 (isolated-trace-fixes) — EXECUTING
Plan: 2 of 2
Status: Ready to execute
Last activity: 2026-04-03

Progress: [░░░░░░░░░░] 0%

---

## Accumulated Context

### Active Blockers

None.

### Key Decisions (Phase 22, Plan 01 — callsFound dedup)

- Set spread ([...new Set(callEdges.map(e => e.to_symbol))]) dedups callsFound at the map site; no type changes to FlowHop
- Dedup is a display concern, not a query concern — edges table source of truth is left unchanged

### Key Decisions (v2.2 Roadmap)

- Phase 22 ships first: OUT-01 (callsFound dedup) and RET-03 (exact-name SQL lookup) are single-file isolated fixes — lowest risk
- Phase 23 is independent of Phase 24: NOISE-01 penalty is additive to retriever.ts scoring, no callers change
- Phase 24 ships RET-01 + RET-02 + OUT-02 together: all three touch traceFlow.ts or buildContext.ts; splitting forces double-edits
- Phase 25 ships last: ROUTE-01 documentation must reflect behavior actually delivered by Phases 22-24, not intended behavior
- Name-match protection (RET-02) must raise chunk.similarity score into the existing 0.85 threshold — do NOT add a new bypass code path
- KEYWORD_BOOST_WEIGHT target is 0.40 as starting point; validate against all five debug session queries before committing
- Token savings computation moves to workflow layer (traceFlow.ts), not MCP handler — follows buildContext.ts pattern
- MCP description changes must be tested before CLAUDE.md changes to enable regression attribution

### Key Decisions (Prior milestones)

- Phase 21: 6 MCP handlers wired to formatters; token savings footer and pipeline labels live
- Phase 20: 9 pure-function formatters in src/lib/format.ts; no ANSI; dedent 1.7.2
- Phase 19: 6-tool routing table added to CLAUDE_MD_SECTION and project CLAUDE.md
- Phase 17: trace_flow and explain_codebase MCP tools registered; buildContext routes by intent
- Phase 16: Three-mode intent classifier (lookup/trace/explore) with RETRIEVAL_STRATEGIES
- Phase 15: LanceDB edges table, .braincacheignore, write mutex, chunker returns { chunks, edges }

### Session Notes

v2.2 Retrieval Quality roadmap defined: 4 phases (22-25), 7 requirements, 100% mapped.
Phase 22: OUT-01 + RET-03 (isolated single-file fixes, flowTracer.ts and traceFlow.ts)
Phase 23: NOISE-01 (additive score penalty in retriever.ts, independent)
Phase 24: RET-01 + RET-02 + OUT-02 (cross-cutting, compression.ts + retriever.ts + buildContext.ts + traceFlow.ts + mcp/index.ts)
Phase 25: ROUTE-01 (documentation only, CLAUDE.md + mcp/index.ts description strings)

---

## Session Continuity

**Last session:** 2026-04-03T12:27:18.402Z

**Stopped at:** Completed 22-01-PLAN.md

**Next action:** Plan Phase 22 — `/gsd:plan-phase 22`

---
*State initialized: 2026-03-31*
