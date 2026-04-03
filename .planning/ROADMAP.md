# Roadmap: Brain-Cache

**Project:** Brain-Cache
**Core Value:** Reduce Claude token usage and improve response quality by running embeddings, retrieval, and context building locally

---

## Milestones

- ✅ **v1.0 MVP** — Phases 1-5 (shipped 2026-04-01) — [archive](milestones/v1.0-ROADMAP.md)
- ✅ **v1.1 Hardening** — Phases 6-12 (shipped 2026-04-01) — [archive](milestones/v1.1-ROADMAP.md)
- ✅ **v1.1.1 Post-Ship Cleanup** — Phase 14 (shipped 2026-04-02)
- ✅ **v1.2 MCP Tool Adoption** — Phase 13 (shipped 2026-04-02)
- ✅ **v2.0 MCP Magic** — Phases 15-19 (shipped 2026-04-03) — [archive](milestones/v2.1-ROADMAP.md)
- ✅ **v2.1 Presentation Magic** — Phases 20-21 (shipped 2026-04-03) — [archive](milestones/v2.1-ROADMAP.md)
- ✅ **v2.2 Retrieval Quality** — Phases 22-25 (shipped 2026-04-03) — [archive](milestones/v2.2-ROADMAP.md)
- 🔄 **v2.3 Final Quality Pass** — Phases 26-29 (in progress)

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

### v2.3 Final Quality Pass (Phases 26-29)

- [x] **Phase 26: Search Precision** - Exact-match and filename-aware retrieval boosting in search_codebase (completed 2026-04-03)
- [x] **Phase 27: Compression Protection** - Protect primary results from body compression, drop noise before trimming production code (completed 2026-04-03)
- [ ] **Phase 28: Trace Output Quality** - Noise filtering, confidence warnings, and CLI entrypoint preference in trace_flow
- [ ] **Phase 29: Explain Codebase Depth** - Behavioral summaries for key modules in explain_codebase

## Phase Details

*All phases through v2.2 are archived. See [milestones/](milestones/) for full phase details.*

<!-- Phase details for next milestone will appear below -->

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
**Plans:** 2/2 plans complete

Plans:
- [x] 18-01-PLAN.md — fileWatcher service and watch workflow with debounce, cross-process lock, signal cleanup
- [x] 18-02-PLAN.md — CLI watch command wiring, chokidar install, end-to-end verification

### Phase 19: CLAUDE.md Refinements
**Goal**: Claude naturally routes to the correct brain-cache tool for each query type without user guidance, across the full 6-tool suite
**Depends on**: Phase 17
**Requirements**: ADOPT-01
**Success Criteria** (what must be TRUE):
  1. In a fresh Claude Code session, Claude calls `trace_flow` (not `build_context`) when asked "how does X flow to Y across files"
  2. In a fresh Claude Code session, Claude calls `explain_codebase` (not `build_context` or file-read tools) when asked to explain the project architecture
  3. The CLAUDE.md routing table covers all 6 tools with clear trigger conditions and explicit "use X instead" cross-references
  4. Running `brain-cache init` on a new project produces a CLAUDE.md section that reflects the v2.0 tool set
**Plans:** 2/2 plans complete

Plans:
- [x] 19-01-PLAN.md — Update CLAUDE_MD_SECTION template and project CLAUDE.md with 6-tool routing table
- [x] 19-02-PLAN.md — Add MCP handler tests for trace_flow and explain_codebase, full regression check

### Phase 20: Formatter Foundation
**Goal**: Every MCP tool response is produced by a type-safe pure-function formatter in src/lib/format.ts that delivers a consistent envelope — summary line, tool-specific body, and error handling — with no change to MCP behavior yet
**Depends on**: Phase 19
**Requirements**: FMT-01, FMT-02, REND-01, REND-02, REND-03, REND-04, META-02
**Success Criteria** (what must be TRUE):
  1. Calling `formatToolResponse` with a summary and body string produces a single formatted string beginning with the summary sentence
  2. Each of the 5 tool-specific formatters (`formatSearchResults`, `formatContext`, `formatTraceFlow`, `formatDoctorOutput`, `formatIndexResult`) accepts its exact workflow return type — no `any` — and produces LLM-readable markdown with no ANSI escape codes
  3. Passing zero results to `formatSearchResults` or `formatTraceFlow` produces a single clean sentence, not an empty structured frame
  4. Passing an error to `formatErrorEnvelope` produces a consistent block with `Error:`, the message, and an optional `Suggestion:` line across all 6 tools
  5. All formatter unit tests in `tests/lib/format.test.ts` pass, covering zero/one/many result cases per tool
**Plans:** 2/2 plans complete

Plans:
- [x] 20-01-PLAN.md — Core formatters: envelope, error, token savings redesign, doctor, index result
- [x] 20-02-PLAN.md — Result-list formatters: search results, trace flow, context

### Phase 21: MCP Handler Wiring and Metadata
**Goal**: All 6 MCP tool handlers return formatted text produced by the Phase 20 formatters, with token savings and pipeline labels visible in retrieval tool responses — making the presentation change live and observable in Claude Code
**Depends on**: Phase 20
**Requirements**: META-01, META-03
**Success Criteria** (what must be TRUE):
  1. Calling `search_codebase` from Claude Code returns a numbered ranked list with score, file path, line number, symbol name, and chunk type — not a JSON string
  2. Calling `trace_flow` returns numbered hops with depth, file path, line, symbol name, and calls found — not a JSON string
  3. Calling `build_context` and `explain_codebase` include a token savings footer (tokens sent, estimated without, reduction %) in plain `label: value` format with no `padEnd` column alignment
  4. Calling `build_context`, `explain_codebase`, `search_codebase`, or `trace_flow` shows a pipeline label summarising local tasks performed (e.g. `embed -> search -> dedup -> compress`)
  5. Updated assertions in `tests/mcp/server.test.ts` confirm formatted output shapes and no JSON bleed-through in any handler response
**Plans:** 2/2 plans complete

Plans:
- [x] 21-01-PLAN.md — Add formatPipelineLabel to format.ts, wire all 6 MCP handlers to formatters
- [x] 21-02-PLAN.md — Update server.test.ts assertions for formatted output, pipeline labels, and token savings

### Phase 22: Isolated Trace Fixes
**Goal**: trace_flow anchors to the correct function when given a verbose query, and each callee appears exactly once per hop in the output
**Depends on**: Phase 21
**Requirements**: OUT-01, RET-03
**Success Criteria** (what must be TRUE):
  1. Calling `trace_flow` with "how does chunkFile work" resolves to the `chunkFile` function as the entry point, not an unrelated chunk that happens to match keywords
  2. Each hop in a `trace_flow` result lists each callee name at most once in its calls list — no duplicate entries regardless of how many edges the BFS traverses
  3. The exact-name SQL lookup runs before any vector search and short-circuits the embedding step when a symbol name match is found
  4. If no exact match exists in the chunks table, trace_flow falls back to vector search and behaves identically to the pre-fix behavior
**Plans:** 2/2 plans complete

Plans:
- [x] 22-01-PLAN.md — Deduplicate callsFound entries in trace_flow hop output (OUT-01)
- [x] 22-02-PLAN.md — Add exact-name SQL lookup for trace_flow entry point resolution (RET-03)

### Phase 23: Search Noise Reduction
**Goal**: Build tool config files rank below application code in search results unless the user's query explicitly mentions the config tool by name
**Depends on**: Phase 22
**Requirements**: NOISE-01
**Success Criteria** (what must be TRUE):
  1. A search for "config values" returns application configuration code ahead of vitest.config.ts, tsup.config.ts, tsconfig.json, and similar build tool files
  2. A search for "how does tsup build the project" still surfaces tsup.config.ts in results — the penalty does not apply when the tool name appears in the query
  3. The penalty is a score coefficient subtracted from the blended score, not a hard exclusion — penalized files remain reachable for explicit queries
  4. The penalty constant is named and documented in retriever.ts so its intent is clear without reading surrounding code
**Plans:** 1/1 plans complete

Plans:
- [x] 23-01-PLAN.md — TDD: config file noise penalty in searchChunks blended scoring

### Phase 24: Compression and Savings Accuracy
**Goal**: Chunks whose file or symbol name matches a query term are protected from body compression, and token savings figures reflect only results that were actually returned and relevant
**Depends on**: Phase 23
**Requirements**: RET-01, RET-02, OUT-02
**Success Criteria** (what must be TRUE):
  1. Calling `build_context` with a query that names a specific file (e.g. "how does buildContext.ts work") returns that file's content uncompressed in the response
  2. The keyword boost weight is per-intent-mode — a lookup query boosts name-matched chunks more aggressively than an explore query
  3. Calling `trace_flow` on a query that resolves to zero hops reports zero token savings, not a fabricated percentage
  4. Calling `trace_flow` on a query that resolves to the wrong entry point reports zero savings rather than an inflated number based on discarded results
  5. Token savings on successful trace_flow calls are computed from the actual content returned, not a hardcoded constant
**Plans:** 2/2 plans complete

Plans:
- [x] 24-01-PLAN.md — Per-mode keyword boost weights and similarity promotion for name-matched chunks (RET-01, RET-02)
- [x] 24-02-PLAN.md — Real token savings computation in runTraceFlow (OUT-02)

### Phase 25: Tool Routing Documentation
**Goal**: Claude selects the correct brain-cache tool for all documented query patterns, guided by explicit negative examples in both MCP tool descriptions and CLAUDE.md
**Depends on**: Phase 24
**Requirements**: ROUTE-01
**Success Criteria** (what must be TRUE):
  1. Given "how does X work" (code understanding), Claude calls `build_context` — not `trace_flow`
  2. Given "trace how X calls Y" (call path), Claude calls `trace_flow` — not `build_context`
  3. Each MCP tool description contains at least one "Do NOT use this tool when..." negative example that names a specific anti-pattern query
  4. The CLAUDE.md routing table rows reflect the behavior delivered by Phases 22-24, not prior intent
**Plans:** 2/2 plans complete

Plans:
- [x] 25-01-PLAN.md — MCP tool description negative examples and server.test.ts assertions
- [x] 25-02-PLAN.md — CLAUDE.md and claude-md-section.ts routing table update with negative examples

### Phase 26: Search Precision
**Goal**: search_codebase returns the named symbol or file on the first attempt when the query contains an exact or near-exact symbol/filename match
**Depends on**: Phase 25
**Requirements**: PREC-01, PREC-02
**Success Criteria** (what must be TRUE):
  1. Querying `search_codebase("compressChunk function")` returns `compressChunk` from `compression.ts` in the top results — the exact symbol name match ranks above semantically similar but differently-named symbols (debug.md: exact symbol lookup scenario)
  2. Querying `search_codebase("compression service")` surfaces `compression.ts` in top results — the filename token "compression" acts as a strong prior before semantic similarity scoring (debug.md: compression service lookup scenario)
  3. A query that contains a camelCase symbol name (e.g. `searchChunks`) boosts chunks whose function/variable name field matches, even when the semantic similarity score is lower than adjacent symbols
  4. A query that contains a filename stem (e.g. "chunker", "retriever") boosts chunks whose `filePath` field contains that stem
**Plans:** 1/1 plans complete

Plans:
- [x] 26-01-PLAN.md — TDD: tiered keyword boost for exact name and filename stem matching

### Phase 27: Compression Protection
**Goal**: build_context spends token budget on the chunk that directly answers the query, and peripheral chunks (test files, config files) are dropped or compressed before any production file loses its body
**Depends on**: Phase 26
**Requirements**: COMP-01, COMP-02
**Success Criteria** (what must be TRUE):
  1. Calling `build_context("how does buildContext.ts work")` returns `buildContext.ts` with its full function body — the primary result is never compressed while peripheral files remain in full (debug.md: workflow body query scenario)
  2. Calling `build_context("how does chunkFile work")` returns `chunkFile` in full while test file chunks (`logger.test.ts`, `compression.test.ts`, `flowTracer.test.ts`) are excluded before any production file is compressed (debug.md: chunkFile lookup scenario)
  3. When the token budget is tight, test file chunks are dropped first, config file chunks are dropped second, and production source files are compressed last
  4. A chunk whose file path or symbol name is a close match to the query is marked as the primary result and exempt from compression regardless of chunk size
**Plans:** 1/1 plans complete

Plans:
- [x] 27-01-PLAN.md — TDD: peripheral chunk drop and primary result compression protection

### Phase 28: Trace Output Quality
**Goal**: trace_flow produces clean, trustworthy output — test files and stdlib methods are absent from hop lists, low-confidence seeds are surfaced explicitly, and CLI queries anchor to CLI entry files
**Depends on**: Phase 26
**Requirements**: TRACE-01, TRACE-02, TRACE-03, TRACE-04
**Success Criteria** (what must be TRUE):
  1. Tracing `runBuildContext` produces zero hops that resolve to test files — `tests/services/logger.test.ts` and similar test paths do not appear in any hop's filePath (debug.md: runBuildContext workflow trace scenario)
  2. Hop lists for any traced function exclude native Array/Promise/String methods (`map`, `filter`, `includes`, `resolve`, `push`, `has`) — only project-owned symbols appear as callees (debug.md: runBuildContext workflow trace scenario)
  3. Querying `trace_flow("nonexistentFunction")` with a top-match similarity below 0.5 produces a visible warning line — e.g. `No confident match for "nonexistentFunction" — tracing nearest match: resetState (watch.ts:13, similarity: 0.31)` — rather than a structurally identical-looking trace (debug.md: nonexistent symbol query scenario)
  4. Querying `trace_flow("index_repo CLI command to LanceDB storage")` resolves to a symbol in `src/cli/` or a file containing `program.command(...)` as the seed, not a mid-stack service function (debug.md: CLI-to-LanceDB indexing trace scenario)
**Plans**: TBD

### Phase 29: Explain Codebase Depth
**Goal**: explain_codebase describes what each key module does, not just that it exists — prioritizing exports and cross-cutting wiring over internal helpers
**Depends on**: Phase 27
**Requirements**: EXPL-01
**Success Criteria** (what must be TRUE):
  1. An `explain_codebase` call includes at least one behavioral sentence per key module (e.g. "compression.ts strips function bodies above 200 tokens, preserving signatures and JSDoc") rather than listing filenames with no description (debug.md: architecture query scenario)
  2. The output prioritizes chunks containing module-level exports and cross-cutting wiring (e.g. how services are composed in workflows) over internal helpers or rendering utilities — `logger.ts` does not lead the overview
  3. For modules where compression was applied, the output includes a one-sentence summary of what the module does so the architecture overview is meaningful without requiring a follow-up `build_context` call
  4. `explain_codebase` does not include internal helper functions (e.g. `childLogger` in `logger.ts`, layout renderers in `explainCodebase.ts`) as representative module-level content
**Plans**: TBD
**UI hint**: no

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
| 22. Isolated Trace Fixes | v2.2 | 2/2 | Complete   | 2026-04-03 |
| 23. Search Noise Reduction | v2.2 | 1/1 | Complete    | 2026-04-03 |
| 24. Compression and Savings Accuracy | v2.2 | 2/2 | Complete    | 2026-04-03 |
| 25. Tool Routing Documentation | v2.2 | 2/2 | Complete    | 2026-04-03 |
| 26. Search Precision | v2.3 | 1/1 | Complete    | 2026-04-03 |
| 27. Compression Protection | v2.3 | 1/1 | Complete   | 2026-04-03 |
| 28. Trace Output Quality | v2.3 | 0/? | Not started | - |
| 29. Explain Codebase Depth | v2.3 | 0/? | Not started | - |

---
*Roadmap created: 2026-03-31*
*Last updated: 2026-04-03 — v2.3 Final Quality Pass roadmap added (Phases 26-29)*
