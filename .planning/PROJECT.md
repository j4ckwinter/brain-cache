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

### Active

- [ ] Incremental indexing — file watcher + content-hash stale detection (INC-01, INC-02)
- [ ] Custom exclusion patterns via `.braincacheignore` (EXC-01)
- [ ] Configurable retrieval depth per query type (ADV-01)
- [ ] Cross-file dependency-aware retrieval (ADV-02)

## Current Milestone: v1.1 Hardening

**Goal:** Fix tech debt, bugs, security issues, performance bottlenecks, and fragile code patterns identified in the codebase concerns audit.

**Target features:**
- Fix 6 tech debt items (incremental indexing, hardcoded values, empty barrels, any types, redundant token counting)
- Fix 1 known bug (model name prefix matching)
- Address 2 security concerns (API key handling, detached Ollama process management)
- Fix 4 performance bottlenecks (sequential I/O, memory accumulation, vector index creation, separator counting)
- Harden 4 fragile areas (replace process.exit with thrown errors, document tree-sitter CJS hack, improve arrow function heuristic, improve intent classification)

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

Shipped v1.0 MVP with 2,045 LOC TypeScript across 5 phases and 14 plans.
Tech stack: Node.js 22, TypeScript, Commander CLI, Ollama, Anthropic SDK, LanceDB, tree-sitter, pino, zod v4.
224 tests passing across all subsystems.
Architecture: workflows-first (workflows > services > commands), strict folder layout.
MCP server discoverable via `.mcp.json` with stdio transport.

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
| Keyword-based intent classification | Fast, fully local, no LLM round-trip | ✓ Good — diagnostic vs knowledge strategies |
| tsup dual-config (CLI + MCP) | CLI gets shebang, MCP does not | ✓ Good — separate entry points |

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
*Last updated: 2026-04-01 after v1.1 milestone started*
