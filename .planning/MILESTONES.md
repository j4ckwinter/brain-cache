# Milestones

## v3.0 Skill Reshape (Shipped: 2026-04-04)

**Phases completed:** 4 phases, 8 plans, 13 tasks

**Key accomplishments:**

- Session stats service with module-level mutex, atomic tmp+rename writes, and config-driven TTL — fire-and-forget safe accumulation of tokensSent and estimatedWithoutBraincache to ~/.brain-cache/session-stats.json
- Fire-and-forget accumulateStats calls wired into all four MCP retrieval handlers (search_codebase, build_context, trace_flow, explain_codebase) with 6 integration tests verifying correct delta values and error isolation
- Standalone ESM statusline.mjs script with formatTokenCount (k/M suffixes), readStats (2h TTL + validation), and renderOutput (savings or idle fallback), fully TDD with 19 unit tests
- Subprocess integration tests validating full stdin-to-stdout pipeline for statusline.mjs — 6 tests covering savings output, idle fallback, expired/malformed stats, and cold-start timing
- brain-cache init now auto-installs statusline.mjs and configures ~/.claude/settings.json with a statusLine command entry, completing the v2.4 Status Line milestone installation flow
- brain-cache Claude Code skill definition with 3-tool MCP routing table, negative examples, and status line reference — distributable via .claude/skills/brain-cache/SKILL.md
- README rewritten with v1.0 punchy pitch (3 MCP tools, skill install instructions, mortgage payment copy) and CLAUDE.md simplified to 3-tool routing table removing trace_flow and explain_codebase
- init.ts installs SKILL.md to user project via ESM package-root resolution; npm package ships .claude/skills/ with SKILL.md included

---

## v2.2 Retrieval Quality (Shipped: 2026-04-03)

**Phases completed:** 11 phases, 23 plans, 30 tasks

**Key accomplishments:**

- One-liner:
- .braincacheignore file loader service and crawler integration — users can now exclude files from indexing without modifying .gitignore
- chunkFile now returns ChunkResult with call/import edges extracted in a single AST traversal, and the index pipeline stores edges alongside chunks with .braincacheignore support
- Keyword-based intent classifier expanded from 2 modes (diagnostic/knowledge) to 3 modes (lookup/trace/explore) with mode-specific retrieval parameters and 28 passing tests
- One-liner:
- One-liner:
- callsFound field added to FlowHop BFS, compressChunk strips bodies above 200 tokens, configLoader merges user ~/.brain-cache/config.json with retrieval strategy defaults
- trace_flow and explain_codebase MCP tools registered; buildContext routes trace queries through runTraceFlow and explore queries through runExplainCodebase; all paths use configLoader for user-configurable retrieval depth
- One-liner:
- `brain-cache watch [path]` CLI command wired with lazy dynamic import, completing INC-02 file watcher requirement.
- 6-tool routing table added to CLAUDE_MD_SECTION template and project CLAUDE.md, with explicit cross-references steering trace/architecture queries away from build_context to trace_flow and explain_codebase
- 8 new handler integration tests covering trace_flow and explain_codebase success and error paths in tests/mcp/server.test.ts, bringing total MCP handler test count to 25 with zero failures
- 5 core formatter pure functions + 2 exported interfaces in src/lib/format.ts, with dedent installed and formatTokenSavings redesigned to remove padEnd column alignment
- Result-list formatters (formatSearchResults, formatTraceFlow, formatContext) added to src/lib/format.ts, completing all 8 formatter functions for Phase 21 MCP wiring
- One-liner:
- One-liner:
- Set-based deduplication of callsFound in flowTracer.ts eliminates duplicate callee names when edges table has repeated to_symbol rows
- Exact SQL name lookup via extractSymbolCandidate short-circuits embedding for camelCase symbol queries in trace_flow, resolving RET-03
- Score penalty for build tool config files in searchChunks: vitest.config.ts, tsup.config.ts, tsconfig.json, jest.config.ts, and eslint config files receive a 0.15 penalty subtracted from the blended search score, bypassed when the query explicitly names the tool
- One-liner:
- 1. [Rule 1 - Bug] Fixed server.test.ts mock missing new metadata savings fields
- Negative-example routing guards added to all 4 MCP tool descriptions, removing "Prefer" over-selection framing and locking with test assertions
- Negative routing examples added to all 4 per-tool MCP sections; CLAUDE.md and template kept in sync by content-comparison test

---

## v2.1 Presentation Magic (Shipped: 2026-04-03)

**Phases completed:** 7 phases, 16 plans, 19 tasks

**Key accomplishments:**

- One-liner:
- .braincacheignore file loader service and crawler integration — users can now exclude files from indexing without modifying .gitignore
- chunkFile now returns ChunkResult with call/import edges extracted in a single AST traversal, and the index pipeline stores edges alongside chunks with .braincacheignore support
- Keyword-based intent classifier expanded from 2 modes (diagnostic/knowledge) to 3 modes (lookup/trace/explore) with mode-specific retrieval parameters and 28 passing tests
- One-liner:
- One-liner:
- callsFound field added to FlowHop BFS, compressChunk strips bodies above 200 tokens, configLoader merges user ~/.brain-cache/config.json with retrieval strategy defaults
- trace_flow and explain_codebase MCP tools registered; buildContext routes trace queries through runTraceFlow and explore queries through runExplainCodebase; all paths use configLoader for user-configurable retrieval depth
- One-liner:
- `brain-cache watch [path]` CLI command wired with lazy dynamic import, completing INC-02 file watcher requirement.
- 6-tool routing table added to CLAUDE_MD_SECTION template and project CLAUDE.md, with explicit cross-references steering trace/architecture queries away from build_context to trace_flow and explain_codebase
- 8 new handler integration tests covering trace_flow and explain_codebase success and error paths in tests/mcp/server.test.ts, bringing total MCP handler test count to 25 with zero failures
- 5 core formatter pure functions + 2 exported interfaces in src/lib/format.ts, with dedent installed and formatTokenSavings redesigned to remove padEnd column alignment
- Result-list formatters (formatSearchResults, formatTraceFlow, formatContext) added to src/lib/format.ts, completing all 8 formatter functions for Phase 21 MCP wiring
- One-liner:
- One-liner:

---

## v2.0 MCP Magic (Shipped: 2026-04-03)

**Phases completed:** 5 phases, 12 plans, 15 tasks

**Key accomplishments:**

- One-liner:
- .braincacheignore file loader service and crawler integration — users can now exclude files from indexing without modifying .gitignore
- chunkFile now returns ChunkResult with call/import edges extracted in a single AST traversal, and the index pipeline stores edges alongside chunks with .braincacheignore support
- Keyword-based intent classifier expanded from 2 modes (diagnostic/knowledge) to 3 modes (lookup/trace/explore) with mode-specific retrieval parameters and 28 passing tests
- One-liner:
- One-liner:
- callsFound field added to FlowHop BFS, compressChunk strips bodies above 200 tokens, configLoader merges user ~/.brain-cache/config.json with retrieval strategy defaults
- trace_flow and explain_codebase MCP tools registered; buildContext routes trace queries through runTraceFlow and explore queries through runExplainCodebase; all paths use configLoader for user-configurable retrieval depth
- One-liner:
- `brain-cache watch [path]` CLI command wired with lazy dynamic import, completing INC-02 file watcher requirement.
- 6-tool routing table added to CLAUDE_MD_SECTION template and project CLAUDE.md, with explicit cross-references steering trace/architecture queries away from build_context to trace_flow and explain_codebase
- 8 new handler integration tests covering trace_flow and explain_codebase success and error paths in tests/mcp/server.test.ts, bringing total MCP handler test count to 25 with zero failures

---

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
