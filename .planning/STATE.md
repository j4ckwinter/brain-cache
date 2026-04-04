---
gsd_state_version: 1.0
milestone: v2.4
milestone_name: Status Line
status: executing
stopped_at: Completed 31-01-PLAN.md
last_updated: "2026-04-04T04:03:39.108Z"
last_activity: 2026-04-04
progress:
  total_phases: 3
  completed_phases: 2
  total_plans: 4
  completed_plans: 4
  percent: 100
---

# Project State: Brain-Cache

**Last updated:** 2026-04-03
**Updated by:** roadmapper (v2.4 Status Line roadmap created)

---

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-03)

**Core value:** Reduce Claude token usage and improve response quality by running embeddings, retrieval, and context building locally — Claude only sees what matters.
**Current focus:** Phase 31 — status-line-rendering

---

## Current Position

Phase: 32
Plan: Not started
Status: Ready to execute
Last activity: 2026-04-04

Progress: [██████████] 100%

---

## Accumulated Context

### Active Blockers

None.

### Key Decisions (Phase 31, Plan 01 — statusline.mjs TDD)

- _readStatsFromPath(filePath) exported as test helper — tests inject temp paths directly instead of mocking os.homedir
- Unicode arrow is down-arrow U+2193 (↓), not left-arrow U+2190 (←) — confirmed from plan spec
- STATS_TTL_MS duplicated inline in statusline.mjs (not imported from sessionStats.ts) to maintain standalone-no-project-imports constraint
- Stdin/stdout protocol guarded with import.meta.url === file://${process.argv[1]} — script is importable by vitest without executing I/O

### Key Decisions (Phase 30, Plan 02 — MCP stats wiring)

- Fire-and-forget pattern for stats: never await accumulateStats — handler returns before accumulation completes, stats failure is isolated via .catch
- search_codebase computes delta inline from chunks array (Math.round(reduce(length)/4)); build_context/trace_flow/explain_codebase extract from result.metadata
- Both auto-index retry success paths in search_codebase and build_context also accumulate stats — they represent real successful retrievals
- accumulateStats called only on success paths; error paths (isError: true returns) never call it

### Key Decisions (v2.4 roadmap — phase structure)

- Three phases derived from six requirements: stats service (30), script rendering (31), init integration (32)
- STAT-02 (TTL reset) is implemented inside Phase 30's `accumulateStats` — reset logic lives in the writer, not a separate phase
- STAT-04 (idle state) ships with Phase 31 — it is a rendering concern, not an infrastructure concern
- Stats accumulation placed in MCP handler layer (not workflow layer) to preserve CLI/MCP separation — CLI invocations of the same workflows must not write MCP session stats
- `write-file-atomic@7.0.1` is the only new runtime dependency — bundled TypeScript declarations, Node 22 compatible
- Stats file IPC path: `~/.brain-cache/session-stats.json` — only viable cross-process mechanism between MCP server and status line script
- Status line script written in Node.js (not bash+jq) — jq is not universally installed; node is guaranteed on any brain-cache machine
- Phase 31 annotated with `UI hint: yes` — status line rendering involves a user-facing display script consumed by Claude Code

### Key Decisions (Prior milestones — see v2.3 STATE.md for full history)

- Phase 29: behavioral summaries via isExportedChunk, extractBehavioralSummary, groupChunksByModule
- Phase 28: STDLIB_SYMBOLS Set for O(1) stdlib filtering; productionHops filter before map()
- Phase 26: Tier 3 filename stem boost uses 0.6 (not 0.8) to avoid regression on tsup noise test
- Phase 25: negative guards use "Do NOT use this tool when..." pattern
- Phase 24: computeHopSavings mirrors buildContext.ts pattern; zero-hop short-circuits with inline zeros
- Phase 22: exact-name SQL lookup via extractSymbolCandidate short-circuits embedding for camelCase queries

### Session Notes

v2.4 Status Line roadmap defined: 3 phases (30-32), 6 requirements, all mapped.
Phase ordering: 30 (stats infrastructure) → 31 (status line rendering) → 32 (init integration).
Phase 31 depends on Phase 30 — the script cannot display stats that do not exist; stats file is the IPC contract.
Phase 32 depends on Phase 31 — init installs the script path from Phase 31; script must be stable before wiring.
All 6 v2.4 requirements covered: STAT-01, STAT-02 in Phase 30; STAT-03, STAT-04 in Phase 31; STAT-05, STAT-06 in Phase 32.

### Quick Tasks Completed

See prior STATE.md entries for v1.x–v2.3 quick tasks (archived).

---

## Session Continuity

**Last session:** 2026-04-04T03:51:31.653Z

**Stopped at:** Completed 31-01-PLAN.md

**Next action:** `/gsd:plan-phase 30`

---
*State initialized: 2026-03-31*
