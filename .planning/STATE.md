---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: executing
stopped_at: Completed 05-01-PLAN.md
last_updated: "2026-04-01T04:48:45.515Z"
progress:
  total_phases: 5
  completed_phases: 4
  total_plans: 14
  completed_plans: 13
---

# Project State: Braincache

**Last updated:** 2026-03-31
**Updated by:** execute-phase agent (04-01 complete)

---

## Project Reference

**Core value:** Reduce Claude token usage and improve response quality by running embeddings, retrieval, and context building locally — Claude only sees what matters.

**Current focus:** Phase 05 — cli-completion

---

## Current Position

Phase: 05 (cli-completion) — EXECUTING
Plan: 1 of 2
**Phase:** 5
**Plan:** Not started
**Status:** Executing Phase 05

**Overall progress:**

```
Phase 1 [██████████] 100% Foundation (3/3 plans) COMPLETE
Phase 2 [██████████] 100% Storage and Indexing (4/4 plans) COMPLETE
Phase 3 [██████████] 100% Retrieval and Context Assembly (3/3 plans) COMPLETE
Phase 4 [          ] 0%   MCP Server and Claude Integration
Phase 5 [          ] 0%   CLI Completion
```

**Milestone progress:** 3/5 phases complete

---

## Performance Metrics

| Metric | Value |
|--------|-------|
| Phases total | 5 |
| Phases complete | 1 |
| Plans complete | 6 |
| Requirements mapped | 22/22 |
| Requirements complete | 12/22 |

| Phase/Plan | Duration | Tasks | Files |
|------------|----------|-------|-------|
| Phase 01-foundation P01 | 3 min | 2 tasks | 11 files |
| Phase 01-foundation P02 | 2 | 2 tasks | 6 files |
| Phase 01-foundation P03 | 2 | 2 tasks | 5 files |
| Phase 02-storage-and-indexing P01 | 4 | 2 tasks | 6 files |
| Phase 02-storage-and-indexing P02 | 6 | 2 tasks | 2 files |
| Phase 02-storage-and-indexing P03 | 5 | 2 tasks | 3 files |
| Phase 02-storage-and-indexing P04 | 12 | 2 tasks | 3 files |
| Phase 03-retrieval-and-context-assembly P01 | 11 | 2 tasks | 5 files |
| Phase 03-retrieval-and-context-assembly P03-02 | 2 | 1 tasks | 2 files |
| Phase 03-retrieval-and-context-assembly P03-03 | 8 | 2 tasks | 5 files |
| Phase 04 P02 | 4 | 2 tasks | 2 files |
| Phase 05-cli-completion P01 | 14 | 2 tasks | 5 files |

## Accumulated Context

### Key Decisions

| Decision | Rationale | Phase |
|----------|-----------|-------|
| stderr-only logging (pino) | stdout is reserved for MCP stdio JSON-RPC transport — any console.log corrupts it silently | Phase 1 |
| zod v4 (not v3) | CLAUDE.md mandates v4 for 14x faster parsing and smaller bundle | Phase 1 |
| BRAIN_CACHE_LOG env var controls log level | No CLI flags, no config file option — env-only per D-14 | Phase 1 |
| execFile (not exec) with promisify for child processes | Avoids shell injection, exact arg control, better error handling — used in capability.ts and ollama.ts | Phase 1 |
| Intel Mac chip_type guard in detectAppleSiliconVRAM | physical_memory on Intel Mac is system RAM, not VRAM — must check chip_type contains "Apple M" | Phase 1 |
| ollama@0.6.3 added as runtime dependency | Required for Ollama lifecycle management (list, pull with stream) | Phase 1 |
| LanceDB schema includes model name + dimension in index_state | Embedding dimension is baked into table schema at creation; mismatch after model change causes silent retrieval failure | Phase 2 |
| Batch embedding (32-64 chunks per request) | N+1 embed pattern turns 1-minute indexing into 15 minutes — must be designed in, not retrofitted | Phase 2 |
| AST-aware chunking via tree-sitter (required, not optional) | Naive line splits produce garbage embeddings; function-boundary chunks are the minimum quality bar | Phase 2 |
| Ollama 120-second timeout + cold-start retry | Model warm-up from disk to VRAM takes 13–46 seconds; default timeouts cause ECONNRESET on first embed call | Phase 2 |
| Hardcoded gitignore + exclusion list before first crawl | Without this, indexer crawls node_modules producing 10-100x bloat and polluted results | Phase 2 |
| apache-arrow@18.1.0 pinned separately | @lancedb/lancedb does not re-export Schema/Field types; must install apache-arrow within peer dep range >=15.0.0 <=18.1.0 | Phase 2 |
| tree-sitter-rust@0.24.0 with --legacy-peer-deps | Latest rust grammar declares peerOptional ^0.22.1; incompatible with 0.25.0 but API works at runtime | Phase 2 |
| createRequire shim in chunker.ts only | All tree-sitter usage is isolated in chunker.ts; no other file imports tree-sitter directly — prevents ESM/CJS conflicts spreading | Phase 2 |
| Arrow function depth threshold of 5 | Exported arrow_function is at AST depth 4 (root > export > lexical_decl > var_declarator > arrow_fn); nested callbacks are depth 6+; threshold 5 is the correct split point | Phase 2 |
| Promise.race for embedBatch timeout (not AbortController) | ollama SDK embed() does not accept signal param; Promise.race with clearTimeout in finally is cleaner than custom fetch wrapper | Phase 2 |
| openOrCreateChunkTable takes projectRoot as 4th param | LanceDB Connection does not expose uri property; projectRoot needed to read index_state.json for mismatch detection | Phase 2 |
| runIndex uses process.exit(1) on missing profile or Ollama not running | Fatal conditions surface as clear stderr errors; zero-file case is non-fatal (return, not exit) | Phase 2 |
| Cosine similarity threshold at 0.7 | Drop chunks below threshold; Ollama models produce normalized vectors; cosine is universal default | Phase 3 |
| Distance threshold 0.3 knowledge / 0.4 diagnostic | Diagnostic queries (errors, bugs) need broader recall (0.6 similarity) vs knowledge queries (0.7 similarity) to surface related context | Phase 3 |
| Keyword-based intent classification (no LLM) | Keeps retrieval fast and fully local — no round-trip to classify query intent | Phase 3 |
| ask-codebase workflow last (Phase 4) | Anthropic SDK called only from this path; must not be introduced before workflows are fully built | Phase 4 |
| MCP handlers guard before workflow dispatch | MCP context cannot tolerate process.exit; handlers check readProfile + isOllamaRunning before calling workflows to prevent exit guards from firing | Phase 4 |
| doctor tool bypasses runDoctor() | runDoctor() prints to stderr and calls process.exit; MCP doctor builds JSON health object directly from services | Phase 4 |
| tsup dual-config with clean:false on MCP entry | CLI gets shebang banner; MCP does not; clean:false prevents MCP build step from deleting CLI output | Phase 4 |
| CLI commands are thin adapters only | Business logic belongs in workflows, not CLI handlers — enables identical behavior from MCP and CLI surfaces | Phase 5 |
| Dynamic import() in CLI for lazy loading | Keeps brain-cache startup fast — Commander best practice, dynamic import per command action | Phase 1 |
| Shebang in tsup banner only | tsup banner.js adds shebang to dist/cli.js — adding it in src causes double shebang SyntaxError in ESM | Phase 1 |
| Workflows call process.exit(1) directly | Not throw — clear exit semantics in CLI context; workflows are the terminal handler | Phase 1 |
| Use indexState.embeddingModel for query embedding | Prevents vector dimension mismatch if embedding model changed between init and index; profile model only drives init | Phase 3 |
| context CLI outputs JSON to stdout; search outputs to stderr only | stdout is MCP transport channel; context command produces the ContextResult payload Claude consumes | Phase 3 |

### Research Flags (resolve during planning)

- **Phase 2:** Tree-sitter grammar coverage — evaluate `supermemory/code-chunk` vs. hand-rolling with `tree-sitter` npm package. Spike needed before Phase 2 planning begins.
- **Phase 3:** ANN index training threshold — LanceDB IVF/HNSW requires minimum row count; verify exact threshold from LanceDB docs during Phase 3 planning.
- **Phase 3:** Token savings calculation — define approach for "estimated tokens without Braincache" (heuristic: count all file tokens in query scope, report delta).
- **Phase 1/2 RESOLVED:** Ollama model pull during `braincache init` — confirmed `ollama.pull({ model, stream: true })` returns AsyncGenerator with progress events. Error handling: null return from isOllamaInstalled blocks init with clear error; model pull failures surfaced via thrown exception caught by init workflow.

### Active Blockers

None.

### Session Notes

- Roadmap created from requirements + research. All 22 v1 requirements mapped to 5 phases.
- Research confidence is HIGH across stack, architecture, and pitfalls.
- Phase 6 from research (reliability / incremental re-indexing) deferred: INC-01, INC-02, EXC-01, ADV-01, ADV-02 are v2 requirements already in REQUIREMENTS.md.

---

## Session Continuity

**Last session:** 2026-04-01T04:48:45.511Z

**To resume:** Read this file, then `cat .planning/ROADMAP.md` to see phase structure.

**Stopped at:** Completed 05-01-PLAN.md

**Next action:** Continue Phase 04 — Plan 2 (ask-codebase workflow)

---
*State initialized: 2026-03-31*
