# Requirements: Brain-Cache

**Defined:** 2026-04-03
**Core Value:** Reduce Claude token usage and improve response quality by running embeddings, retrieval, and context building locally — Claude only sees what matters.

## v2.3 Requirements

Requirements for Final Quality Pass milestone. Each maps to roadmap phases.

### Search Precision

- [x] **PREC-01**: search_codebase boosts results where the chunk's function/variable name is an exact or near-exact match to a query term, ranking them above semantically similar but differently-named symbols
- [x] **PREC-02**: search_codebase boosts results from files whose name matches a query term (e.g. "compression service" finds compression.ts)

### Compression Protection

- [ ] **COMP-01**: build_context protects chunks whose file or symbol name matches the query from body compression, spending token budget on the primary result first
- [ ] **COMP-02**: build_context drops test file chunks and config file chunks before compressing any production source file that directly answers the query

### Trace Quality

- [ ] **TRACE-01**: trace_flow excludes test files from BFS traversal
- [ ] **TRACE-02**: trace_flow filters native/standard library calls from hop lists
- [ ] **TRACE-03**: trace_flow surfaces a confidence warning when seed search similarity is below threshold, instead of silently tracing the nearest unrelated match
- [ ] **TRACE-04**: trace_flow prefers CLI entry files as seeds when the query mentions CLI entrypoints

### Explain Quality

- [ ] **EXPL-01**: explain_codebase includes behavioral summaries for key modules, prioritizing exports and cross-cutting wiring over internal helpers

## v2.2 Requirements (Complete)

<details>
<summary>All 7 requirements complete</summary>

### Retrieval Accuracy

- [x] **RET-01**: Keyword boost weight is tunable per intent mode (lookup: 0.40, explore: 0.10, trace: 0.20) so that query-term matches rank proportionally higher in modes where the user names a specific symbol
- [x] **RET-02**: Chunks whose file name or symbol name matches a query term have their similarity score promoted above the 0.85 high-relevance threshold, preventing compression of the most relevant results
- [x] **RET-03**: trace_flow resolves the entry point via exact SQL name lookup on the chunks table before falling back to vector search, so verbose queries like "how does chunkFile work" anchor to the correct function

### Output Quality

- [x] **OUT-01**: trace_flow hop serialization emits each callee exactly once per hop — no duplicated callsFound entries in the output
- [x] **OUT-02**: Token savings are only reported when the result is non-empty and relevant — trace_flow with zero hops or wrong-seed results reports no savings instead of a fabricated percentage

### Search Noise

- [x] **NOISE-01**: Build tool config files (vitest.config, tsup.config, tsconfig, jest.config, eslint.config) receive a score penalty in search results unless the query explicitly mentions the tool name

### Tool Routing

- [x] **ROUTE-01**: MCP tool descriptions include explicit negative examples ("Do NOT use this tool when...") and CLAUDE.md routing table is refined so Claude selects build_context for code understanding queries instead of defaulting to trace_flow

</details>

## Future Requirements

Deferred to future release. Tracked but not in current roadmap.

### Advanced Retrieval

- **RANK-01**: Cross-encoder reranking for improved relevance (from v2.1 active backlog)
- **FTS-01**: LanceDB full-text search for hybrid vector+keyword retrieval

## Out of Scope

| Feature | Reason |
|---------|--------|
| Cross-encoder reranking model | Heavy dependency, deferred — keyword boost + exact-match covers gap |
| LanceDB FTS index | Requires re-indexing all repos; exact-match SQL lookup covers symbol case |
| BM25 scoring | Over-engineered for current scale; score penalty is simpler |
| New MCP tools | v2.3 is quality refinement of existing tools, not new capabilities |
| Trace branch grouping | Nice-to-have but complex; filtering noise is higher priority |
| External library hop annotation | Would require node_modules traversal; filtering stdlib is sufficient |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| PREC-01 | Phase 26 | Complete |
| PREC-02 | Phase 26 | Complete |
| COMP-01 | Phase 27 | Pending |
| COMP-02 | Phase 27 | Pending |
| TRACE-01 | Phase 28 | Pending |
| TRACE-02 | Phase 28 | Pending |
| TRACE-03 | Phase 28 | Pending |
| TRACE-04 | Phase 28 | Pending |
| EXPL-01 | Phase 29 | Pending |

**Coverage:**
- v2.3 requirements: 9 total
- Mapped to phases: 9
- Unmapped: 0

---
*Requirements defined: 2026-04-03*
*Last updated: 2026-04-03 — v2.3 traceability complete (all 9 requirements mapped to Phases 26-29)*
