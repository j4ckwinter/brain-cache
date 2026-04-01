# Roadmap: Brain-Cache

**Project:** Brain-Cache
**Core Value:** Reduce Claude token usage and improve response quality by running embeddings, retrieval, and context building locally

---

## Milestones

- ✅ **v1.0 MVP** — Phases 1-5 (shipped 2026-04-01) — [archive](milestones/v1.0-ROADMAP.md)

## Phases

<details>
<summary>✅ v1.0 MVP (Phases 1-5) — SHIPPED 2026-04-01</summary>

- [x] Phase 1: Foundation (3/3 plans) — completed 2026-03-31
- [x] Phase 2: Storage and Indexing (4/4 plans) — completed 2026-03-31
- [x] Phase 3: Retrieval and Context Assembly (3/3 plans) — completed 2026-04-01
- [x] Phase 4: MCP Server and Claude Integration (2/2 plans) — completed 2026-04-01
- [x] Phase 5: CLI Completion (2/2 plans) — completed 2026-04-01

</details>

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
| 10. Incremental Indexing and Intent Classification | v1.1 | 0/0 | Pending | — |

## v1.1 Hardening (Phases 6-10)

### Phase 6: Foundation Cleanup
**Goal:** Fix foundational issues — hardcoded versions, env var support, barrel exports, process.exit removal, API key leak prevention
**Requirements:** HARD-01, DEBT-02, DEBT-03, DEBT-04, SEC-01
**Status:** Complete

| Plan | Title | Status | Completed |
|------|-------|--------|-----------|
| 06-01 | Foundation cleanup | Complete | 2026-04-01 |
| 06-02 | Foundation cleanup (cont.) | Complete | 2026-04-01 |

### Phase 7: Type Safety and Code Correctness
**Goal:** Replace `any` types, eliminate redundant token counting, fix model name matching, document tree-sitter hack, improve arrow function extraction
**Requirements:** DEBT-05, DEBT-06, BUG-01, HARD-02, HARD-03
**Status:** Complete

| Plan | Title | Status | Completed |
|------|-------|--------|-----------|
| 07-01 | Type safety and code correctness | Complete | 2026-04-01 |
| 07-02 | Type safety and code correctness (cont.) | Complete | 2026-04-01 |

### Phase 8: Ollama Process Security
**Goal:** Fix detached Ollama process management — PID tracking, race condition prevention, port check before spawn
**Requirements:** SEC-02
**Status:** Complete

| Plan | Title | Status | Completed |
|------|-------|--------|-----------|
| 08-01 | Ollama process security | Complete | 2026-04-01 |

### Phase 9: Indexing and Retrieval Performance
**Goal:** Parallelize file I/O, stream chunk pipeline, create IVF-PQ vector index, cache separator token count
**Requirements:** PERF-01, PERF-02, PERF-03, PERF-04
**Status:** Complete

| Plan | Title | Status | Completed |
|------|-------|--------|-----------|
| 09-01 | Concurrent file I/O and streaming chunk pipeline | Complete | 2026-04-01 |
| 09-02 | Vector index and separator token caching | Complete | 2026-04-01 |

### Phase 10: Incremental Indexing and Intent Classification
**Goal:** Detect changed/new/removed files via content hashing to only re-embed what changed; improve intent classification with exclusion patterns and bigrams to reduce false positives
**Requirements:** DEBT-01, HARD-04
**Status:** Pending

---
*Roadmap created: 2026-03-31*
*Last updated: 2026-04-01 — v1.1 phases 6-10 fully documented*
