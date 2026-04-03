# Requirements: Brain-Cache

**Defined:** 2026-04-03
**Core Value:** Reduce Claude token usage and improve response quality by running embeddings, retrieval, and context building locally — Claude only sees what matters.

## v2.2 Requirements

Requirements for Retrieval Quality milestone. Each maps to roadmap phases.

### Retrieval Accuracy

- [ ] **RET-01**: Keyword boost weight is tunable per intent mode (lookup: 0.40, explore: 0.10, trace: 0.20) so that query-term matches rank proportionally higher in modes where the user names a specific symbol
- [ ] **RET-02**: Chunks whose file name or symbol name matches a query term have their similarity score promoted above the 0.85 high-relevance threshold, preventing compression of the most relevant results
- [x] **RET-03**: trace_flow resolves the entry point via exact SQL name lookup on the chunks table before falling back to vector search, so verbose queries like "how does chunkFile work" anchor to the correct function

### Output Quality

- [x] **OUT-01**: trace_flow hop serialization emits each callee exactly once per hop — no duplicated callsFound entries in the output
- [ ] **OUT-02**: Token savings are only reported when the result is non-empty and relevant — trace_flow with zero hops or wrong-seed results reports no savings instead of a fabricated percentage

### Search Noise

- [x] **NOISE-01**: Build tool config files (vitest.config, tsup.config, tsconfig, jest.config, eslint.config) receive a score penalty in search results unless the query explicitly mentions the tool name

### Tool Routing

- [ ] **ROUTE-01**: MCP tool descriptions include explicit negative examples ("Do NOT use this tool when...") and CLAUDE.md routing table is refined so Claude selects build_context for code understanding queries instead of defaulting to trace_flow

## Future Requirements

Deferred to future release. Tracked but not in current roadmap.

### Advanced Retrieval

- **RANK-01**: Cross-encoder reranking for improved relevance (from v2.1 active backlog)
- **FTS-01**: LanceDB full-text search for hybrid vector+keyword retrieval (deferred to v2.3 per research)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Cross-encoder reranking model | Heavy dependency, deferred — keyword boost covers v2.2 gap |
| LanceDB FTS index | Requires re-indexing all repos; keyword boost sufficient for v2.2 |
| BM25 scoring | Over-engineered for current scale; score penalty is simpler |
| New MCP tools | v2.2 is refinement of existing tools, not new capabilities |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| RET-01 | Phase 24 | Pending |
| RET-02 | Phase 24 | Pending |
| RET-03 | Phase 22 | Complete |
| OUT-01 | Phase 22 | Complete |
| OUT-02 | Phase 24 | Pending |
| NOISE-01 | Phase 23 | Complete |
| ROUTE-01 | Phase 25 | Pending |

**Coverage:**
- v2.2 requirements: 7 total
- Mapped to phases: 7
- Unmapped: 0

---
*Requirements defined: 2026-04-03*
*Last updated: 2026-04-03 — traceability filled in after roadmap creation*
