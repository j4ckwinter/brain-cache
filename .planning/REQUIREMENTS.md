# Requirements: Brain-Cache

**Defined:** 2026-04-03
**Core Value:** Reduce Claude token usage and improve response quality by running embeddings, retrieval, and context building locally — Claude only sees what matters.

## v2.1 Requirements

Requirements for Presentation Magic milestone. Each maps to roadmap phases.

### Formatter Foundation

- [x] **FMT-01**: All MCP tools route output through a shared `formatToolResponse` function that produces a consistent envelope (summary + body + metadata)
- [x] **FMT-02**: Every tool response begins with a one-sentence summary line that immediately answers the user's question

### Tool Renderers

- [x] **REND-01**: `search_codebase` returns a numbered ranked list with score, file path, line number, symbol name, and chunk type instead of raw JSON
- [x] **REND-02**: `trace_flow` returns numbered hops showing hop depth, file path, line number, symbol name, and calls-found list instead of raw JSON
- [x] **REND-03**: `doctor` returns a fixed-width health dashboard showing service status instead of raw JSON
- [x] **REND-04**: `index_repo` returns a single-line completion summary instead of raw JSON

### Metadata & Errors

- [ ] **META-01**: Token savings metadata footer appears consistently on all 4 retrieval tools (search_codebase, build_context, trace_flow, explain_codebase)
- [x] **META-02**: All 6 tools use a consistent error envelope with Error label, message, and optional Suggestion line
- [ ] **META-03**: Retrieval tools show a pipeline label in the metadata footer summarising local tasks performed

## v2.0 Requirements (Validated)

### Flow Tracing

- [x] **FLOW-01**: Multi-hop flow tracing follows call/import paths across files via AST extraction with configurable hop depth (default 3)
- [x] **FLOW-02**: `trace_flow` MCP tool exposes flow tracing to Claude with structured hop output

### Retrieval Intelligence

- [x] **INTENT-01**: Intent-aware retrieval modes (lookup/trace/explore) with distinct k, distance threshold, and post-processing per mode
- [x] **ADV-01**: Configurable retrieval depth per query type via config and MCP tool input overrides

### Context Quality

- [x] **COH-01**: Context cohesion groups chunks by file/module, preserves source ordering
- [x] **COMP-01**: Context compression via structural truncation — keep signatures, strip bodies
- [x] **TOOL-02**: `explain_codebase` MCP tool returns module-grouped architecture summaries

### Infrastructure

- [x] **INC-02**: File watcher via chokidar v5 with debounce and automatic incremental re-indexing
- [x] **EXC-01**: `.braincacheignore` custom exclusion patterns parsed alongside `.gitignore`

### Adoption

- [x] **ADOPT-01**: CLAUDE.md refinements to guide Claude toward new MCP tools with routing guidance

## Future Requirements

### Advanced Retrieval (v2.x)

- **RANK-01**: Cross-encoder reranking for improved relevance (deferred — Ollama has no native rerank endpoint)
- **ADV-03**: MCP server metadata (name, description) updated to reinforce brain-cache positioning
- **ADV-04**: Input parameter descriptions improved with usage hints

## Out of Scope

| Feature | Reason |
|---------|--------|
| Emoji status indicators | CLAUDE.md no-emojis constraint; inconsistent rendering in tool panels |
| ANSI colour codes | MCP text content not rendered in terminal; 50-80% token inflation |
| Structured content field | MCP spec proposal not finalised; no practical benefit today |
| Per-tool output format toggle | MCP tools consumed by LLM, not scripts; no use case |
| Streaming/incremental output | MCP stdio buffers complete responses; not protocol-supported |
| Markdown tables in output | Render as raw pipe characters in many Claude Code contexts |
| Workflow/service changes | Presentation layer only; formatters sit in lib/ and mcp/ |
| Second LLM call for reranking | Adds cloud latency and cost; defeats local-first purpose |
| Graph database for call relationships | Requires external server; violates no-server constraint |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| FMT-01 | Phase 20 | Complete |
| FMT-02 | Phase 20 | Complete |
| REND-01 | Phase 20 | Complete |
| REND-02 | Phase 20 | Complete |
| REND-03 | Phase 20 | Complete |
| REND-04 | Phase 20 | Complete |
| META-01 | Phase 21 | Pending |
| META-02 | Phase 20 | Complete |
| META-03 | Phase 21 | Pending |

**Coverage:**
- v2.1 requirements: 9 total
- Mapped to phases: 9
- Unmapped: 0

---
*Requirements defined: 2026-04-03*
*Last updated: 2026-04-03 — traceability updated after v2.1 roadmap creation*
