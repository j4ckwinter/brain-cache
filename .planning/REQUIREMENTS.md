# Requirements: Brain-Cache

**Defined:** 2026-04-01
**Core Value:** Reduce Claude token usage and improve response quality by running embeddings, retrieval, and context building locally — Claude only sees what matters.

## v1.2 Requirements

Requirements for MCP Tool Adoption milestone. Each maps to roadmap phases.

### Tool Descriptions

- [x] **DESC-01**: `search_codebase` description communicates semantic search advantage over grep/file-find and specifies best-fit queries (symbol lookup, function finding, quick exploration)
- [x] **DESC-02**: `build_context` description positions it as producing Claude-ready, deduplicated, token-budgeted context and specifies best-fit queries (how does X work, explain architecture, multi-file reasoning)
- [x] **DESC-03**: `index_repo` description clearly states it is a prerequisite that enables all other brain-cache tools
- [x] **DESC-04**: `doctor` description communicates it as the diagnostic/troubleshooting entry point for brain-cache health

### Tool Positioning

- [x] **POS-01**: Descriptions emphasise semantic (embedding-based) retrieval over naive keyword/file search
- [x] **POS-02**: Descriptions highlight relevance-ranked, token-efficient results as advantages over reading raw files

### Role Clarity

- [x] **ROLE-01**: `search_codebase` and `build_context` descriptions make their distinct use cases unambiguous (search = find code, context = answer questions)
- [x] **ROLE-02**: Descriptions include implicit guidance for Claude to prefer brain-cache tools and to combine tools when needed (e.g., build_context before answering complex questions)

## Future Requirements

### Advanced Adoption

- **ADV-03**: MCP server metadata (name, description) updated to reinforce brain-cache positioning
- **ADV-04**: Input parameter descriptions improved with usage hints

## Out of Scope

| Feature | Reason |
|---------|--------|
| New MCP tools | Milestone focuses on existing tool descriptions only |
| Backend logic changes | DX/prompting improvement, not architecture change |
| Repo-specific hardcoding | Descriptions must be generic across any codebase |
| Claude system prompt changes | Only MCP tool descriptions are in scope |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| DESC-01 | Phase 13 | Complete |
| DESC-02 | Phase 13 | Complete |
| DESC-03 | Phase 13 | Complete |
| DESC-04 | Phase 13 | Complete |
| POS-01 | Phase 13 | Complete |
| POS-02 | Phase 13 | Complete |
| ROLE-01 | Phase 13 | Complete |
| ROLE-02 | Phase 13 | Complete |
| DEBT-04 (v1.1) | Phase 14 | Pending (gap closure) |

**Coverage:**
- v1.2 requirements: 8 total, mapped: 8, unmapped: 0
- v1.1 gap closure: 1 (DEBT-04 barrel completeness → Phase 14)

---
*Requirements defined: 2026-04-01*
*Last updated: 2026-04-01 — traceability updated after v1.2 roadmap creation*
