# Requirements: Brain-Cache

**Defined:** 2026-04-05
**Core Value:** Reduce Claude token usage and improve response quality by running embeddings, retrieval, and context building locally — Claude only sees what matters.

## v3.4 Requirements

Requirements for Codebase Hardening milestone. Each maps to roadmap phases.

### Correctness & Security

- [x] **COR-01**: Zero-vector chunks are excluded from search results at query time
- [x] **COR-02**: MCP tool path inputs are validated to stay within the working directory
- [x] **COR-03**: Concurrent index operations on the same project are serialized via advisory lockfile
- [x] **COR-04**: Token savings estimation uses file-content-based computation across all tools (no magic multipliers)

### Tech Debt

- [x] **DEBT-01**: MCP tool handlers use a shared `withGuards()` wrapper for profile/Ollama checks and auto-index retry
- [x] **DEBT-02**: Workflow functions use shared `requireProfile()` and `requireOllama()` guard helpers
- [x] **DEBT-03**: MCP server is instantiated via `createMcpServer()` factory function (not module-level singleton)
- [x] **DEBT-04**: `init.ts` uses async `fs/promises` instead of synchronous file operations
- [x] **DEBT-05**: stderr monkey-patch in `runIndex` is documented or replaced with LanceDB log config
- [x] **DEBT-06**: Token counting per chunk happens once during the filter step (no redundant calls)
- [x] **DEBT-07**: Parser instances are cached per language in a module-level Map (not created per file)

### Performance

- [x] **PERF-01**: LanceDB connections are cached in a module-level Map and reused across operations
- [x] **PERF-02**: Chunk deletions during incremental re-index use batched SQL predicates
- [x] **PERF-03**: `buildContext` reads per-file token counts from index state instead of re-reading files

### Missing Features

- [x] **FEAT-01**: Index staleness is detected by comparing `indexedAt` timestamp against file modification times and surfaced as a warning
- [x] **FEAT-02**: Markdown, text, and RST files are indexed using heading-boundary chunking via marked Lexer
- [x] **FEAT-03**: When Ollama is unavailable, search falls back to keyword matching against chunk metadata
- [x] **FEAT-04**: Crawler's `SOURCE_EXTENSIONS` includes `.md`, `.txt`, and `.rst` extensions

### Test Coverage

- [x] **TEST-01**: E2E pipeline test covers index → search → build_context in a tmpdir with mocked embedder (full `brain-cache init` is not exercised — it requires live Ollama)
- [x] **TEST-02**: CLI integration tests cover Commander argument parsing, option coercion, and error handling
- [x] **TEST-03**: MCP auto-index retry path is tested (fresh project triggers index then retries)
- [x] **TEST-04**: Edge deletion during incremental re-index is tested with file removal scenarios
- [x] **TEST-05**: Embedding dimension fallback path is tested for unknown models
- [x] **TEST-06**: askCodebase error paths are tested (API failures, rate limits, missing key)

### Refactoring

- [x] **REFAC-01**: `src/workflows/index.ts` is split into named sub-functions (computeFileDiffs, processFileGroup, printSummary)
- [x] **REFAC-02**: `src/mcp/index.ts` tool handlers are extracted into individual handler files or use withGuards to reduce per-handler size
- [x] **REFAC-03**: Token savings computation is unified into a single `computeTokenSavings()` utility

## v3.5 Requirements

Requirements for **Daily Adoption** milestone (Phases 48–51). See [.planning/milestones/v3.5-REQUIREMENTS.md](milestones/v3.5-REQUIREMENTS.md) for the archived snapshot.

### Incremental performance

- [x] **DAILY-01**: Incremental `brain-cache index` skips full-file reads for files whose stored stat fingerprint matches the current filesystem — full hash when fingerprint differs or on `--force`

### Watch and services

- [x] **DAILY-02**: `brain-cache watch [path]` runs a debounced file watcher that invokes incremental index and respects the project index lock
- [x] **DAILY-03**: Documented opt-in install for a user-level background service that runs the watcher; documented disable/uninstall

### Git history

- [ ] **DAILY-04**: Git commits (messages + touched paths, within configured limits) are embedded and searchable; retrieval surfaces provenance distinguishing history chunks from file chunks

---

## Future Requirements

### Scaling

- **SCALE-01**: In-memory file content map releases content after each group is processed
- **SCALE-02**: Embedding batch size adapts based on available VRAM
- **SCALE-03**: File hash manifest migrates from JSON to SQLite or LanceDB metadata table
- **SCALE-04**: Session stats uses per-project files or advisory locking for cross-process safety

### Fragile Areas

- **FRAG-01**: Arrow function chunking heuristic has integration tests for edge cases (export default, declare const)
- **FRAG-02**: currentChunkId tracking uses a scope stack instead of mutable variable
- **FRAG-03**: Query intent classification uses scoring system instead of first-match
- **FRAG-04**: Embedding dimensions are queried from Ollama via test embed call during init

## Out of Scope

| Feature | Reason |
|---------|--------|
| LanceDB parameterized queries | All query inputs originate from trusted internal sources; manual escaping is sufficient |
| Replace stderr monkey-patch entirely | LanceDB TS SDK has no log level config API; documenting is sufficient |
| Replace in-memory file content map | Current capacity handles typical projects; scaling path is future work |
| Session stats cross-process locking | Per-project files are a scaling concern, not a v3.4 priority |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| COR-01 | Phase 43 | Complete |
| COR-02 | Phase 43 | Complete |
| COR-03 | Phase 43 | Complete |
| COR-04 | Phase 43 | Complete |
| DEBT-02 | Phase 44 | Complete |
| DEBT-03 | Phase 45 | Complete |
| DEBT-04 | Phase 44 | Complete |
| DEBT-05 | Phase 44 | Complete |
| DEBT-06 | Phase 44 | Complete |
| DEBT-07 | Phase 44 | Complete |
| PERF-01 | Phase 44 | Complete |
| PERF-02 | Phase 44 | Complete |
| PERF-03 | Phase 44 | Complete |
| TEST-03 | Phase 45 | Complete |
| DEBT-01 | Phase 45 | Complete |
| FEAT-01 | Phase 46 | Complete |
| FEAT-02 | Phase 46 | Complete |
| FEAT-03 | Phase 46 | Complete |
| FEAT-04 | Phase 46 | Complete |
| TEST-01 | Phase 47 | Complete |
| TEST-02 | Phase 47 | Complete |
| TEST-04 | Phase 47 | Complete |
| TEST-05 | Phase 47 | Complete |
| TEST-06 | Phase 47 | Complete |
| REFAC-01 | Phase 47 | Complete |
| REFAC-02 | Phase 47 | Complete |
| REFAC-03 | Phase 47 | Complete |
| DAILY-01 | Phase 48 | Planned |
| DAILY-02 | Phase 49 | Planned |
| DAILY-03 | Phase 52 | Complete |
| DAILY-04 | Phase 53 | Pending |

**Coverage:**
- v3.4 requirements: 27 total — mapped: 27 — complete
- v3.5 requirements: 4 total — mapped: 4 — partial closure (DAILY-01/02/03 complete; DAILY-04 pending in Phase 53)

---
*Requirements defined: 2026-04-05*
*Last updated: 2026-04-07 — DAILY-03 closed via phase 52 verification; DAILY-04 remains pending in phase 53*
