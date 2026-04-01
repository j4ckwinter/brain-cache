---
phase: 03-retrieval-and-context-assembly
plan: "03"
subsystem: retrieval
tags: [lancedb, ollama, embeddings, vector-search, token-budget, cli, commander]

# Dependency graph
requires:
  - phase: 03-retrieval-and-context-assembly/03-01
    provides: retriever service (searchChunks, deduplicateChunks, classifyQueryIntent)
  - phase: 03-retrieval-and-context-assembly/03-02
    provides: tokenCounter service (assembleContext, countChunkTokens)
provides:
  - runSearch workflow: embed query -> search -> dedup -> stderr output, returns RetrievedChunk[]
  - runBuildContext workflow: full pipeline + context assembly + ContextResult with 5 metadata fields
  - CLI search command as thin adapter to runSearch
  - CLI context command as thin adapter to runBuildContext, outputs JSON to stdout
affects: [04-mcp-server, 05-cli-completion]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - runSearch and runBuildContext use indexState.embeddingModel (not profile) to prevent vector dimension mismatch
    - estimatedWithoutBraincache computed from unique file token counts in result set
    - reductionPct = round((1 - tokensSent/estimatedWithoutBraincache) * 100), clamped to 0
    - CLI commands follow dynamic import pattern: thin adapter, no business logic in CLI handler

key-files:
  created:
    - src/workflows/search.ts
    - src/workflows/buildContext.ts
    - tests/workflows/search.test.ts
    - tests/workflows/buildContext.test.ts
  modified:
    - src/cli/index.ts

key-decisions:
  - "Use indexState.embeddingModel (not profile.embeddingModel) when embedding query in search/buildContext — prevents vector dimension mismatch if model was changed between init and index"
  - "estimatedWithoutBraincache reads actual source files on disk at query time — gracefully handles deleted files by catching ENOENT"
  - "context command outputs JSON to stdout — MCP transport compatible; search outputs to stderr only"

patterns-established:
  - "Workflow orchestration pattern: profile check -> Ollama check -> index check -> db open -> classify -> embed -> search -> dedup -> assemble"
  - "CLI thin adapter pattern extended to search and context commands with dynamic import"

requirements-completed: [RET-01, RET-04, RET-05]

# Metrics
duration: 8min
completed: 2026-03-31
---

# Phase 3 Plan 03: Search and BuildContext Workflows Summary

**End-to-end query pipeline (embed -> search -> dedup -> token-budget -> metadata) exposed via runSearch, runBuildContext workflows and CLI search/context commands**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-03-31T20:28:32Z
- **Completed:** 2026-03-31T20:36:00Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- runSearch workflow: embed query using indexState model, classify intent, search LanceDB, dedup, print to stderr, return RetrievedChunk[]
- runBuildContext workflow: same pipeline plus assembleContext for token budget, compute all 5 ContextResult metadata fields (tokensSent, estimatedWithoutBraincache, reductionPct, localTasksPerformed, cloudCallsMade)
- CLI search command as thin adapter with --limit and --path options
- CLI context command with --limit, --budget, and --path options; outputs ContextResult JSON to stdout
- 28 tests across search.test.ts and buildContext.test.ts — all passing; full suite 189 tests passing

## Task Commits

Each task was committed atomically:

1. **Task 1 (RED): Failing tests** - `4779e7e` (test)
2. **Task 1 (GREEN): Workflow implementations** - `c0995cf` (feat)
3. **Task 2: Wire CLI commands** - `16d9c3d` (feat)

## Files Created/Modified

- `src/workflows/search.ts` - runSearch workflow orchestrating embed -> search -> dedup
- `src/workflows/buildContext.ts` - runBuildContext workflow with full pipeline and ContextResult metadata
- `src/cli/index.ts` - Added search and context commands as thin adapters
- `tests/workflows/search.test.ts` - 14 unit tests for runSearch
- `tests/workflows/buildContext.test.ts` - 14 unit tests for runBuildContext

## Decisions Made

- **Use indexState.embeddingModel for query embedding** — prevents dimension mismatch if model changed since indexing. Profile model only drives init; all subsequent operations use the stored model.
- **estimatedWithoutBraincache reads source files at query time** — files may be deleted since indexing; ENOENT is caught and skipped silently. Only files in assembled.chunks (post-budget) are read, not all search results.
- **context command → stdout, search → stderr only** — stdout is MCP transport channel; context command produces the JSON payload Claude will consume; search is diagnostic-only.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 3 complete: retriever service, token counter, search + buildContext workflows all implemented and tested
- CLI has init, doctor, index, search, and context commands
- Ready for Phase 4: MCP Server and Claude Integration — runBuildContext is the primary workflow the MCP tool will call

---
*Phase: 03-retrieval-and-context-assembly*
*Completed: 2026-03-31*
