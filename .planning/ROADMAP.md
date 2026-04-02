# Roadmap: Brain-Cache

**Project:** Brain-Cache
**Core Value:** Reduce Claude token usage and improve response quality by running embeddings, retrieval, and context building locally

---

## Milestones

- ✅ **v1.0 MVP** — Phases 1-5 (shipped 2026-04-01) — [archive](milestones/v1.0-ROADMAP.md)
- ✅ **v1.1 Hardening** — Phases 6-12 (shipped 2026-04-01) — [archive](milestones/v1.1-ROADMAP.md)
- 🔄 **v1.1.1 Post-Ship Cleanup** — Phase 14 (gap closure)
- 🔄 **v1.2 MCP Tool Adoption** — Phases 13 (active)

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

**v1.1.1 Post-Ship Cleanup (Phase 14)**

- [x] **Phase 14: Test Suite & Barrel Repair** - Fix 13 test failures from mock drift and update stale barrel exports — completed 2026-04-02

**v1.2 MCP Tool Adoption (Phase 13)**

- [ ] **Phase 13: MCP Tool Description Rewrite** - Rewrite all four MCP tool descriptions to make Claude naturally prefer brain-cache tools

## Phase Details

### Phase 14: Test Suite & Barrel Repair
**Goal**: Fix all test failures caused by Phase 9/10 interface changes and complete barrel exports
**Depends on**: Phase 12 (source of the drift)
**Requirements**: DEBT-04 (barrel completeness)
**Gap Closure**: Closes gaps from v1.1 milestone audit
**Success Criteria** (what must be TRUE):
  1. All 13 failing tests pass (`vitest run` exits 0, excluding tree-sitter arch issues)
  2. `src/services/index.ts` re-exports all Phase 9/10 public symbols
  3. `src/lib/index.ts` re-exports all Phase 9/10 config constants
**Plans**: 1 plan
Plans:
- [x] 14-01-PLAN.md — Fix test failures, revert config drift, complete barrel exports — completed 2026-04-02

### Phase 13: MCP Tool Description Rewrite
**Goal**: Claude naturally chooses brain-cache MCP tools over built-in file search when answering codebase questions
**Depends on**: Phase 12 (MCP server fully functional)
**Requirements**: DESC-01, DESC-02, DESC-03, DESC-04, POS-01, POS-02, ROLE-01, ROLE-02
**Success Criteria** (what must be TRUE):
  1. Claude selects `search_codebase` instead of grep or file-find tools when asked to locate a function, symbol, or concept in the codebase
  2. Claude calls `build_context` before answering complex "how does X work" or architecture questions rather than reading individual files
  3. Claude calls `index_repo` first when no index exists, understanding it is a prerequisite for all other tools
  4. Claude calls `doctor` when diagnosing brain-cache problems rather than inspecting config files manually
  5. When Claude must choose between `search_codebase` and `build_context`, the distinct use cases are clear without user guidance
**Plans**: 1 plan
Plans:
- [ ] 13-01-PLAN.md — Rewrite all 4 MCP tool descriptions with directive tone, cross-references, and advantage positioning

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
| 13. MCP Tool Description Rewrite | v1.2 | 0/1 | Not started | - |
| 14. Test Suite & Barrel Repair | v1.1.1 | 1/1 | Complete | 2026-04-02 |

---
*Roadmap created: 2026-03-31*
*Last updated: 2026-04-01 — Phase 13 planned (1 plan)*
