# Brain-Cache

## What This Is

Brain-cache is a local AI runtime and tool layer for Claude that uses the developer's local GPU as a cache layer. It indexes codebases with AST-aware chunking and call-graph edge extraction, embeds queries locally via Ollama, classifies intent (lookup/trace/explore) to route through specialized retrieval workflows, traces multi-hop call paths across files, compresses results structurally, and sends only minimal, token-budgeted, file-grouped context to Claude for reasoning. Exposes 6 tools via MCP stdio and a polished CLI, with live file watching for automatic re-indexing.

## Core Value

Reduce Claude token usage and improve response quality by running embeddings, retrieval, and context building locally — Claude only sees what matters.

## Requirements

### Validated

- ✓ Local runtime that indexes codebases, embeds queries, retrieves relevant code, and builds compressed context — v1.0
- ✓ MCP server exposing tools (index_repo, search_codebase, build_context, doctor) callable by Claude Code — v1.0
- ✓ CLI for setup and diagnostics (brain-cache init, index, doctor, status, search, context, ask) — v1.0
- ✓ Capability-aware execution that detects GPU/VRAM and adapts behavior — v1.0
- ✓ Ollama integration for local embeddings with batch processing and cold-start retry — v1.0
- ✓ LanceDB vector storage with explicit Arrow schema for code embeddings — v1.0
- ✓ Context builder that deduplicates, prioritizes by relevance, and trims to token budget — v1.0
- ✓ Claude integration via Anthropic SDK for ask-codebase workflow — v1.0
- ✓ Token savings metadata reporting (tokens sent, estimated without, reduction %) — v1.0

- ✓ Hardened error propagation — thrown errors replace process.exit in workflows — v1.1
- ✓ Type safety — all `any` types replaced with concrete interfaces — v1.1
- ✓ Ollama process security — PID tracking, signal handlers, remote host guard — v1.1
- ✓ Concurrent file I/O — Promise.all groups of 20 for file reads — v1.1
- ✓ Streaming chunk pipeline — group-based embed+store, no unbounded accumulator — v1.1
- ✓ IVF-PQ vector index — auto-created at 10K+ rows — v1.1
- ✓ Incremental indexing — SHA-256 content-hash diffing, only re-embed changed files — v1.1
- ✓ Intent classification — three-tier with bigrams and exclusion patterns — v1.1
- ✓ MCP force reindex — --force option exposed in MCP index_repo tool — v1.1
- ✓ API key leak prevention — pino redact config on all sensitive fields — v1.1

- ✓ Multi-hop flow tracing for cross-file path analysis (FLOW-01) — v2.0
- ✓ Intent-aware retrieval modes: lookup, trace, explore (INTENT-01) — v2.0
- ✓ Context cohesion: group by file/module, preserve ordering (COH-01) — v2.0
- ✓ New MCP tool: `trace_flow` for structured flow output (FLOW-02) — v2.0
- ✓ New MCP tool: `explain_codebase` for architecture summaries (TOOL-02) — v2.0
- ✓ Context compression via structural manifest (COMP-01) — v2.0
- ✓ Configurable retrieval depth per query type (ADV-01) — v2.0
- ✓ Claude behavior tuning via CLAUDE.md refinements (ADOPT-01) — v2.0
- ✓ File watcher for live re-indexing (INC-02) — v2.0
- ✓ Custom exclusion patterns via `.braincacheignore` (EXC-01) — v2.0

- ✓ Shared formatToolResponse envelope with summary-first format (FMT-01, FMT-02) — v2.1
- ✓ Tool-specific formatters: search ranked list, trace hops, doctor dashboard, index summary (REND-01-04) — v2.1
- ✓ Consistent error envelope across all 6 tools (META-02) — v2.1
- ✓ Token savings footer on all 4 retrieval tools (META-01) — v2.1
- ✓ Pipeline labels on retrieval tools (META-03) — v2.1

- ✓ Exact-name SQL lookup for trace_flow entry point resolution (RET-03) — v2.2
- ✓ callsFound dedup per hop via Set spread (OUT-01) — v2.2
- ✓ Config file noise penalty in search results with tool-name bypass (NOISE-01) — v2.2
- ✓ Per-mode keyword boost weights: lookup 0.40, trace 0.20, explore 0.10 (RET-01) — v2.2
- ✓ Similarity promotion for name-matched chunks above compression threshold (RET-02) — v2.2
- ✓ Real token savings computation in trace_flow, zero-hop guard (OUT-02) — v2.2
- ✓ MCP tool description negative examples and CLAUDE.md routing refinements (ROUTE-01) — v2.2

- ✓ Exact-match and filename-aware retrieval precision (PREC-01, PREC-02) — v2.3
- ✓ Primary result compression protection (COMP-01, COMP-02) — v2.3
- ✓ Trace output quality: noise filtering, confidence signaling, entrypoint resolution (TRACE-01, TRACE-02, TRACE-03, TRACE-04) — v2.3
- ✓ Explain codebase depth: behavioral summaries over stripped listings (EXPL-01) — v2.3

### Active

- ✓ Session-level token savings accumulation in MCP retrieval handlers (STAT-01) — Validated in Phase 30: stats-infrastructure
- ✓ Configurable TTL-based session stats reset (STAT-02) — Validated in Phase 30: stats-infrastructure
- [ ] `brain-cache init` installs and configures status line into Claude Code settings (STAT-03)
- [ ] Session stats reset on new session or TTL-based expiry (STAT-04)

## Current Milestone: v2.4 Status Line

**Goal:** Make brain-cache's token savings visible at a glance via a Claude Code status line that updates after every prompt.

**Target features:**
- MCP retrieval handlers accumulate session-level token savings stats to a local file after each tool call
- Status line script that reads session stats and renders `brain-cache  ↓38%  12.4k saved` (or `idle` when no calls yet)
- `brain-cache init` installs/configures the status line script into Claude Code settings
- Session stats reset on new Claude Code session (or TTL-based expiry)

## Current State

Phase 30 stats-infrastructure complete (2026-04-04). Session stats service (`sessionStats.ts`) accumulates token savings across MCP tool calls with atomic writes, mutex concurrency safety, and TTL-based reset. All 4 retrieval handlers wired with fire-and-forget `accumulateStats`. 563 tests across 27 test files.

### Out of Scope

- UI of any kind — CLI and MCP tools are the interfaces
- Multi-agent systems — single orchestrator pattern
- Plugin systems — no extensibility framework
- Providers beyond Ollama + Claude — no OpenAI, no Gemini
- Generic AI framework features — context optimization layer, not a framework
- Mobile or browser support — Node.js local runtime only
- Chat interface — Claude Code's conversation loop handles chat
- Autocomplete / inline completions — different product category
- Cross-machine sync — local-only, indexes live where the code lives
- LSP integration — tree-sitter AST parsing is sufficient
- Reranking with second LLM — vector similarity + intent-aware routing is sufficient

## Context

Shipped v2.3 Final Quality Pass with TypeScript across 29 phases.
Tech stack: Node.js 22, TypeScript, Commander CLI, Ollama, Anthropic SDK, LanceDB, chokidar v5, tree-sitter, pino, zod v4, dedent.
518+ tests passing across 26 test files.
Architecture: workflows-first (workflows > services > commands), strict folder layout.
MCP server discoverable via `.mcp.json` with stdio transport — 6 tools with formatted output, negative routing examples.
v2.3 delivered: search precision boosting, compression protection, trace output quality (test file/stdlib filtering, confidence warnings, CLI seed bias), explain_codebase behavioral summaries.

## Constraints

- **Tech stack**: TypeScript (Node.js), Commander CLI, Ollama, Anthropic SDK, LanceDB
- **Architecture**: Workflows-first structure with strict folder layout (src/workflows/, src/services/, src/tools/, src/cli/, src/lib/)
- **Hardware**: Must gracefully handle machines without GPU — fallback to CPU or defer to Claude
- **Complexity**: No over-abstraction, no unnecessary complexity, no premature generalization

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| MCP server for tool interface | Native Claude Code integration, tools discoverable without config | ✓ Good — 4 tools working via stdio |
| LanceDB for vector storage | Embedded, no external server, good TS support | ✓ Good — explicit Arrow schema, disk-backed |
| Ollama for local models | Standard local model runtime, HTTP API, wide model support | ✓ Good — batch embed + cold-start retry solved |
| Workflows-first architecture | Clear separation of orchestration from services | ✓ Good — CLI and MCP share identical workflow layer |
| stderr-only logging (pino) | stdout reserved for MCP stdio JSON-RPC transport | ✓ Good — zero stdout pollution |
| tree-sitter AST chunking | Function-boundary chunks produce quality embeddings | ✓ Good — 5 languages supported |
| zod v4 (not v3) | 14x faster parsing, smaller bundle | ✓ Good — used for MCP input validation |
| Batch embedding (32-64 chunks) | Avoids N+1 embed pattern | ✓ Good — critical for indexing performance |
| Keyword-based intent classification | Fast, fully local, no LLM round-trip | ✓ Good — three-tier with bigrams (v1.1), expanded to 3-mode routing (v2.0) |
| tsup dual-config (CLI + MCP) | CLI gets shebang, MCP does not | ✓ Good — separate entry points |
| SHA-256 content hashing for incremental indexing | Avoid re-embedding unchanged files | ✓ Good — dramatic speedup on re-index |
| Group-based streaming pipeline | Bound memory to 20 files at a time | ✓ Good — eliminated unbounded allChunks array |
| Remote OLLAMA_HOST guard | Prevent local spawn when remote configured | ✓ Good — throws descriptive error |
| BFS flow tracing over call edges | Trace cross-file call paths without LLM | ✓ Good — cycle detection, configurable hop depth |
| Structural compression | Strip function bodies, preserve signatures + JSDoc | ✓ Good — 200-token threshold, query-time only |
| Config reload per-call (no caching) | Honor config changes without server restart | ✓ Good — 3-layer merge: defaults < user < tool override |
| chokidar v5 file watcher | ESM-native, well-maintained, recursive | ✓ Good — 500ms debounce, O_EXCL cross-process lock |
| Pure-function formatter layer | Decouple presentation from handler logic | ✓ Good — 9 formatters in src/lib/format.ts, type-safe, no ANSI |
| No ANSI in MCP output | MCP text consumed by Claude, not terminal; ANSI inflates tokens 50-80% | ✓ Good — plain markdown, label: value format |
| dedent for template literals | Clean multi-line formatter source without leading whitespace | ✓ Good — 1.7.2, tagged template |
| Exact-name SQL lookup before embedding | Avoid expensive vector search when query names a camelCase symbol | ✓ Good — resolves verbose queries like "how does chunkFile work" |
| Per-mode keyword boost weights | Different query types need different name-match sensitivity | ✓ Good — lookup 0.40 surfaces named symbols, explore 0.10 avoids over-boosting |
| Similarity promotion above compression threshold | Name-matched chunks should not be compressed | ✓ Good — promotes to 0.85, compression guard preserves full content |
| Config file noise penalty with tool-name bypass | Build tool configs rank below app code for generic queries | ✓ Good — 0.15 penalty, bypassed when query names the tool |
| Real savings computation in workflow layer | Token savings must reflect actual content, not hardcoded estimates | ✓ Good — mirrors buildContext.ts pattern, zero-hop guard returns zeros |
| Negative examples in tool descriptions | Prevent Claude from over-selecting tools | ✓ Good — "Do NOT use this tool when..." with content-sync test |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd:transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-04-04 after Phase 30 stats-infrastructure complete*
