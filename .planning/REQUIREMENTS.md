# Requirements: Brain-Cache

**Defined:** 2026-04-07
**Core Value:** Reduce Claude token usage and improve response quality by running embeddings, retrieval, and context building locally — Claude only sees what matters.

## v3.6 Requirements

Requirements for Concerns Cleanup milestone. Each maps to roadmap phases.

### Critical Issues

- [x] **CRIT-01**: Stderr filtering uses a centralized stack-based utility instead of direct monkey-patching in index and watch workflows
- [x] **CRIT-02**: Auto-index trigger uses typed `NoIndexError` class with `instanceof` check instead of string matching

### Technical Debt

- [x] **DEBT-01**: Index workflow (`runIndex`) is decomposed into named pipeline stage functions (stat-partition, file-diff, chunk-embed, git-history)
- [x] **DEBT-02**: Deprecated `classifyQueryIntent` export removed from services barrel and test references updated
- [x] **DEBT-03**: Empty `src/tools/` directory removed or populated with extracted tool handlers
- [x] **DEBT-04**: LanceDB connection pool has TTL-based eviction and connection health validation

### Performance

- [x] **PERF-01**: Keyword fallback search uses SQL LIKE predicates or cursor-based pagination instead of loading entire table
- [x] **PERF-02**: Staleness check reuses batched stat approach from index workflow instead of individual file stats
- [x] **PERF-03**: Embedding batch fallback uses binary search to isolate problematic chunks instead of one-at-a-time

### Security

- [x] **SEC-01**: SQL predicates in LanceDB operations use comprehensive escaping or parameterized queries
- [x] **SEC-02**: Path validation blocklist includes home directory root and filesystem root
- [x] **SEC-03**: `askCodebase` validates ANTHROPIC_API_KEY before context building begins

### Missing Functionality

- [ ] **FEAT-01**: Edge graph traversal is wired into trace retrieval path, expanding results by following call edges from matched chunks
- [ ] **FEAT-02**: `brain-cache clean` CLI command removes stale `.brain-cache/` directories
- [ ] **FEAT-03**: Watch mode MCP design decision documented (CLI-only is intentional)

### Dependencies

- [ ] **DEP-01**: apache-arrow upgraded from v18 to v21 with LanceDB compatibility verified
- [ ] **DEP-02**: web-tree-sitter upgraded from ~0.25.10 to 0.26.x with WASM grammar compatibility verified
- [ ] **DEP-03**: vitest upgraded from v2 to v4 with all tests passing
- [ ] **DEP-04**: TypeScript upgraded from 5.9 to 6.0 with breaking changes resolved

### Test Coverage

- [ ] **TEST-01**: Integration test for nested stderr patching (watch triggering index)
- [ ] **TEST-02**: Integration test for keyword fallback search when Ollama is unavailable
- [ ] **TEST-03**: Performance/behavior test for keyword search on large chunk tables (>10k rows)

## Future Requirements

None deferred — all concerns scoped to this milestone.

## Out of Scope

| Feature | Reason |
|---------|--------|
| New MCP tools beyond current 4 | This milestone is cleanup, not feature expansion |
| Reranking with second LLM | Explicitly out of scope per PROJECT.md |
| Multi-language grammar additions | Separate concern from current 5-language support |
| Remote/cloud deployment support | Local-only tool by design |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| CRIT-01 | Phase 55 | Complete |
| CRIT-02 | Phase 55 | Complete |
| DEBT-01 | Phase 56 | Complete |
| DEBT-02 | Phase 56 | Complete |
| DEBT-03 | Phase 56 | Complete |
| DEBT-04 | Phase 56 | Complete |
| PERF-01 | Phase 57 | Complete |
| PERF-02 | Phase 57 | Complete |
| PERF-03 | Phase 57 | Complete |
| SEC-01 | Phase 58 | Complete |
| SEC-02 | Phase 58 | Complete |
| SEC-03 | Phase 58 | Complete |
| FEAT-01 | Phase 59 | Pending |
| FEAT-02 | Phase 59 | Pending |
| FEAT-03 | Phase 59 | Pending |
| DEP-01 | Phase 60 | Pending |
| DEP-02 | Phase 60 | Pending |
| DEP-03 | Phase 60 | Pending |
| DEP-04 | Phase 60 | Pending |
| TEST-01 | Phase 61 | Pending |
| TEST-02 | Phase 61 | Pending |
| TEST-03 | Phase 61 | Pending |

**Coverage:**
- v3.6 requirements: 22 total
- Mapped to phases: 22
- Unmapped: 0 ✓

---
*Requirements defined: 2026-04-07*
*Last updated: 2026-04-07 — traceability mapped to phases 55-61*
