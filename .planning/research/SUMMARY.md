# Project Research Summary

**Project:** Braincache
**Domain:** Local AI Runtime / Code Intelligence
**Researched:** 2026-03-31
**Confidence:** HIGH

## Executive Summary

Braincache is a context optimization layer — a local MCP server that intercepts the work that happens before Claude sees code. Rather than acting as a chat interface, IDE plugin, or agent framework, it has one job: embed a codebase locally, retrieve semantically relevant chunks, compress them aggressively, and hand off minimal high-signal context to Claude via MCP tools. The competitive set (Augment Context Engine, Continue.dev, Cursor) confirms this pattern is validated and in-demand, with empirical evidence showing 70%+ of AI agent token usage is waste. Braincache's advantage is being local-first, embedded (no external servers required), and purpose-built for this single context-optimization flow.

The recommended build approach is a Node.js 22 + TypeScript stack using `@lancedb/lancedb` (embedded vector DB, no server required), the `ollama` npm package for local embeddings, and `@modelcontextprotocol/sdk` for the MCP server. The architecture follows a strict layered pattern: thin CLI and MCP tool adapters dispatch to workflow functions, which orchestrate stateless services, which write to LanceDB. This structure is critical because both the CLI and MCP server must call identical workflows — divergence between the two surfaces creates maintenance debt immediately. Nothing flows upward through the layers.

The primary technical risks are all avoidable with upfront discipline: stdout corruption in the MCP stdio transport (route all logs to stderr from day one), embedding model/dimension mismatches after config changes (store model + dimension in metadata, detect mismatches at query time), Ollama cold-start timeouts (120-second timeout + warm-model step in `init`), and naive indexing that crawls `node_modules` (apply `.gitignore` + hardcoded exclusions before the first crawl is implemented). Every critical pitfall identified in research has a clear preventative pattern that must be applied before the affected phase begins — not retrofitted later.

## Key Findings

### Recommended Stack

The stack is fully TypeScript-native and requires no external servers. `@lancedb/lancedb` (v0.27.1) is the only embedded vector database with a maintained TypeScript library and disk-backed persistence — ChromaDB requires Python, hnswlib-node is in-memory only, pgvector requires PostgreSQL. The official `ollama` (v0.6.3) npm package handles embeddings and LLM calls with proper TypeScript types. The `@modelcontextprotocol/sdk` (v1.29.0) provides the MCP server with stdio transport. Zod v4 (now stable, 14x faster than v3) is required for MCP tool input validation. For development, `tsx` replaces the broken `ts-node`; `tsup` handles production builds with dual CJS/ESM output.

**Core technologies:**
- `@lancedb/lancedb` v0.27.1: embedded vector storage — only embedded TS-native option with disk persistence and no external server requirement
- `ollama` v0.6.3: local embeddings + LLM client — official library with full HTTP API parity and proper TypeScript types for embeddings
- `@modelcontextprotocol/sdk` v1.29.0: MCP server — official SDK, 37k+ downstream projects, stdio transport for Claude Code integration
- `@anthropic-ai/sdk` v0.80.0: Claude API client — used only for the `ask-codebase` path; not required for core search/index flows
- `commander` v14.0.3: CLI framework — zero startup overhead; oclif adds 70-100ms penalty that is unacceptable for a frequently-called dev tool
- `zod` v4: schema validation — required for MCP tool schemas; v4 is now stable and 14x faster than v3
- `pino`: structured logging — 5x faster than Winston, JSON default, critical for a background runtime; must write to stderr only
- `vitest`: testing — native TypeScript + ESM, no Babel config, 10-20x faster than Jest
- `nomic-embed-text` (Ollama model): default embedding model — 768-dim, 8k context window (critical for code files), CPU-capable

**What NOT to use:** LangChain, LlamaIndex, Vercel AI SDK, `ts-node`, chalk v5+, ChromaDB, pgvector, Redis, Postgres. The constraint is zero external server dependencies. The `vectordb` package (deprecated predecessor to `@lancedb/lancedb`) must not be used.

### Expected Features

Braincache's feature surface is deliberately narrow. The core value proposition — give Claude less-but-better context — is delivered by six capabilities in the MVP.

**Must have (table stakes):**
- Codebase indexing (`braincache index [path]`) — without this the tool has no memory
- AST-aware chunking via tree-sitter — naive line/character splits produce garbage embeddings; function-boundary chunks are now the minimum quality bar confirmed across Cursor, Continue.dev, and LanceDB's own RAG guide
- Gitignore + hardcoded exclusion respect — tools that index `node_modules` are immediately untrustworthy (confirmed via Roo-Code issue #5655)
- Vector similarity search (`search_codebase` MCP tool) — the primary query type is "find code related to X"
- Context assembly with deduplication and token budget enforcement (`build_context` MCP tool) — the "cache layer" abstraction that distinguishes Braincache from raw RAG pipelines
- Token savings metadata on every `build_context` response — the value proposition is invisible without a number
- Hardware detection + Ollama probe — graceful degradation on CPU-only machines is expected; silent crashes are not
- CLI init / doctor / status — setup failures need a debugging path

**Should have (competitive differentiators):**
- Relevance-ranked context assembly with similarity score threshold (drop chunks below 0.7 cosine similarity)
- Context deduplication (hash-based, prevents inflated context from widely-called utilities)
- Compression metadata as tool output (tokens used, tokens saved, chunks selected)
- Zero-config defaults (hardcoded sensible defaults; no user configuration required to get started)
- Ollama model auto-selection by VRAM tier

**Defer to v2+:**
- Incremental file watching (manual re-index on demand is sufficient for MVP)
- Query-type aware retrieval (classify queries and tune retrieval strategy per type — high complexity, medium value)
- `.braincacheignore` custom exclusions (`.gitignore` only for MVP)

**Firm anti-features (do not build):** autocomplete/inline completions, multi-provider LLM routing beyond Ollama + Anthropic, web UI, chat interface, plugin system, LSP integration, LLM-based reranking, cross-machine sync. Each of these turns Braincache into a worse version of a different product category.

### Architecture Approach

The architecture follows a strict unidirectional layered pattern. CLI commands and MCP tool handlers are thin adapters that call workflow functions. Workflows orchestrate service calls and own all sequencing logic. Services are stateless leaf nodes that call `lib/` utilities only. LanceDB sits at the bottom, written to and read from only by services. The dependency rule is: `cli/` → `workflows/` → `services/` → `lib/`. Nothing flows upward.

This structure enforces that identical behavior is reachable from both the CLI and the MCP interface without duplicating logic. Business logic in MCP tool handlers is an explicit anti-pattern — it prevents CLI reuse, makes testing require MCP infrastructure, and causes code duplication.

**Major components:**
1. **MCP Server** (`mcp-server.ts`) — receives JSON-RPC tool calls from Claude Code over stdio; thin dispatcher, zero business logic
2. **CLI Layer** (`cli/commands/`) — Commander.js commands; same workflows as MCP tools, same thin-adapter pattern
3. **Workflow Layer** (`workflows/`) — `IndexWorkflow`, `SearchWorkflow`, `ContextWorkflow`, `AskWorkflow`; the only place that knows operation sequencing
4. **IndexerService** — file walking, tree-sitter AST parsing, chunking, batch embedding, LanceDB upsert with single-writer lockfile
5. **EmbedService** — stateless Ollama `/api/embed` HTTP calls; batch input array, 120s timeout, cold-start retry
6. **ContextBuilder** — retrieves top-K chunks, deduplicates, applies cosine similarity threshold, trims to token budget; pure transformation, no I/O
7. **LanceDB** — embedded on-disk vector store at `~/.braincache/db/`; tables: `code_chunks`, `file_metadata`, `index_state` (stores model name, dimension, metric)
8. **CapabilityDetector** — GPU/VRAM detection, Ollama reachability, model availability; always returns a profile object, never throws

**Two independent pipelines share `EmbedService` and `LanceDB`:**
- Indexing pipeline (offline): `file walk → gitignore filter → AST chunk → batch embed → LanceDB upsert`
- Query pipeline (realtime): `query → embed → similarity search → rank + dedup → token-budget trim → return`

### Critical Pitfalls

1. **stdout corruption in MCP stdio transport** — any `console.log()` anywhere in the process corrupts the JSON-RPC channel silently. The MCP client receives garbled data or drops tool calls with no useful error. Prevention: configure pino to write to stderr only and add an ESLint rule banning `console.log` before writing any MCP tool handler code. Must be addressed in Phase 1 before any MCP code exists.

2. **Embedding dimension mismatch after model change** — LanceDB bakes the vector dimension into the table schema at creation time. Changing models (e.g., nomic-embed-text at 768 dims to mxbai-embed-large at 1024 dims) produces silent retrieval failures or garbage scores. Prevention: store the embedding model name and output dimension in `index_state` at index time; detect mismatches on startup and refuse to proceed, prompting `braincache index --force`.

3. **Ollama cold-start timeout killing first requests** — model warm-up from disk to VRAM takes 13–46 seconds; default HTTP timeouts cause the first embedding call to fail with ECONNRESET. Prevention: set a 120-second per-request timeout for embedding calls from the start; add a warm-model step to `braincache init` and `doctor`; implement 2-retry exponential backoff; emit a progress message on cold start.

4. **Indexing `node_modules` and binary files** — without explicit gitignore parsing, the indexer crawls everything. The resulting index is 10-100x larger than needed, indexing takes minutes, and search results are polluted with vendored code hits. Prevention: parse `.gitignore` using the `ignore` library and apply a hardcoded exclusion list (`node_modules/`, `.git/`, `dist/`, lock files, binaries, files over 100KB) before the first crawl is implemented. This is a blocker for any useful index.

5. **N+1 embedding pattern** — embedding one file per HTTP request on a 500-file codebase produces 500 sequential round-trips. Indexing takes 5-15 minutes instead of under 1 minute. Prevention: use Ollama's batch embedding endpoint (`input` as array) and process chunks in batches of 32-64 from the start. This is not a later optimization — retrofitting batching after the indexer is built is painful.

6. **Distance metric mismatch** — LanceDB does not validate that query-time distance metric matches index-time metric; mismatches are silent but degrade retrieval quality invisibly. Prevention: use cosine similarity as the universal default (Ollama models produce normalized vectors), store the metric in `index_state`, and assert it matches at every query.

## Implications for Roadmap

Based on the architecture's explicit build-order dependencies and the feature dependency chain, a 6-phase structure is appropriate. Each phase delivers a testable artifact and unblocks the next.

### Phase 1: Foundation and Infrastructure
**Rationale:** `lib/` utilities (config, logger, tokenizer) and `CapabilityDetector` are dependencies of everything else. The stdout corruption pitfall must be neutralized before any MCP code is written — it is a cross-cutting constraint that cannot be retrofitted. This phase establishes the non-negotiable constraints the whole codebase follows.
**Delivers:** Project scaffold with tsconfig (NodeNext + ESM), ESLint rule banning `console.log`, pino logger writing exclusively to stderr, `lib/config.ts` with hardcoded defaults, `lib/tokenizer.ts` (Anthropic tokenizer for budget decisions), `CapabilityDetector` that always returns a profile and never throws, basic `braincache doctor` CLI command surfacing the capability profile.
**Addresses:** Hardware detection + Ollama probe (table stakes), zero-config defaults (differentiator)
**Avoids:** stdout corruption (Critical Pitfall 1), fragile nvidia-smi GPU detection failure on non-NVIDIA hardware (Gotcha 3)

### Phase 2: Storage Layer and Indexing Pipeline
**Rationale:** LanceDB schema and `IndexerService` must exist before any embedding or retrieval is possible. Gitignore exclusions and AST-aware chunking must be integrated here — these are architectural decisions, not features that can be added later. Batch embedding must be designed in from the start.
**Delivers:** `lancedb.service.ts` (schema with `code_chunks`/`file_metadata`/`index_state` tables, connect, batch upsert, single-writer lockfile), `lib/chunker.ts` (tree-sitter AST chunking with per-language grammar support and line-based fallback for unsupported types), `indexer.service.ts` (`.gitignore`-aware file walk, hardcoded exclusion list, binary/size skip), `embed.service.ts` (Ollama batch embedding, 120s timeout, cold-start retry, model-exists check), `index.workflow.ts`, `braincache index [path]` CLI command. Stores model name + dimension + metric in `index_state` on first run.
**Addresses:** Codebase indexing, AST-aware chunking, gitignore respect, hardware detection (all table stakes)
**Avoids:** Indexing node_modules (Critical Pitfall 4), N+1 embed pattern (Performance Trap 1), text chunking at function boundaries (Performance Trap 3), LanceDB concurrent write failures (Technical Debt 4), embedding dimension mismatch (Critical Pitfall 2), Ollama cold-start timeout (Critical Pitfall 3)

### Phase 3: Retrieval and Context Assembly
**Rationale:** The query pipeline can only be built after the indexing pipeline produces valid stored vectors. ContextBuilder's token budget enforcement and deduplication logic is the core product differentiator and deserves its own phase — built carefully with real relevance assertions as acceptance criteria.
**Delivers:** `context-builder.service.ts` (top-K retrieval capped at 5-8 chunks, cosine similarity threshold at 0.7, hash-based chunk deduplication, token budget enforcement at 8k tokens, explicit column projection in LanceDB queries — never select the vector column), `search.workflow.ts`, `context.workflow.ts`, token savings metadata on every `build_context` response, distance metric assertion at query time, ANN index creation (IVF/HNSW) after initial index load.
**Addresses:** Vector similarity search, context assembly with dedup + ranking, token savings metadata (all table stakes and core differentiator features)
**Avoids:** Over-stuffing context (Technical Debt 3), distance metric mismatch (Critical Pitfall 5/6), inaccurate token counting via character approximation (Gotcha 2), full-column scan performance trap (Performance Trap 2)

### Phase 4: MCP Server and Tool Exposure
**Rationale:** The MCP interface is built last among internal components because it wraps workflows that are now fully built and tested. The thin-adapter pattern means this phase is mostly wiring. Zod validation inside every tool handler is mandatory regardless of what the MCP protocol nominally enforces.
**Delivers:** `mcp-server.ts` (stdio transport, tool registration), all four MCP tools (`index_repo`, `search_codebase`, `build_context`, `doctor`) with Zod input validation in every handler, structured error responses (not thrown exceptions so Claude Code can surface actionable feedback), `ask.workflow.ts` with Anthropic SDK integration for the `ask-codebase` path.
**Addresses:** MCP tool exposure (table stakes), compression metadata as tool output (differentiator)
**Avoids:** Business logic in tool handlers (Architecture Anti-Pattern 1), MCP schema validation gaps (Gotcha 4), stdout corruption (verified here by piping stdout through a JSON-RPC validator in tests)

### Phase 5: CLI Completion and Developer Experience
**Rationale:** CLI commands are thin adapters over the same workflows as the MCP tools. With workflows complete, this phase is fast — it is about surface polish, error messaging, progress indicators, and the `doctor` / `status` commands delivering actionable output rather than cryptic failures.
**Delivers:** All CLI commands (`init`, `index`, `doctor`, `status`, `search`) with progress bars during indexing, clear actionable error messages for missing Ollama models, "Loading model into VRAM, first request may take 30-60s..." cold-start feedback, token savings reporting in terminal output, `braincache init` warm-model step.
**Addresses:** CLI init / doctor / status (table stakes), zero-config defaults (differentiator)
**Avoids:** Cryptic errors for missing models (Gotcha 1), cold-start failures without user feedback (Critical Pitfall 3)

### Phase 6: Reliability and Incremental Re-indexing
**Rationale:** Once the core flows work end-to-end, the stale index problem and performance cliff at scale need to be addressed. These are the primary causes of the "looks done but isn't" failures documented in the pitfalls research. File watching is explicitly deferred — the debounce edge cases and concurrent-write complexity are not worth it for v1.
**Delivers:** Content-hash (SHA-256) per-file tracking in `file_metadata`, stale index detection on `search_codebase` calls (compare stored hash vs. current file state), `braincache index --force` full reindex command, ANN index rebuild warning when vector count exceeds 5k, VRAM-tier Ollama model auto-selection, `.braincacheignore` custom exclusion support.
**Addresses:** Incremental re-indexing (deferred from MVP), VRAM-tier model selection (deferred from MVP), `.braincacheignore` (deferred from MVP)
**Avoids:** Stale index after branch switch (Technical Debt 2), LanceDB full-scan performance cliff at scale (Technical Debt 1)

### Phase Ordering Rationale

- **Foundation first** because the stderr-only logging constraint is a cross-cutting concern that must be enforced globally from the first line of MCP-adjacent code. Adding it later requires auditing every file.
- **Storage and indexing before retrieval** because retrieval requires stored vectors — there is nothing to query until the indexing pipeline runs end-to-end and produces valid data.
- **Retrieval before MCP tools** because MCP tools are thin wrappers over workflows, and workflows depend on services that depend on retrieval being complete and correct.
- **MCP tools before CLI polish** because validating the integration with Claude Code's MCP client reveals unexpected behavior (schema enforcement, error surfacing) that is better discovered before CLI polish is done.
- **Reliability last** because stale-index and scale problems are real but not blockers for a working v1. Manual reindex on demand is sufficient for the MVP per features research.
- **No file watcher at any phase in v1** — debounce edge cases and LanceDB concurrent-write complexity (Technical Debt 4) are explicitly not worth the added risk until post-MVP.

### Research Flags

Phases needing deeper research during planning:
- **Phase 2 (tree-sitter chunking):** Grammar coverage for TypeScript, JavaScript, Python, Go, and Rust needs a concrete implementation decision before the phase begins. Evaluate `supermemory/code-chunk` library vs. hand-rolling with the `tree-sitter` npm package directly. The `cAST` paper (EMNLP 2025) is the primary academic reference. This is the only Phase 2 unknown that requires a spike.
- **Phase 3 (ANN index threshold):** LanceDB requires a minimum row count before IVF/HNSW index training is effective. The exact threshold depends on embedding dimension. Verify against LanceDB docs during Phase 3 planning to set the correct warning threshold.

Phases with standard patterns (skip research-phase):
- **Phase 1:** Node.js 22 + TypeScript scaffold — fully documented, zero unknowns.
- **Phase 3:** RAG retrieval and context building — well-documented patterns from LanceDB, Augment, and Continue.dev research.
- **Phase 4:** MCP SDK stdio server — official SDK with examples; standard patterns confirmed by 37k+ downstream users.
- **Phase 5:** Commander.js CLI — 500M+ downloads/week, no research needed.
- **Phase 6:** Content-hash based re-indexing — standard pattern, no research needed.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All core library versions verified via npm and official GitHub repos. Alternatives eliminated with documented rationale and specific version references. `@lancedb/lancedb` v0.27.1 and `ollama` v0.6.3 confirmed published as of March 2026. |
| Features | HIGH (table stakes), MEDIUM (differentiators) | Table stakes features confirmed via direct comparison with Augment, Continue.dev, Cody, Cursor behavior. Differentiator value claims (30-80% quality improvement from ranked assembly) are MEDIUM — sourced from Augment's own blog, not independently replicated. |
| Architecture | HIGH | Layered architecture pattern confirmed via MCP SDK docs, LanceDB documentation, multiple RAG architecture sources. Data flow for all three pipelines (indexing, query, capability detection) is explicitly documented with code examples. |
| Pitfalls | HIGH | Every critical pitfall confirmed via GitHub issues in production codebases (Roo-Code #5655, mem0 #4212, claude-flow #835, Archon #894) and official documentation. Not speculative — all have real-world issue tracker evidence. |

**Overall confidence:** HIGH

### Gaps to Address

- **Tree-sitter grammar coverage:** The chunker needs a concrete implementation decision (use `supermemory/code-chunk`, hand-roll with `tree-sitter`, or use another library). This is the only Phase 2 unknown that requires resolution before implementation begins. Flag for a brief spike at the start of Phase 2 planning.
- **ANN index training threshold:** LanceDB requires a minimum number of rows before IVF/HNSW index training is effective. The exact threshold depends on embedding dimension and is not stated as a fixed number in current docs. Verify during Phase 3 planning to set the correct warning threshold.
- **Token savings calculation for the savings metric:** Using `client.messages.countTokens()` is correct for budget decisions, but the "estimated tokens without Braincache" figure (required for the savings metric) needs a defined approach. A reasonable heuristic is counting all file tokens that match the search query scope and reporting the delta. Flag for Phase 3 implementation design.
- **Ollama model pull during `braincache init`:** Whether `nomic-embed-text` is pre-pulled by the user or triggered automatically by `init` needs explicit user-facing copy and error handling. Confirm whether the Ollama REST API supports pull-with-progress during Phase 1/2 planning.

## Sources

### Primary (HIGH confidence)
- [@lancedb/lancedb npm](https://www.npmjs.com/package/@lancedb/lancedb) — v0.27.1 confirmed published
- [LanceDB Documentation](https://lancedb.github.io/lancedb/) — embedded usage, TypeScript SDK, schema, vector search, ANN index
- [LanceDB: Building RAG on Codebases](https://lancedb.com/blog/building-rag-on-codebases-part-1/) — AST chunking + retrieval pipeline patterns
- [ollama npm](https://www.npmjs.com/package/ollama) — v0.6.3 official JS library
- [Ollama Embeddings API](https://docs.ollama.com/capabilities/embeddings) — `/api/embed` format, batch input array, health check endpoint
- [@modelcontextprotocol/sdk npm](https://www.npmjs.com/package/@modelcontextprotocol/sdk) — v1.29.0
- [MCP TypeScript SDK GitHub](https://github.com/modelcontextprotocol/typescript-sdk) — stdio transport, tool registration patterns
- [Anthropic Token Counting API](https://platform.claude.com/docs/en/build-with-claude/token-counting) — `messages.countTokens` beta API
- [Zod v4 release](https://zod.dev/v4) — stable, 14x faster parsing confirmed
- [Node.js TypeScript docs](https://nodejs.org/api/typescript.html) — native strip-types stable in Node 22.18+
- [Nearform MCP pitfalls guide](https://nearform.com/digital-community/implementing-model-context-protocol-mcp-tips-tricks-and-pitfalls/) — stdout corruption pitfall confirmed
- [Roo-Code GitHub issue #5655](https://github.com/RooCodeInc/Roo-Code/issues/5655) — gitignore respect as table stakes evidence
- [cAST paper EMNLP 2025](https://arxiv.org/html/2506.15655v1) — AST-aware chunking measurably improves code retrieval quality
- [supermemory/code-chunk](https://github.com/supermemoryai/code-chunk) — AST-aware chunking implementation reference
- [DEV: I tracked every token my AI agent consumed](https://dev.to/nicolalessi/i-tracked-every-token-my-ai-coding-agent-consumed-for-a-week-70-was-waste-465) — 70% token waste empirical finding
- [LanceDB GitHub issues #213, #2426](https://github.com/lancedb/lancedb/issues/) — concurrent write failures confirmed
- [Ollama GitHub issues #4350, #6031](https://github.com/ollama/ollama/issues/4350) — cold-start timeout confirmed
- [Ollama GitHub issue #12757](https://github.com/ollama/ollama/issues/12757) — wrong model type for embeddings is a silent failure

### Secondary (MEDIUM confidence)
- [Augment Context Engine MCP Overview](https://docs.augmentcode.com/context-services/mcp/overview) — comparable product analysis
- [Augment: 70%+ agent performance improvement](https://www.augmentcode.com/blog/context-engine-mcp-now-live) — performance claim (vendor-sourced, not independently replicated)
- [Continue.dev Context Providers](https://docs.continue.dev/customize/custom-providers) — context provider taxonomy
- [Morph: Codebase Indexing Strategies](https://www.morphllm.com/codebase-indexing) — indexing strategy taxonomy
- [Zilliz Distance Metric FAQ](https://zilliz.com/ai-faq/how-does-the-distance-metric-used-cosine-vs-l2-interplay-with-the-embedding-model-choice) — metric mismatch silent failure behavior
- [LocalAI VRAM Management](https://localai.io/advanced/vram-management/) — GPU detection fallback patterns
- [Drowning in Documents: Consequences of Scaling Reranker Inference](https://arxiv.org/html/2411.11767v2) — anti-feature rationale for LLM reranking

### Tertiary (LOW confidence)
- [RAG 2025 year-end review](https://ragflow.io/blog/rag-review-2025-from-rag-to-context) — retrieval evolution context; useful framing, not implementation detail

---
*Research completed: 2026-03-31*
*Ready for roadmap: yes*
