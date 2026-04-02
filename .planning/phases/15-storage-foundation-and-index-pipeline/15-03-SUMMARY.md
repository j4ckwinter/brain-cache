---
phase: 15-storage-foundation-and-index-pipeline
plan: 03
subsystem: indexing
tags: [tree-sitter, lancedb, call-edges, import-edges, chunker, index-pipeline, ignore-patterns]

# Dependency graph
requires:
  - phase: 15-01
    provides: CallEdge, ChunkResult types and openOrCreateEdgesTable/insertEdges/withWriteLock in lancedb service
  - phase: 15-02
    provides: loadIgnorePatterns service and crawlSourceFiles extraIgnorePatterns support

provides:
  - chunkFile returning ChunkResult with both chunks and edges (call + import)
  - Index workflow loading .braincacheignore, passing to crawler, opening edges table, inserting edges per group
  - Edge deletion alongside chunk deletion for removed/changed files

affects: [16-retrieval-intelligence, 17-mcp-tools, trace_flow tool]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Single AST traversal pattern: run edge extraction for ALL nodes before chunk-type guard"
    - "ChunkResult destructuring in index pipeline: const { chunks, edges } = chunkFile(...)"
    - "groupEdges accumulator mirrors groupChunks pattern in group-based pipeline"

key-files:
  created: []
  modified:
    - src/services/chunker.ts
    - src/workflows/index.ts
    - tests/workflows/index.test.ts

key-decisions:
  - "Edge extraction runs before the nodeTypes.has() guard so call_expression and import_statement nodes are not skipped"
  - "currentChunkId tracking is approximate — updates when a chunkable node is pushed, not on node entry"
  - "toFile is null at index time for call edges — resolved at query time, not index time"
  - "Import edges use filePath:0 as fromChunkId since imports are file-level not function-level"

patterns-established:
  - "Single-pass edge extraction: process edge types first, then apply chunkable-node filter"

requirements-completed: [EXC-01, FLOW-01]

# Metrics
duration: 5min
completed: 2026-04-02
---

# Phase 15 Plan 03: Chunker Edge Extraction and Index Pipeline Summary

**chunkFile now returns ChunkResult with call/import edges extracted in a single AST traversal, and the index pipeline stores edges alongside chunks with .braincacheignore support**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-04-02T19:07:56Z
- **Completed:** 2026-04-02T19:13:30Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Extended chunker to extract call edges from `call_expression` nodes and import edges from `import_statement` nodes in a single `walkNodes` traversal — no double-parse
- Changed `chunkFile` return type from `CodeChunk[]` to `ChunkResult` with `{ chunks, edges }` destructuring
- Updated index workflow to load `.braincacheignore` patterns, pass them to `crawlSourceFiles`, open the edges table, accumulate and insert edges per group, and delete edges for removed/changed files
- Updated test suite to mock new service functions (`openOrCreateEdgesTable`, `insertEdges`, `withWriteLock`, `loadIgnorePatterns`) and fix `chunkFile` mock to return `ChunkResult`
- All 269 tests passing, TypeScript compiles cleanly

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend chunker to extract call/import edges and return ChunkResult** - `384fcd7` (feat)
2. **Task 2: Wire index workflow to consume edges, store in edges table, and load .braincacheignore** - `81ff10d` (feat)

**Plan metadata:** (docs commit below)

## Files Created/Modified
- `src/services/chunker.ts` - Updated: ChunkResult return type, call/import edge extraction in single walkNodes pass
- `src/workflows/index.ts` - Updated: loadIgnorePatterns, openOrCreateEdgesTable, insertEdges, edge deletion, edge count log
- `tests/workflows/index.test.ts` - Updated: new mocks for edges/ignore services, chunkFile mock returns ChunkResult

## Decisions Made
- Edge extraction is positioned **before** the `!nodeTypes.has(node.type)` guard in the loop so `call_expression` and `import_statement` nodes are not skipped by the chunk-type filter
- `currentChunkId` is updated **after** pushing a chunk, making it approximate for top-level call expressions (they use `filePath:0` fallback) — acceptable for Phase 15
- `toFile` for call edges is `null` at index time and resolved at query time — avoids complex symbol resolution during indexing
- Import edges always use `filePath:0` as `fromChunkId` because imports are file-level constructs

## Deviations from Plan

None - plan executed exactly as written, with one structural clarification: the plan placed call/import edge extraction after the chunk push block (inside the chunkable-node section), but `call_expression` and `import_statement` are not in `nodeTypes` so they would be skipped. Extraction was moved to before the `!nodeTypes.has()` guard to run for all nodes, matching the plan's stated intent ("This runs for ALL nodes, not just chunkable ones").

## Issues Encountered
None - TypeScript type checking immediately surfaced the `chunkFile` return type change as an error in `index.ts`, driving the correct fix sequence.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 15 complete: edges table schema (Plan 01), .braincacheignore patterns (Plan 02), and edge extraction + pipeline wiring (Plan 03) all done
- Phase 16 (retrieval intelligence) can query the edges table for multi-hop flow tracing
- Phase 17 (MCP tools) can expose `trace_flow` using the edges data
- Running `brain-cache index` on any TypeScript project now populates both the chunks table and the edges table

---
*Phase: 15-storage-foundation-and-index-pipeline*
*Completed: 2026-04-02*
