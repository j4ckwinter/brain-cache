# Requirements: Brain-Cache

**Defined:** 2026-04-02
**Core Value:** Reduce Claude token usage and improve response quality by running embeddings, retrieval, and context building locally — Claude only sees what matters.

## v2.0 Requirements

Requirements for MCP Magic milestone. Each maps to roadmap phases.

### Flow Tracing

- [x] **FLOW-01**: Multi-hop flow tracing follows call/import paths across files via AST extraction with configurable hop depth (default 3)
- [ ] **FLOW-02**: `trace_flow` MCP tool exposes flow tracing to Claude with structured hop output (filePath, name, startLine, content, callsFound per hop)

### Retrieval Intelligence

- [x] **INTENT-01**: Intent-aware retrieval modes (lookup/trace/explore) with distinct k, distance threshold, and post-processing per mode
- [ ] **ADV-01**: Configurable retrieval depth per query type via `~/.brain-cache/config.json` and MCP tool input overrides

### Context Quality

- [ ] **COH-01**: Context cohesion groups chunks by file/module, preserves source ordering, includes parent class when method chunk is selected
- [ ] **COMP-01**: Context compression via structural truncation — keep function/class signatures, strip bodies for chunks exceeding compression threshold
- [ ] **TOOL-02**: `explain_codebase` MCP tool returns module-grouped architecture summaries using explore mode + cohesion

### Infrastructure

- [ ] **INC-02**: File watcher via chokidar v5 with debounce, write mutex, and automatic incremental re-indexing on file save
- [x] **EXC-01**: `.braincacheignore` custom exclusion patterns parsed alongside `.gitignore` at index time

### Adoption

- [ ] **ADOPT-01**: CLAUDE.md refinements to guide Claude toward new MCP tools (trace_flow, explain_codebase) with clear routing guidance

## Future Requirements

### Advanced Retrieval (v2.x)

- **RANK-01**: Cross-encoder reranking for improved relevance (deferred — Ollama has no native rerank endpoint; revisit when available)
- **ADV-03**: MCP server metadata (name, description) updated to reinforce brain-cache positioning
- **ADV-04**: Input parameter descriptions improved with usage hints

## Out of Scope

| Feature | Reason |
|---------|--------|
| Second LLM call for reranking | Adds cloud latency and cost; defeats local-first purpose |
| Full call graph at index time | Hard static analysis problem; stale graph worse than no graph |
| Real-time keystroke-level reindex | Multi-event noise; debounced batch is correct approach |
| Storing summaries alongside chunks at index time | Doubles storage; stale summaries after changes |
| LSP integration | Different protocol; conflicts with MCP stdio |
| Graph database for call relationships | Requires external server; violates no-server constraint |
| LLM-based context compression | Adds latency and second-model dependency; structural truncation sufficient for v2.0 |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| EXC-01 | Phase 15 | Complete |
| FLOW-01 | Phase 16 | Complete |
| INTENT-01 | Phase 16 | Complete |
| COH-01 | Phase 16 | Pending |
| FLOW-02 | Phase 17 | Pending |
| TOOL-02 | Phase 17 | Pending |
| ADV-01 | Phase 17 | Pending |
| COMP-01 | Phase 17 | Pending |
| INC-02 | Phase 18 | Pending |
| ADOPT-01 | Phase 19 | Pending |

**Coverage:**
- v2.0 requirements: 10 total, mapped: 10, unmapped: 0

---
*Requirements defined: 2026-04-02*
*Last updated: 2026-04-02 — v2.0 MCP Magic requirements mapped to Phases 15-19*
