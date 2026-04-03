# Roadmap: Brain-Cache

**Project:** Brain-Cache
**Core Value:** Reduce Claude token usage and improve response quality by running embeddings, retrieval, and context building locally

---

## Milestones

- ✅ **v1.0 MVP** — Phases 1-5 (shipped 2026-04-01) — [archive](milestones/v1.0-ROADMAP.md)
- ✅ **v1.1 Hardening** — Phases 6-12 (shipped 2026-04-01) — [archive](milestones/v1.1-ROADMAP.md)
- ✅ **v1.1.1 Post-Ship Cleanup** — Phase 14 (shipped 2026-04-02)
- ✅ **v1.2 MCP Tool Adoption** — Phase 13 (shipped 2026-04-02)
- 📋 **v2.0 MCP Magic** — Phases 15-19 (planned)

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

**v2.0 MCP Magic (Phases 15-19)**

- [x] **Phase 15: Storage Foundation and Index Pipeline** - Add LanceDB edges table, `.braincacheignore` support, and LanceDB write mutex; extend chunker to emit call edges (completed 2026-04-02)
- [x] **Phase 16: Retrieval Intelligence** - Expand intent classifier to lookup/trace/explore modes, build flow tracer BFS service, add context cohesion grouping (completed 2026-04-03)
- [x] **Phase 17: New MCP Tools and Workflows** - Ship `trace_flow` and `explain_codebase` MCP tools, configurable retrieval depth, and structural context compression (completed 2026-04-03)
- [ ] **Phase 18: File Watcher** - Live re-indexing via chokidar v5 with debounce and write-safe incremental updates
- [ ] **Phase 19: CLAUDE.md Refinements** - Guide Claude toward new MCP tools with accurate routing language for the full 6-tool suite

## Phase Details

### Phase 15: Storage Foundation and Index Pipeline
**Goal**: LanceDB can store and query call edges, the index pipeline writes those edges and respects `.braincacheignore`, and concurrent writes are safe
**Depends on**: Phase 14
**Requirements**: EXC-01, FLOW-01
**Success Criteria** (what must be TRUE):
  1. Running `brain-cache index` on a TypeScript project produces non-zero rows in the LanceDB edges table (verified via `edgesTable.countRows()`)
  2. A `.braincacheignore` file in the project root causes matching files to be excluded from the indexed corpus, the same way `.gitignore` entries are
  3. Running `brain-cache index` twice concurrently does not corrupt the LanceDB table (no partial-write errors)
  4. The chunker returns `{ chunks, edges }` from a single tree-sitter traversal — no double-parse of source files
**Plans:** 3/3 plans complete

Plans:
- [x] 15-01-PLAN.md — Types, LanceDB edges table functions, and write mutex
- [x] 15-02-PLAN.md — .braincacheignore service and crawler integration
- [x] 15-03-PLAN.md — Chunker edge extraction and index workflow wiring

### Phase 16: Retrieval Intelligence
**Goal**: Brain-cache routes queries to one of three retrieval modes (lookup, trace, explore), traces multi-hop call paths across files, and groups assembled context by file for readability
**Depends on**: Phase 15
**Requirements**: INTENT-01, COH-01, FLOW-01
**Success Criteria** (what must be TRUE):
  1. A lookup query (e.g. "what does classifyQueryIntent return") retrieves narrow, high-precision results with a tight distance threshold
  2. A trace query (e.g. "how does indexing flow from CLI to LanceDB") triggers BFS traversal across the edges table and returns hop-ordered results
  3. An explore query (e.g. "explain the architecture") retrieves broad results across modules with a relaxed threshold
  4. Context assembled by `build_context` is grouped by file/module with chunks in source-line order, not retrieval-score order
  5. The flow tracer never returns the same symbol twice (cycle detection via visited set) and stops at the configured hop depth
**Plans:** 3/3 plans complete

Plans:
- [x] 16-01-PLAN.md — Three-mode intent classifier (lookup/trace/explore) and strategy map
- [x] 16-02-PLAN.md — BFS flow tracer service with cycle detection
- [x] 16-03-PLAN.md — Cohesion grouping service and buildContext wiring

### Phase 17: New MCP Tools and Workflows
**Goal**: Claude can invoke `trace_flow` to get structured hop output for a call path, invoke `explain_codebase` for an architecture overview, and retrieval depth is user-configurable per query type
**Depends on**: Phase 16
**Requirements**: FLOW-02, TOOL-02, ADV-01, COMP-01
**Success Criteria** (what must be TRUE):
  1. Calling `trace_flow` with an entrypoint returns a structured `hops[]` array where each hop includes filePath, symbol name, start line, content, and calls found
  2. Calling `explain_codebase` returns module-grouped summaries that describe the repo architecture without requiring a follow-up question
  3. A user can set per-query-type retrieval depth in `~/.brain-cache/config.json` and have it honored without restarting the MCP server
  4. Chunks exceeding the compression threshold have their function/class body stripped and a structured `// [compressed]` manifest prepended, preserving signatures and JSDoc
  5. `build_context` routes trace queries to `runTraceFlow` and explore queries to `runExplainCodebase` automatically
**Plans:** 2/2 plans complete

Plans:
- [x] 17-01-PLAN.md — FlowHop type fix, callsFound population, config loader, and compression services
- [x] 17-02-PLAN.md — runTraceFlow and runExplainCodebase workflows, MCP tool registration, buildContext routing

### Phase 18: File Watcher
**Goal**: Brain-cache keeps the index current automatically as files change, without requiring manual re-index
**Depends on**: Phase 15
**Requirements**: INC-02
**Success Criteria** (what must be TRUE):
  1. Saving a file in the indexed project causes only that file to be re-embedded within a few seconds, not a full re-index
  2. Saving multiple files in rapid succession (e.g. a formatter run) triggers a single debounced re-index pass, not one pass per file
  3. Files matching `.braincacheignore` patterns are not re-indexed when modified
  4. The file watcher and a concurrent `brain-cache index` command do not corrupt the LanceDB table
**Plans:** 2 plans in 2 waves

Plans:
- [ ] 17-01-PLAN.md — FlowHop type fix, callsFound population, config loader, and compression services
- [ ] 17-02-PLAN.md — runTraceFlow and runExplainCodebase workflows, MCP tool registration, buildContext routing

### Phase 19: CLAUDE.md Refinements
**Goal**: Claude naturally routes to the correct brain-cache tool for each query type without user guidance, across the full 6-tool suite
**Depends on**: Phase 17
**Requirements**: ADOPT-01
**Success Criteria** (what must be TRUE):
  1. In a fresh Claude Code session, Claude calls `trace_flow` (not `build_context`) when asked "how does X flow to Y across files"
  2. In a fresh Claude Code session, Claude calls `explain_codebase` (not `build_context` or file-read tools) when asked to explain the project architecture
  3. The CLAUDE.md routing table covers all 6 tools with clear trigger conditions and explicit "use X instead" cross-references
  4. Running `brain-cache init` on a new project produces a CLAUDE.md section that reflects the v2.0 tool set
**Plans:** 2 plans in 2 waves

Plans:
- [ ] 17-01-PLAN.md — FlowHop type fix, callsFound population, config loader, and compression services
- [ ] 17-02-PLAN.md — runTraceFlow and runExplainCodebase workflows, MCP tool registration, buildContext routing

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
| 15. Storage Foundation and Index Pipeline | v2.0 | 3/3 | Complete    | 2026-04-02 |
| 16. Retrieval Intelligence | v2.0 | 3/3 | Complete    | 2026-04-03 |
| 17. New MCP Tools and Workflows | v2.0 | 2/2 | Complete   | 2026-04-03 |
| 18. File Watcher | v2.0 | 0/? | Not started | - |
| 19. CLAUDE.md Refinements | v2.0 | 0/? | Not started | - |

---
*Roadmap created: 2026-03-31*
*Last updated: 2026-04-03 — Phase 17 planned (2 plans in 2 waves)*
