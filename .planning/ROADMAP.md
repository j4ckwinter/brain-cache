# Roadmap: Brain-Cache

**Project:** Brain-Cache
**Core Value:** Reduce Claude token usage and improve response quality by running embeddings, retrieval, and context building locally — Claude only sees what matters.

---

## Milestones

- ✅ **v1.0 MVP** — Phases 1-5 (shipped 2026-04-01) — [archive](milestones/v1.0-ROADMAP.md)
- ✅ **v1.1 Hardening** — Phases 6-12 (shipped 2026-04-01) — [archive](milestones/v1.1-ROADMAP.md)
- ✅ **v1.1.1 Post-Ship Cleanup** — Phase 14 (shipped 2026-04-02)
- ✅ **v1.2 MCP Tool Adoption** — Phase 13 (shipped 2026-04-02)
- ✅ **v2.0 MCP Magic** — Phases 15-19 (shipped 2026-04-03) — [archive](milestones/v2.1-ROADMAP.md)
- ✅ **v2.1 Presentation Magic** — Phases 20-21 (shipped 2026-04-03) — [archive](milestones/v2.1-ROADMAP.md)
- ✅ **v2.2 Retrieval Quality** — Phases 22-25 (shipped 2026-04-03) — [archive](milestones/v2.2-ROADMAP.md)
- ✅ **v2.3 Final Quality Pass** — Phases 26-29 (shipped 2026-04-03)
- 🔄 **v2.4 Status Line** — Phases 30-32 (in progress)

## Phases

<details>
<summary>✅ v1.0 MVP (Phases 1-5) — SHIPPED 2026-04-01</summary>

- [x] Phase 1: Foundation (3/3 plans) — completed 2026-03-31
- [x] Phase 2: Storage and Indexing (4/4 plans) — completed 2026-03-31
- [x] Phase 3: Retrieval and Context Assembly (3/3 plans) — completed 2026-04-01
- [x] Phase 4: MCP Server and Claude Integration (2/2 plans) — completed 2026-04-01
- [x] Phase 5: CLI Completion (2/2 plans) — completed 2026-04-01

</details>

<details>
<summary>✅ v1.1 Hardening (Phases 6-12) — SHIPPED 2026-04-01</summary>

- [x] Phase 6: Foundation Cleanup (2/2 plans) — completed 2026-04-01
- [x] Phase 7: Type Safety and Code Correctness (2/2 plans) — completed 2026-04-01
- [x] Phase 8: Ollama Process Security (1/1 plan) — completed 2026-04-01
- [x] Phase 9: Indexing and Retrieval Performance (2/2 plans) — completed 2026-04-01
- [x] Phase 10: Incremental Indexing and Intent Classification (2/2 plans) — completed 2026-04-01
- [x] Phase 11: Restore Concurrent Index Pipeline (1/1 plan) — completed 2026-04-01
- [x] Phase 12: Integration Gap Cleanup (1/1 plan) — completed 2026-04-01

</details>

<details>
<summary>✅ v1.1.1 Post-Ship Cleanup (Phase 14) — SHIPPED 2026-04-02</summary>

- [x] **Phase 14: Test Suite & Barrel Repair** — completed 2026-04-02

</details>

<details>
<summary>✅ v1.2 MCP Tool Adoption (Phase 13) — SHIPPED 2026-04-02</summary>

- [x] **Phase 13: MCP Tool Description Rewrite** — completed 2026-04-02

</details>

<details>
<summary>✅ v2.0 MCP Magic (Phases 15-19) — SHIPPED 2026-04-03</summary>

- [x] **Phase 15: Storage Foundation and Index Pipeline** - Add LanceDB edges table, `.braincacheignore` support, and LanceDB write mutex; extend chunker to emit call edges (completed 2026-04-02)
- [x] **Phase 16: Retrieval Intelligence** - Expand intent classifier to lookup/trace/explore modes, build flow tracer BFS service, add context cohesion grouping (completed 2026-04-03)
- [x] **Phase 17: New MCP Tools and Workflows** - Ship `trace_flow` and `explain_codebase` MCP tools, configurable retrieval depth, and structural context compression (completed 2026-04-03)
- [x] **Phase 18: File Watcher** - Live re-indexing via chokidar v5 with debounce and write-safe incremental updates (completed 2026-04-03)
- [x] **Phase 19: CLAUDE.md Refinements** - Guide Claude toward new MCP tools with accurate routing language for the full 6-tool suite (completed 2026-04-03)

</details>

<details>
<summary>✅ v2.1 Presentation Magic (Phases 20-21) — SHIPPED 2026-04-03</summary>

- [x] Phase 20: Formatter Foundation (2/2 plans) — completed 2026-04-03
- [x] Phase 21: MCP Handler Wiring and Metadata (2/2 plans) — completed 2026-04-03

</details>

<details>
<summary>✅ v2.2 Retrieval Quality (Phases 22-25) — SHIPPED 2026-04-03</summary>

- [x] Phase 22: Isolated Trace Fixes (2/2 plans) — completed 2026-04-03
- [x] Phase 23: Search Noise Reduction (1/1 plans) — completed 2026-04-03
- [x] Phase 24: Compression and Savings Accuracy (2/2 plans) — completed 2026-04-03
- [x] Phase 25: Tool Routing Documentation (2/2 plans) — completed 2026-04-03

</details>

<details>
<summary>✅ v2.3 Final Quality Pass (Phases 26-29) — SHIPPED 2026-04-03</summary>

- [x] **Phase 26: Search Precision** - Exact-match and filename-aware retrieval boosting in search_codebase (completed 2026-04-03)
- [x] **Phase 27: Compression Protection** - Protect primary results from body compression, drop noise before trimming production code (completed 2026-04-03)
- [x] **Phase 28: Trace Output Quality** - Noise filtering, confidence warnings, and CLI entrypoint preference in trace_flow (completed 2026-04-03)
- [x] **Phase 29: Explain Codebase Depth** - Behavioral summaries for key modules in explain_codebase (completed 2026-04-03)

</details>

### v2.4 Status Line (Phases 30-32)

- [x] **Phase 30: Stats Infrastructure** - Session stats service with atomic writes, TTL-based reset, and config constants (completed 2026-04-03)
- [x] **Phase 31: Status Line Rendering** - Node.js status line script reading session stats, cumulative display, and idle fallback (completed 2026-04-04)
- [ ] **Phase 32: Init Integration** - brain-cache init installs status line script and merges settings.json without clobbering

## Phase Details

*All phases through v2.3 are archived. See [milestones/](milestones/) for full phase details.*

<!-- Phase details for v2.4 -->

### Phase 30: Stats Infrastructure
**Goal**: MCP retrieval handlers can persist cumulative token savings to a session stats file that resets automatically when a new session begins
**Depends on**: Phase 29
**Requirements**: STAT-01, STAT-02
**Success Criteria** (what must be TRUE):
  1. After any of the four retrieval tool handlers (search_codebase, build_context, trace_flow, explain_codebase) completes a call, `~/.brain-cache/session-stats.json` is created or updated with the accumulated tokensSent and estimatedWithoutBraincache totals for the session
  2. Two MCP tool calls executing concurrently produce a stats file containing the sum of both calls' savings — no call's contribution is silently discarded by a concurrent write
  3. A stats file whose `lastUpdatedAt` timestamp is older than the configured TTL (default 2 hours) is treated as expired — the next accumulation resets the counters to zero before adding the new delta
  4. A failure in stats accumulation does not fail or delay the tool call response — the side effect is fire-and-forget
**Plans**: 2 plans
Plans:
- [x] 30-01-PLAN.md — Session stats service with TDD (accumulateStats, mutex, TTL, atomic write)
- [x] 30-02-PLAN.md — Wire fire-and-forget accumulateStats into MCP handlers

### Phase 31: Status Line Rendering
**Goal**: Claude Code displays brain-cache's cumulative token savings after every prompt via a Node.js status line script that gracefully handles missing or expired stats
**Depends on**: Phase 30
**Requirements**: STAT-03, STAT-04
**Success Criteria** (what must be TRUE):
  1. When `~/.brain-cache/session-stats.json` exists and is within TTL, the status line script prints `brain-cache  ↓{pct}%  {n} saved` with the cumulative reduction percentage and absolute token count rounded for readability
  2. When no stats file exists, the status line script prints `brain-cache  idle` — not a blank line, not an error
  3. When the stats file exists but its `lastUpdatedAt` is older than the TTL, the status line script prints `brain-cache  idle` — stale data is never displayed
  4. If the script encounters any runtime error (malformed JSON, missing file, permissions), it catches the error and prints `brain-cache  idle` rather than exiting with a non-zero code or producing no output
  5. The script completes under 100ms cold-start — it does only synchronous file reads and string formatting with no subprocess spawning or network calls
**Plans**: 2 plans
Plans:
- [x] 31-01-PLAN.md — TDD: statusline.mjs pure functions (formatTokenCount, readStats, renderOutput) with unit tests
- [x] 31-02-PLAN.md — Integration tests (subprocess stdin/stdout pipeline) and human verification
**UI hint**: yes

### Phase 32: Init Integration
**Goal**: Running brain-cache init installs the status line into Claude Code automatically, merging settings.json safely without destroying the user's existing configuration
**Depends on**: Phase 31
**Requirements**: STAT-05, STAT-06
**Success Criteria** (what must be TRUE):
  1. After running `brain-cache init`, `~/.brain-cache/statusline.mjs` exists and is executable, and `~/.claude/settings.json` contains the `statusLine` entry pointing to it
  2. Running `brain-cache init` on a machine where `~/.claude/settings.json` already has other keys (env vars, keybindings, other hooks) leaves all existing keys intact — only the `statusLine` key is added
  3. Running `brain-cache init` on a machine where `~/.claude/settings.json` already has a `statusLine` entry prints a visible warning and skips overwriting — the existing entry is preserved
  4. Running `brain-cache init` twice on a clean machine produces identical results both times — the operation is idempotent
**Plans**: [To be planned]

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Foundation | v1.0 | 3/3 | Complete | 2026-03-31 |
| 2. Storage and Indexing | v1.0 | 4/4 | Complete | 2026-03-31 |
| 3. Retrieval and Context Assembly | v1.0 | 3/3 | Complete | 2026-04-01 |
| 4. MCP Server and Claude Integration | v1.0 | 2/2 | Complete | 2026-04-01 |
| 5. CLI Completion | v1.0 | 2/2 | Complete | 2026-04-01 |
| 6. Foundation Cleanup | v1.1 | 2/2 | Complete | 2026-04-01 |
| 7. Type Safety and Code Correctness | v1.1 | 2/2 | Complete | 2026-04-01 |
| 8. Ollama Process Security | v1.1 | 1/1 | Complete | 2026-04-01 |
| 9. Indexing and Retrieval Performance | v1.1 | 2/2 | Complete | 2026-04-01 |
| 10. Incremental Indexing and Intent Classification | v1.1 | 2/2 | Complete | 2026-04-01 |
| 11. Restore Concurrent Index Pipeline | v1.1 | 1/1 | Complete | 2026-04-01 |
| 12. Integration Gap Cleanup | v1.1 | 1/1 | Complete | 2026-04-01 |
| 13. MCP Tool Description Rewrite | v1.2 | 1/1 | Complete | 2026-04-02 |
| 14. Test Suite & Barrel Repair | v1.1.1 | 1/1 | Complete | 2026-04-02 |
| 15. Storage Foundation and Index Pipeline | v2.0 | 3/3 | Complete | 2026-04-02 |
| 16. Retrieval Intelligence | v2.0 | 3/3 | Complete | 2026-04-03 |
| 17. New MCP Tools and Workflows | v2.0 | 2/2 | Complete | 2026-04-03 |
| 18. File Watcher | v2.0 | 2/2 | Complete | 2026-04-03 |
| 19. CLAUDE.md Refinements | v2.0 | 2/2 | Complete | 2026-04-03 |
| 20. Formatter Foundation | v2.1 | 2/2 | Complete | 2026-04-03 |
| 21. MCP Handler Wiring and Metadata | v2.1 | 2/2 | Complete | 2026-04-03 |
| 22. Isolated Trace Fixes | v2.2 | 2/2 | Complete | 2026-04-03 |
| 23. Search Noise Reduction | v2.2 | 1/1 | Complete | 2026-04-03 |
| 24. Compression and Savings Accuracy | v2.2 | 2/2 | Complete | 2026-04-03 |
| 25. Tool Routing Documentation | v2.2 | 2/2 | Complete | 2026-04-03 |
| 26. Search Precision | v2.3 | 1/1 | Complete | 2026-04-03 |
| 27. Compression Protection | v2.3 | 1/1 | Complete | 2026-04-03 |
| 28. Trace Output Quality | v2.3 | 2/2 | Complete | 2026-04-03 |
| 29. Explain Codebase Depth | v2.3 | 2/2 | Complete    | 2026-04-03 |
| 30. Stats Infrastructure | v2.4 | 2/2 | Complete    | 2026-04-04 |
| 31. Status Line Rendering | v2.4 | 2/2 | Complete    | 2026-04-04 |
| 32. Init Integration | v2.4 | 0/? | Not started | - |

---
*Roadmap created: 2026-03-31*
*Last updated: 2026-04-04 — Phase 31 plans created*
