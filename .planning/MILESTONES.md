# Milestones

## v1.1 Hardening (Shipped: 2026-04-01)

**Phases completed:** 7 phases, 11 plans, 9 tasks

**Key accomplishments:**

- Task 1 — Workflow error contracts (HARD-01):
- Ollama service now reads OLLAMA_HOST env var with localhost fallback, pino logger redacts API key values at log time, and all three barrel files (lib, services, tools) export real symbols instead of empty `export {}`
- SHA-256 content-hash diffing for brain-cache index: only new and changed files re-embedded, stale chunks deleted, with --force flag for full reindex escape hatch
- Three-tier classifyQueryIntent with DIAGNOSTIC_BIGRAMS and DIAGNOSTIC_EXCLUSIONS reduces false positive diagnostic classifications for "error handler", "undefined behavior", and "null object pattern" queries
- Concurrent file I/O (Promise.all groups of 20) and streaming group-based chunk pipeline restored in index workflow, eliminating allChunks accumulator and redundant post-loop token counting
- MCP index_repo force reindex wired, OLLAMA_HOST remote spawn guard added with getOllamaHost() utility, tools barrel documented as intentionally empty

---

## v1.0 MVP (Shipped: 2026-04-01)

**Phases completed:** 5 phases, 14 plans, 22 tasks
**Timeline:** 1 day (2026-03-31)
**Lines of code:** 2,045 TypeScript (src/)
**Tests:** 224 passing

**Key accomplishments:**

- Foundation layer with stderr-only pino logger, GPU/VRAM detection, tier classification, and Ollama lifecycle management with graceful CPU fallback
- AST-aware indexing via tree-sitter for TS/JS/Python/Go/Rust with Ollama batch embedder and LanceDB vector storage
- Smart retrieval pipeline with cosine similarity, deduplication, intent classification, token-budgeted context assembly, and savings metadata
- stdio MCP server with 4 tools (index_repo, search_codebase, build_context, doctor) discoverable by Claude Code
- ask-codebase workflow sending only assembled context to Claude via Anthropic SDK
- Polished CLI: init with model warm-up, index with progress/savings, doctor with actionable messages, status with index stats

**Archive:** [v1.0-ROADMAP.md](milestones/v1.0-ROADMAP.md) | [v1.0-REQUIREMENTS.md](milestones/v1.0-REQUIREMENTS.md) | [v1.0-MILESTONE-AUDIT.md](milestones/v1.0-MILESTONE-AUDIT.md)

---

## v1.1 Hardening (Shipped: 2026-04-01)

**Phases completed:** 5 phases (6-10), 9 plans, 17 requirements
**Timeline:** 1 day (2026-04-01)
**Lines of code:** 2,472 TypeScript (src/) — +427 from v1.0
**Tests:** 265 passing (+41 from v1.0)

**Key accomplishments:**

- Error propagation cleanup: all workflow `process.exit(1)` replaced with thrown errors, CLI catches at top level (HARD-01)
- Runtime config: version from package.json, OLLAMA_HOST env var support, populated barrel exports (DEBT-02, DEBT-03, DEBT-04)
- Security: pino log redaction for API keys, Ollama PID tracking with signal handlers and orphan prevention (SEC-01, SEC-02)
- Type safety: eliminated `any` types in tree-sitter/LanceDB interop, exact model name matching, documented CJS hack (DEBT-05, DEBT-06, BUG-01, HARD-02, HARD-03)
- Performance: concurrent file I/O (20 parallel), streaming chunk pipeline, IVF-PQ vector index, separator token caching (PERF-01–04)
- Incremental indexing: SHA-256 content hashing, skip unchanged files, delete stale chunks, --force flag (DEBT-01)
- Intent classification: diagnostic bigrams + exclusion patterns reduce false positives (HARD-04)

**Archive:** [v1.1-MILESTONE-AUDIT.md](milestones/v1.1-MILESTONE-AUDIT.md)

---
