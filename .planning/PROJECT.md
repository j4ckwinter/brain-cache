# Braincache

## What This Is

Braincache is a local AI runtime and tool layer for Claude that uses the developer's local GPU as a cache layer. It offloads low-value AI tasks (embeddings, retrieval, context preprocessing) to local models via Ollama, then sends only minimal, high-quality context to Claude for reasoning. Designed for developers who use Claude Code and want to reduce token usage while improving response quality.

## Core Value

Reduce Claude token usage and improve response quality by running embeddings, retrieval, and context building locally — Claude only sees what matters.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Local runtime service that indexes codebases, embeds queries, retrieves relevant code, and builds compressed context
- [ ] MCP server exposing tools (index_repo, search_codebase, build_context, doctor) callable by Claude Code
- [ ] CLI for setup and diagnostics (braincache init, index, doctor, status)
- [ ] Capability-aware execution that detects GPU/VRAM and adapts behavior
- [ ] Ollama integration for local embeddings and optional compression
- [ ] LanceDB vector storage for code embeddings
- [ ] Context builder that deduplicates, prioritizes relevance, and trims unnecessary content
- [ ] Claude integration via Anthropic SDK for the ask-codebase workflow
- [ ] Token savings metadata reporting

### Out of Scope

- UI of any kind — this is a CLI and tool layer only
- Multi-agent systems — single orchestrator pattern
- Plugin systems — no extensibility framework
- Providers beyond Ollama + Claude — no OpenAI, no Gemini
- Generic AI framework features — this is a context optimization layer, not a framework
- Mobile or browser support — Node.js local runtime only

## Context

- **Concept model**: Local GPU = cache layer, Claude = brain (reasoning engine), Braincache = orchestrator
- **Primary use case**: Developer asks Claude a question (e.g., "Why is this component rerendering?"), Braincache locally embeds the query, retrieves relevant code, compresses context, then sends only relevant context to Claude
- **Architecture**: Workflows-first (workflows > services > commands), strict folder structure
- **Tool interface**: MCP (Model Context Protocol) server — Claude Code discovers and calls tools natively
- **Vector storage**: LanceDB (embedded, no external server)
- **Local models**: Ollama HTTP API for embeddings
- **Design philosophy**: Optimize for developer experience, prefer hardcoded defaults over abstraction, keep it simple

## Constraints

- **Tech stack**: TypeScript (Node.js), Commander CLI, Ollama, Anthropic SDK, LanceDB
- **Architecture**: Workflows-first structure with strict folder layout (src/workflows/, src/services/, src/tools/, src/cli/, src/lib/)
- **Hardware**: Must gracefully handle machines with no GPU — fallback to CPU or defer to Claude
- **Complexity**: No over-abstraction, no unnecessary complexity, no premature generalization

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| MCP server for tool interface | Native Claude Code integration, tools discoverable without config | — Pending |
| LanceDB for vector storage | Embedded, no external server, good TS support | — Pending |
| Ollama for local models | Standard local model runtime, HTTP API, wide model support | — Pending |
| Workflows-first architecture | Clear separation of orchestration from services, easier to reason about | — Pending |

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
*Last updated: 2026-03-31 after initialization*
