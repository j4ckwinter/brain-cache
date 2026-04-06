---
gsd_state_version: 1.0
milestone: v3.5
milestone_name: Daily Adoption
status: planning
stopped_at: Completed 52-01-PLAN.md
last_updated: "2026-04-06T19:01:41.458Z"
last_activity: 2026-04-06
progress:
  total_phases: 11
  completed_phases: 9
  total_plans: 25
  completed_plans: 22
---

# Project State: Brain-Cache

**Last updated:** 2026-04-06
**Updated by:** gsd:new-milestone — v3.5 Daily Adoption roadmap + requirements wired

---

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-05)

**Core value:** Reduce Claude token usage and improve response quality by running embeddings, retrieval, and context building locally — Claude only sees what matters.
**Current focus:** Phase 51 — git-history-indexing

---

## Current Position

Phase: 51
Plan: Not started
Status: Ready for planning
Last activity: 2026-04-06

Progress: [████████░░] v3.5: 3/4 phases

---

## Accumulated Context

### Critical Ordering Constraints

- Phase 48 (stat fingerprint skip) before Phase 49 (watch) — watch amplifies index frequency; cheaper incremental I/O reduces load
- Phase 49 (watch) before Phase 50 (service install) — service wraps the same CLI
- DAILY-04 (git history) after Phase 49 recommended — stable lock + index patterns before second ingestion pipeline
- TEST-03 (auto-index retry test) MUST be written before DEBT-01 (withGuards extraction) — both are in Phase 45, TEST-03 first
- COR-03 (cross-process locking) MUST land before PERF-02 (batch deletions) — batching is only safe under the lock
- DEBT-02 (workflow guards) before DEBT-01 (withGuards wrapper) — guards enable the wrapper
- FEAT-04 (crawler extensions) after FEAT-02 (Markdown chunker) — crawler needs chunker support first

### Key Pitfalls (from research)

- Zero-vector fix: use query-time filtering only — adding a schema column breaks all existing user indexes
- LanceDB pool: cache Connection only, never Table — stale Table handles after --force reindex cause silent wrong-data bugs
- Path traversal: validate against system-path blocklist, NOT cwd() anchor — MCP servers spawn from Claude Code's cwd, not user project root
- withGuards: auto-index retry behavior is currently untested — write TEST-03 first to prevent silent regression

### Active Blockers

None.

---

## Session Continuity

**Last session:** 2026-04-06T19:01:41.454Z

**Stopped at:** Completed 52-01-PLAN.md

**Next action:** Plan Phase 51 (DAILY-04) — git history ingestion and provenance retrieval

---

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260404-4u7 | Update README | 2026-04-04 | 5f74829 | [260404-4u7-update-readme](./quick/260404-4u7-update-readme/) |
| 260405-cxe | Update README to document PreToolUse hook | 2026-04-05 | de55cb4 | [260405-cxe-update-readme-to-document-pretooluse-hoo](./quick/260405-cxe-update-readme-to-document-pretooluse-hoo/) |

---
*State initialized: 2026-03-31*
