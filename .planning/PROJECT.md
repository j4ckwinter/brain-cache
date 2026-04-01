# Brain-Cache

## What This Is

Brain-cache is a local AI runtime and tool layer for Claude that uses the developer's local GPU as a cache layer. It indexes codebases with AST-aware chunking, embeds queries locally via Ollama, retrieves relevant code with smart deduplication and intent classification, and sends only minimal, token-budgeted context to Claude for reasoning. Exposes tools via MCP stdio and a polished CLI.

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

### Active

- [ ] Custom exclusion patterns via `.braincacheignore` (EXC-01)
- [ ] Configurable retrieval depth per query type (ADV-01)
- [ ] Cross-file dependency-aware retrieval (ADV-02)
- [ ] File watcher for live re-indexing (INC-02)

## Current State

Shipped v1.1 Hardening on 2026-04-01. All 16 requirements satisfied across 7 phases. No outstanding gaps.

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
- Reranking with second LLM — vector similarity scores are sufficient

## Context

Shipped v1.1 Hardening with 2,510 LOC TypeScript across 12 phases (v1.0 + v1.1) and 25 plans.
Tech stack: Node.js 22, TypeScript, Commander CLI, Ollama, Anthropic SDK, LanceDB, tree-sitter, pino, zod v4.
269 tests passing across 16 test files.
Architecture: workflows-first (workflows > services > commands), strict folder layout.
MCP server discoverable via `.mcp.json` with stdio transport.
v1.1 addressed 16 hardening requirements: 6 tech debt, 2 security, 4 performance, 4 hardening items.

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
| Keyword-based intent classification | Fast, fully local, no LLM round-trip | ✓ Good — three-tier with bigrams (v1.1) |
| tsup dual-config (CLI + MCP) | CLI gets shebang, MCP does not | ✓ Good — separate entry points |
| SHA-256 content hashing for incremental indexing | Avoid re-embedding unchanged files | ✓ Good — dramatic speedup on re-index |
| Group-based streaming pipeline | Bound memory to 20 files at a time | ✓ Good — eliminated unbounded allChunks array |
| Remote OLLAMA_HOST guard | Prevent local spawn when remote configured | ✓ Good — throws descriptive error |

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
*Last updated: 2026-04-01 after v1.1 Hardening milestone shipped*
