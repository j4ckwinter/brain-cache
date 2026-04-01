# Roadmap: Braincache

**Project:** Braincache
**Core Value:** Reduce Claude token usage and improve response quality by running embeddings, retrieval, and context building locally
**Created:** 2026-03-31
**Granularity:** Standard (5–8 phases)
**Total v1 Requirements:** 22

---

## Phases

- [x] **Phase 1: Foundation** - Establish project scaffold, stderr-only logging, and hardware capability detection (completed 2026-03-31)
- [x] **Phase 2: Storage and Indexing** - LanceDB schema, AST-aware chunking, and the full indexing pipeline (completed 2026-03-31)
- [x] **Phase 3: Retrieval and Context Assembly** - Query pipeline, deduplication, token budget enforcement, and savings metadata (completed 2026-04-01)
- [ ] **Phase 4: MCP Server and Claude Integration** - Expose all tools via stdio MCP and wire ask-codebase via Anthropic SDK
- [ ] **Phase 5: CLI Completion** - All CLI commands as thin workflow adapters with actionable DX

---

## Phase Details

### Phase 1: Foundation
**Goal**: The project is safe to build on — logging never touches stdout, hardware capabilities are known, and sensible defaults are locked in
**Depends on**: Nothing (first phase)
**Requirements**: INF-01, INF-02, INF-03, INF-04
**Success Criteria** (what must be TRUE):
  1. Running any Braincache command produces zero output on stdout when no MCP transport is active — all logs appear on stderr
  2. `braincache doctor` reports GPU availability, VRAM tier, and Ollama reachability without throwing on CPU-only machines
  3. A capability profile is returned on every invocation — no code path throws due to missing GPU or unavailable Ollama
  4. The embedding model is automatically selected based on detected VRAM tier with no user configuration required
**Plans:** 3/3 plans complete

Plans:
- [x] 01-01-PLAN.md — Project scaffold, shared types, config constants, stderr-only pino logger
- [x] 01-02-PLAN.md — Capability detection service (GPU/VRAM/tier/model) and Ollama lifecycle service
- [x] 01-03-PLAN.md — Init and doctor workflows wired to Commander CLI entry point

### Phase 2: Storage and Indexing
**Goal**: A developer can index a codebase and have all source code chunked at function boundaries, embedded locally, and stored in LanceDB
**Depends on**: Phase 1
**Requirements**: IDX-01, IDX-02, IDX-03, IDX-04, IDX-05
**Success Criteria** (what must be TRUE):
  1. `braincache index [path]` completes and stores code chunks in LanceDB with file path, chunk type, and scope metadata
  2. The indexer skips `node_modules`, build artifacts, lock files, and binary files without user configuration
  3. Code is split at function, class, and method boundaries — not arbitrary line counts — for TypeScript, JavaScript, Python, Go, and Rust source files
  4. Embeddings are generated via Ollama using batch requests (not one-per-file), with a 120-second timeout and cold-start retry
  5. Indexing a fresh codebase requires zero configuration — default chunk size, model, and similarity threshold are applied automatically
**Plans:** 4/4 plans complete

Plans:
- [x] 02-01-PLAN.md — Install Phase 2 deps, extend shared types (CodeChunk, IndexState), build file crawler service
- [x] 02-02-PLAN.md — AST-aware chunker service via tree-sitter with CJS/ESM shim
- [x] 02-03-PLAN.md — Embedder service (Ollama batch + timeout + retry) and LanceDB storage service
- [x] 02-04-PLAN.md — Index workflow (crawl -> chunk -> embed -> store) and CLI command wiring

### Phase 3: Retrieval and Context Assembly
**Goal**: A developer (or MCP client) can query the indexed codebase with natural language and receive a deduplicated, token-budgeted context block with savings metadata
**Depends on**: Phase 2
**Requirements**: RET-01, RET-02, RET-03, RET-04, RET-05
**Success Criteria** (what must be TRUE):
  1. A natural language query returns the top-N most relevant code chunks with cosine similarity scores, filtered below a 0.7 threshold
  2. The same function never appears more than once in a single result set — hash-based deduplication is applied before context assembly
  3. Assembled context is trimmed to a configurable token budget, with chunks ranked by relevance score determining what is kept
  4. Every `build_context` response includes: tokens sent, estimated tokens without Braincache, reduction percentage, local tasks performed, and cloud calls made
  5. Queries phrased as diagnostic questions ("why is X broken") select chunks differently than knowledge queries ("how does Y work")
**Plans:** 3/3 plans complete

Plans:
- [x] 03-01-PLAN.md — Install tokenizer dep, extend types/config, create retriever service (search, dedup, intent)
- [x] 03-02-PLAN.md — Create token counter service with budget-based context assembly
- [x] 03-03-PLAN.md — Search and buildContext workflows, CLI command wiring

### Phase 4: MCP Server and Claude Integration
**Goal**: Claude Code can discover and call Braincache tools natively via MCP stdio, and the ask-codebase workflow sends minimal assembled context to Claude for reasoning
**Depends on**: Phase 3
**Requirements**: MCP-01, MCP-02, MCP-03, MCP-04, MCP-05, CLD-01, CLD-02
**Success Criteria** (what must be TRUE):
  1. Claude Code discovers the Braincache MCP server via stdio transport and can invoke all four tools without additional configuration
  2. `index_repo`, `search_codebase`, `build_context`, and `doctor` each return structured responses — tool errors surface as actionable MCP error objects, not thrown exceptions
  3. Invalid tool inputs are rejected with a Zod validation error before any workflow logic executes
  4. The `ask-codebase` workflow sends only the assembled context block to Claude — not raw chunks — and returns Claude's reasoning response
  5. `doctor` returns Ollama status, index freshness, model loaded state, and VRAM available as a structured health object
**Plans**: TBD
**UI hint**: no

### Phase 5: CLI Completion
**Goal**: Every CLI command is a working, polished thin adapter over the completed workflows with actionable error messages and progress feedback
**Depends on**: Phase 4
**Requirements**: CLI-01, CLI-02, CLI-03, CLI-04
**Success Criteria** (what must be TRUE):
  1. `braincache init` detects hardware, pulls the required Ollama model with progress output, warms the model into VRAM, and creates the config directory
  2. `braincache index [path]` displays a progress bar during indexing and prints token savings stats on completion
  3. `braincache doctor` outputs human-readable system health — missing Ollama models produce an actionable fix message, not a stack trace
  4. `braincache status` reports files indexed, chunks stored, last indexed time, and active embedding model
**Plans**: TBD

---

## Progress Table

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation | 3/3 | Complete   | 2026-03-31 |
| 2. Storage and Indexing | 4/4 | Complete   | 2026-03-31 |
| 3. Retrieval and Context Assembly | 3/3 | Complete   | 2026-04-01 |
| 4. MCP Server and Claude Integration | 0/? | Not started | - |
| 5. CLI Completion | 0/? | Not started | - |

---

## Coverage

| Requirement | Phase | Status |
|-------------|-------|--------|
| INF-01 | Phase 1 | Pending |
| INF-02 | Phase 1 | Pending |
| INF-03 | Phase 1 | Pending |
| INF-04 | Phase 1 | Pending |
| IDX-01 | Phase 2 | Pending |
| IDX-02 | Phase 2 | Pending |
| IDX-03 | Phase 2 | Pending |
| IDX-04 | Phase 2 | Pending |
| IDX-05 | Phase 2 | Pending |
| RET-01 | Phase 3 | Pending |
| RET-02 | Phase 3 | Pending |
| RET-03 | Phase 3 | Pending |
| RET-04 | Phase 3 | Pending |
| RET-05 | Phase 3 | Pending |
| MCP-01 | Phase 4 | Pending |
| MCP-02 | Phase 4 | Pending |
| MCP-03 | Phase 4 | Pending |
| MCP-04 | Phase 4 | Pending |
| MCP-05 | Phase 4 | Pending |
| CLD-01 | Phase 4 | Pending |
| CLD-02 | Phase 4 | Pending |
| CLI-01 | Phase 5 | Pending |
| CLI-02 | Phase 5 | Pending |
| CLI-03 | Phase 5 | Pending |
| CLI-04 | Phase 5 | Pending |

**v1 coverage: 22/22 (100%)**

---
*Roadmap created: 2026-03-31*
*Last updated: 2026-03-31 after Phase 3 planning*
