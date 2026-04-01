# Requirements: Braincache

**Defined:** 2026-03-31
**Core Value:** Reduce Claude token usage and improve response quality by running embeddings, retrieval, and context building locally

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Indexing

- [x] **IDX-01**: User can index a codebase with `braincache index [path]` and have all source files parsed, chunked, and embedded
- [x] **IDX-02**: Indexer respects `.gitignore` and skips binary files, `node_modules`, build artifacts, and lock files
- [x] **IDX-03**: Code is chunked at function/class/method boundaries using AST-aware parsing (tree-sitter)
- [x] **IDX-04**: Embeddings are generated locally via Ollama and stored in LanceDB with file path, chunk type, and scope metadata
- [x] **IDX-05**: Indexing works with zero configuration — sensible defaults for chunk size, embedding model, similarity threshold

### Retrieval

- [x] **RET-01**: User can search the indexed codebase with a natural language query and receive the top-N most relevant code chunks with similarity scores
- [x] **RET-02**: Retrieved chunks are deduplicated (no repeated functions appearing multiple times in results)
- [x] **RET-03**: Context is assembled within a configurable token budget, ranked by relevance score
- [x] **RET-04**: Every `build_context` response includes metadata: tokens sent, estimated tokens without Braincache, reduction percentage, local tasks performed, cloud calls made
- [x] **RET-05**: Different query types (e.g., "why is X broken" vs "how does Y work") use different retrieval strategies for optimal chunk selection

### Infrastructure

- [x] **INF-01**: On first run, Braincache detects GPU availability, VRAM amount, and creates a capability profile (tier, supported features)
- [x] **INF-02**: Braincache gracefully degrades on machines without GPU — falls back to CPU embeddings or defers to Claude
- [x] **INF-03**: Embedding model is auto-selected based on detected VRAM tier (larger model for more VRAM, smaller for less)
- [x] **INF-04**: All logging uses stderr exclusively — stdout is reserved for MCP stdio transport

### MCP Server

- [ ] **MCP-01**: Braincache exposes an MCP server via stdio transport discoverable by Claude Code
- [ ] **MCP-02**: `index_repo` tool accepts a path and indexes the codebase, returning status and file count
- [ ] **MCP-03**: `search_codebase` tool accepts a query string and returns top-N relevant chunks with scores
- [ ] **MCP-04**: `build_context` tool accepts a query and optional token budget, returns assembled context with metadata
- [ ] **MCP-05**: `doctor` tool returns system health: Ollama status, index freshness, model loaded, VRAM available

### CLI

- [ ] **CLI-01**: `braincache init` detects hardware, pulls required Ollama model, creates config directory
- [ ] **CLI-02**: `braincache index [path]` indexes a directory with progress output
- [ ] **CLI-03**: `braincache doctor` reports system health in human-readable format
- [ ] **CLI-04**: `braincache status` shows index stats: files indexed, chunks stored, last indexed time, embedding model

### Claude Integration

- [ ] **CLD-01**: `ask-codebase` workflow accepts a question, retrieves context locally, sends minimal context to Claude via Anthropic SDK, and returns Claude's reasoning answer
- [ ] **CLD-02**: Claude receives only the assembled context (not raw chunks), preserving token efficiency

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Incremental Indexing

- **INC-01**: File watcher detects changes and re-indexes only modified files
- **INC-02**: Content-hash based stale detection (re-index only when file content changes)

### Custom Exclusions

- **EXC-01**: `.braincacheignore` file for project-specific exclusion patterns beyond `.gitignore`

### Advanced Retrieval

- **ADV-01**: Configurable retrieval depth per query type
- **ADV-02**: Cross-file dependency-aware retrieval (follow imports)

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Web UI / dashboard | CLI and MCP tools are the interfaces — no browser frontend |
| Chat interface | Claude Code's conversation loop handles chat — Braincache is a tool layer |
| Autocomplete / inline completions | That's Cursor/Copilot's domain — different product category |
| Multi-provider LLM routing | Only Ollama (local) + Claude — two providers, no more |
| Plugin / extension system | Premature generalization — hardcode what works |
| Multi-agent orchestration | Single orchestrator pattern — one workflow per tool call |
| Code generation | Claude generates code — Braincache retrieves and compresses context |
| Cross-machine sync | Local-only — indexes live where the code lives |
| LSP integration | tree-sitter AST parsing is sufficient for context retrieval |
| Reranking with second LLM | Adds latency and VRAM — vector similarity scores are sufficient |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| INF-01 | Phase 1 | Complete |
| INF-02 | Phase 1 | Complete |
| INF-03 | Phase 1 | Complete |
| INF-04 | Phase 1 | Complete |
| IDX-01 | Phase 2 | Complete |
| IDX-02 | Phase 2 | Complete |
| IDX-03 | Phase 2 | Complete |
| IDX-04 | Phase 2 | Complete |
| IDX-05 | Phase 2 | Complete |
| RET-01 | Phase 3 | Complete |
| RET-02 | Phase 3 | Complete |
| RET-03 | Phase 3 | Complete |
| RET-04 | Phase 3 | Complete |
| RET-05 | Phase 3 | Complete |
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

**Coverage:**
- v1 requirements: 22 total
- Mapped to phases: 22
- Unmapped: 0

---
*Requirements defined: 2026-03-31*
*Last updated: 2026-03-31 after roadmap creation*
