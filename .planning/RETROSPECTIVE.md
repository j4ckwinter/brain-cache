# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v1.0 — MVP

**Shipped:** 2026-04-01
**Phases:** 5 | **Plans:** 14 | **Tests:** 224

### What Was Built
- Complete local AI runtime: index, search, context assembly, ask-codebase
- MCP server with 4 tools discoverable by Claude Code via stdio
- CLI with 7 commands (init, index, search, context, ask, doctor, status)
- AST-aware chunking for 5 languages via tree-sitter
- GPU/VRAM detection with graceful CPU fallback

### What Worked
- Workflows-first architecture — CLI and MCP share identical workflow layer with zero duplication
- TDD red-green pattern across all phases kept regressions near zero
- Strict folder layout (workflows > services > commands) made each phase predictable
- Research phase before roadmap creation caught critical pitfalls early (Ollama cold-start, Arrow schema, tree-sitter CJS/ESM)
- Batch embedding design from the start — would have been painful to retrofit

### What Was Inefficient
- Nyquist validation left in draft status across all 5 phases — should have been completed inline during execution
- STATE.md progress bars fell out of sync during rapid phase execution (showed Phase 4/5 at 0% when already complete)
- Some SUMMARY.md one-liner fields were empty, causing "One-liner:" artifacts in automated extraction

### Patterns Established
- stderr-only logging with pino — stdout reserved for MCP and structured output
- Dynamic import() in CLI for lazy loading per command
- tsup dual-config pattern for CLI (shebang) vs MCP (no shebang) entry points
- MCP handlers guard before workflow dispatch to prevent process.exit in MCP context
- Keyword-based intent classification over LLM round-trips for speed

### Key Lessons
1. **Cold-start timeouts are real** — Ollama model warm-up takes 13-46s; 120s timeout + retry is not optional
2. **Embedding dimension is schema-locked** — LanceDB Arrow schema bakes in vector dimensions at table creation; model changes require re-index
3. **tree-sitter CJS/ESM isolation matters** — createRequire shim in one file prevents conflicts from spreading
4. **Arrow function depth 5 is the split point** — exported arrow functions are depth 4; nested callbacks are 6+
5. **MCP and CLI are separate entry points** — doctor tool in MCP can't call runDoctor() because of process.exit; build JSON directly from services

### Cost Observations
- Sessions: ~4 (rapid execution across 1 day)
- Notable: entire v1.0 MVP completed in a single day across 5 phases and 14 plans

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Phases | Plans | Key Change |
|-----------|--------|-------|------------|
| v1.0 | 5 | 14 | Initial process — research → roadmap → execute |

### Cumulative Quality

| Milestone | Tests | LOC (src/) | Languages Supported |
|-----------|-------|------------|-------------------|
| v1.0 | 224 | 2,045 | TS, JS, Python, Go, Rust |

### Top Lessons (Verified Across Milestones)

1. Research before planning catches integration pitfalls that would cost 10x to fix during execution
2. Workflows-first architecture enables multi-surface tools (CLI + MCP) without duplication
