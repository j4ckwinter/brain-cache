# Milestones

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
