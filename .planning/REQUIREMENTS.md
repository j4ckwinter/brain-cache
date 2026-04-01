# Requirements: Brain-Cache

**Defined:** 2026-04-01
**Core Value:** Reduce Claude token usage and improve response quality by running embeddings, retrieval, and context building locally

## v1.1 Requirements

Requirements for the hardening milestone. Each maps to roadmap phases.

### Tech Debt

- [ ] **DEBT-01**: Incremental indexing — detect changed/new/removed files via content hashing, only re-embed what changed
- [x] **DEBT-02**: Source version string from package.json instead of hardcoding '0.1.0'
- [x] **DEBT-03**: Respect OLLAMA_HOST env var for Ollama server URL with localhost:11434 fallback
- [x] **DEBT-04**: Remove or populate empty barrel export files (tools, services, lib)
- [ ] **DEBT-05**: Replace `any` types in tree-sitter and LanceDB interop with proper local interfaces
- [ ] **DEBT-06**: Eliminate redundant token counting in index workflow — count once during chunking

### Bugs

- [ ] **BUG-01**: Fix model name matching to handle explicit tags and prevent false prefix matches

### Security

- [x] **SEC-01**: Ensure API keys never leak to pino logs or debug output
- [ ] **SEC-02**: Fix detached Ollama process management — PID tracking, race condition prevention, port check before spawn

### Performance

- [ ] **PERF-01**: Parallelize file I/O during indexing with concurrency limiter
- [ ] **PERF-02**: Stream chunk pipeline to cap memory — process in batches instead of accumulating all chunks
- [ ] **PERF-03**: Create IVF-PQ vector index on LanceDB table when chunk count exceeds threshold
- [ ] **PERF-04**: Cache separator token count — compute once outside loop, not per-chunk

### Hardening

- [x] **HARD-01**: Replace all `process.exit(1)` calls with thrown errors; let CLI entry point handle exit
- [ ] **HARD-02**: Document tree-sitter CJS require() hack with inline comments explaining why and when it can be removed
- [ ] **HARD-03**: Improve arrow function extraction — use parent node types instead of raw depth counting
- [ ] **HARD-04**: Improve intent classification — add exclusion patterns and bigrams to reduce false positives

## Future Requirements

Deferred to future milestones. Tracked but not in current roadmap.

### Missing Features (from concerns audit)

- **FEAT-01**: Watch mode for auto-indexing on file changes
- **FEAT-02**: System prompt for ask-codebase workflow
- **FEAT-03**: Re-ranking of retrieved chunks (keyword boosting, recency)
- **FEAT-04**: Staleness detection — warn when index is outdated
- **FEAT-05**: Markdown/text file support for non-code documentation

### Test Coverage

- **TEST-01**: Doctor workflow unit tests
- **TEST-02**: LanceDB service unit tests
- **TEST-03**: Integration/E2E tests (requires Ollama)
- **TEST-04**: MCP server integration tests
- **TEST-05**: Arrow function depth boundary tests

## Out of Scope

| Feature | Reason |
|---------|--------|
| New user-facing features | v1.1 is hardening only — no new capabilities |
| web-tree-sitter migration | Works fine as CJS; migration is risky for low reward |
| Dependency upgrades | Pre-1.0 deps are stable; pin versions, don't upgrade |
| Cross-machine sync | Local-only by design |
| Additional language support | Current 5 languages sufficient for v1.x |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| DEBT-01 | Phase 10 | Pending |
| DEBT-02 | Phase 6 | Complete |
| DEBT-03 | Phase 6 | Complete |
| DEBT-04 | Phase 6 | Complete |
| DEBT-05 | Phase 7 | Pending |
| DEBT-06 | Phase 7 | Pending |
| BUG-01 | Phase 7 | Pending |
| SEC-01 | Phase 6 | Complete |
| SEC-02 | Phase 8 | Pending |
| PERF-01 | Phase 9 | Pending |
| PERF-02 | Phase 9 | Pending |
| PERF-03 | Phase 9 | Pending |
| PERF-04 | Phase 9 | Pending |
| HARD-01 | Phase 6 | Complete |
| HARD-02 | Phase 7 | Pending |
| HARD-03 | Phase 7 | Pending |
| HARD-04 | Phase 10 | Pending |

**Coverage:**
- v1.1 requirements: 17 total
- Mapped to phases: 17
- Unmapped: 0

---
*Requirements defined: 2026-04-01*
*Last updated: 2026-04-01 after v1.1 roadmap creation*
