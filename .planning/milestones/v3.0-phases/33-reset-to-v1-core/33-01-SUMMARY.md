---
phase: 33-reset-to-v1-core
plan: 01
subsystem: core-services
tags: [reset, hardening, incremental-indexing, v3.0]
dependency_graph:
  requires: []
  provides: [v3.0-skill-reshape branch, hardened-core-services, incremental-indexing]
  affects: [src/services, src/workflows, src/lib, src/mcp]
tech_stack:
  added: []
  patterns: [sha256-hash-diff, mutex-write-lock, group-based-pipeline, intent-classification]
key_files:
  created: []
  modified:
    - src/services/ollama.ts
    - src/services/lancedb.ts
    - src/services/chunker.ts
    - src/services/embedder.ts
    - src/services/retriever.ts
    - src/services/tokenCounter.ts
    - src/services/index.ts
    - src/workflows/index.ts
    - src/workflows/buildContext.ts
    - src/workflows/search.ts
    - src/workflows/init.ts
    - src/mcp/index.ts
    - src/lib/config.ts
    - src/lib/types.ts
    - package.json
    - tsup.config.ts
decisions:
  - "Used v1.0 branch as base for v3.0-skill-reshape, ported only hardening (not cherry-pick) to avoid v2.0 file contamination"
  - "Removed format.ts dependency from MCP — simple inline string formatting instead"
  - "Kept 4 MCP tools (index_repo, search_codebase, build_context, doctor) — no trace_flow or explain_codebase"
  - "Updated embedBatchWithRetry signature to return { embeddings, skipped } for caller-side skip reporting"
  - "classifyRetrievalMode added as primary name, classifyQueryIntent kept as deprecated alias"
metrics:
  duration: "~25 minutes"
  completed_date: "2026-04-04"
  tasks_completed: 1
  tasks_total: 1
  files_modified: 16
---

# Phase 33 Plan 01: Create v3.0 Branch from v1.0 Core Summary

Branch `v3.0-skill-reshape` created from v1.0 tag with hardening fixes (phases 6-12) and incremental indexing (phase 10) ported manually onto the v1.0 baseline — no v2.0+ feature files.

## Objective

Create a fresh branch from the v1.0 git tag and port forward the hardening fixes (phases 6-12) and incremental indexing (phase 10) onto the v1.0 core services.

## What Was Done

### Task 1: Create branch from v1.0 and port hardening + incremental indexing

**Branch created:** `v3.0-skill-reshape` from `v1.0` tag

**Hardening changes ported:**

- **ollama.ts**: Added `getOllamaHost()`, OLLAMA_HOST remote guard in `startOllama()`, PID pre-spawn check, signal handler cleanup, `modelMatches()` for safe model comparison
- **lancedb.ts**: Added `withWriteLock()` mutex, `createVectorIndexIfNeeded()` for IVF-PQ index, `readFileHashes()` + `writeFileHashes()` for SHA-256 hash manifest, `deleteChunksByFilePath()`, `edgeSchema()`, `openOrCreateEdgesTable()`, `insertEdges()`, `queryEdgesFrom()`. Fixed `ChunkRow` index signature. Added edges table handling on chunk table reset.
- **chunker.ts**: Updated to return `ChunkResult` (`{ chunks, edges }`) instead of `CodeChunk[]`. Added call edge extraction from `call_expression` nodes and import edge extraction from `import_statement` nodes. Used typed `SyntaxNode` instead of `any`.
- **embedder.ts**: Updated `embedBatchWithRetry()` to return `{ embeddings, skipped }`. Added context-length fallback (per-text individual embedding with skip counting). Added `truncate: true` to embed call.
- **retriever.ts**: Complete rewrite with three-tier intent classification (`lookup`/`trace`/`explore`), `classifyRetrievalMode()` as primary name, `classifyQueryIntent()` as deprecated alias, `RETRIEVAL_STRATEGIES` with `keywordBoostWeight`. Added camelCase keyword boost scoring, `RawChunkRow` typed interface replacing `any`.
- **tokenCounter.ts**: Hoisted separator token count (computed once, not per-iteration) in `assembleContext()`.
- **config.ts**: Added `FILE_READ_CONCURRENCY=20`, `EMBED_MAX_TOKENS=8192`, `DEFAULT_EMBEDDING_DIMENSION=768`, `VECTOR_INDEX_THRESHOLD=256`, `FILE_HASHES_FILENAME`, `TOOL_CALL_OVERHEAD_TOKENS=300`. Updated `DEFAULT_BATCH_SIZE` to 50, `EMBED_TIMEOUT_MS` to 30s, removed `DIAGNOSTIC_*` constants.
- **types.ts**: Added `CallEdge`, `ChunkResult` interfaces. Updated `QueryIntent` to `'lookup' | 'trace' | 'explore'`. Added `totalTokens` to `IndexStateSchema`. Added `filesInContext` to `ContextMetadata`. Added `keywordBoostWeight` to `SearchOptions`.

**Incremental indexing ported:**

- **workflows/index.ts**: Full SHA-256 hash-diff pipeline with `hashContent()`, concurrent file reads (groups of 20), diff computation (new/changed/removed/unchanged), stale chunk deletion, group-based chunk+embed pipeline, call edge insertion, `createVectorIndexIfNeeded()` call, `readFileHashes`/`writeFileHashes`, `force` option. Removed `loadIgnorePatterns` and `formatTokenSavings` imports.

**Other workflow fixes:**

- **workflows/buildContext.ts**: Replaced `process.exit(1)` with `throw new Error(...)`. Added `filesInContext` to metadata. Updated to use `classifyRetrievalMode` and `embedBatchWithRetry` new signature. Added `keywordBoostWeight` to strategy.
- **workflows/search.ts**: Same `process.exit` → throw pattern. Updated to use new `classifyRetrievalMode` and `embedBatchWithRetry` signatures.
- **workflows/init.ts**: Fixed `embedBatchWithRetry` call to pass `undefined` as dimension arg.
- **mcp/index.ts**: 4 tools only (no trace_flow, explain_codebase). Removed format.ts imports. Added `force` param to index_repo. Added `__BRAIN_CACHE_VERSION__` injection. Simple inline string formatting.
- **services/index.ts**: Updated barrel to export only v1.0 core services (no flowTracer, ignorePatterns, sessionStats, cohesion, compression, configLoader, fileWatcher).
- **package.json**: Updated to version 3.0.0, removed chokidar and dedent (and @types/dedent), added metadata fields (description, license, files, engines, homepage, repository, keywords).
- **tsup.config.ts**: Added `define: { __BRAIN_CACHE_VERSION__ }` to both build entries.

**Verified v2.0+ files do NOT exist:**
- src/services/flowTracer.ts — absent
- src/services/cohesion.ts — absent
- src/services/compression.ts — absent
- src/services/fileWatcher.ts — absent
- src/services/configLoader.ts — absent
- src/services/ignorePatterns.ts — absent
- src/services/sessionStats.ts — absent
- src/workflows/traceFlow.ts — absent
- src/workflows/explainCodebase.ts — absent
- src/workflows/watch.ts — absent
- src/lib/claude-md-section.ts — absent
- src/lib/format.ts — absent
- src/lib/statusline-script.ts — absent

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Functionality] Added keywordBoostWeight to retriever.ts strategy**
- **Found during:** Task 1
- **Issue:** v1.0 retriever had no keyword boost logic; the plan required RETRIEVAL_STRATEGIES with keywordBoostWeight
- **Fix:** Ported full keyword boost scoring from HEAD (tiers: exact name, camelCase sub-tokens, filename stem, partial match)
- **Files modified:** src/services/retriever.ts
- **Commit:** 76343ee

**2. [Rule 1 - Bug] Fixed embedBatchWithRetry call in init.ts**
- **Found during:** Task 1 — init.ts had dynamic import of embedBatchWithRetry with old 2-arg signature
- **Issue:** New signature is `(model, texts, dimension, attempt)` but call used `(model, texts)`
- **Fix:** Added `undefined` as third arg (uses DEFAULT_EMBEDDING_DIMENSION)
- **Files modified:** src/workflows/init.ts
- **Commit:** 76343ee

**3. [Rule 2 - Missing Functionality] Added tsup __BRAIN_CACHE_VERSION__ define**
- **Found during:** Task 1 — plan required version injection but tsup.config.ts didn't have it
- **Fix:** Added `define: { __BRAIN_CACHE_VERSION__ }` with version from package.json to both CLI and MCP entries
- **Files modified:** tsup.config.ts
- **Commit:** 76343ee

## Known Stubs

None — all data sources are wired. The MCP output formatting uses simple inline strings instead of format.ts helpers (intentional design for v3.0 simplicity).

## Commits

| Hash | Message |
|------|---------|
| 76343ee | feat(33-01): port hardening + incremental indexing onto v1.0 core |

## Self-Check: PASSED

- Branch v3.0-skill-reshape exists: confirmed
- src/services/lancedb.ts contains readFileHashes: confirmed (1 match)
- src/services/ollama.ts contains OLLAMA_HOST: confirmed (5 matches)
- src/workflows/index.ts contains hashContent: confirmed (2 matches)
- No v2.0+ files exist in src/: confirmed
- No v2.0+ imports: confirmed (grep returns empty)
- chokidar in package.json: 0 matches
- dedent in package.json: 0 matches
