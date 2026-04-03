---
phase: 16-retrieval-intelligence
plan: "03"
subsystem: retrieval
tags: [cohesion, context-grouping, flow-tracing, intent-routing, buildContext]
dependency_graph:
  requires: [16-01, 16-02]
  provides: [COH-01, FLOW-01, INTENT-01]
  affects: [src/workflows/buildContext.ts, src/services/cohesion.ts]
tech_stack:
  added: []
  patterns:
    - File-grouped context output with "// ── {filePath} ──" headers
    - Parent class enrichment within token budget via SQL chunk lookup
    - BFS flow tracing via traceFlow with FlowHop→RetrievedChunk conversion
    - Mode-specific localTasksPerformed arrays for observability
key_files:
  created:
    - src/services/cohesion.ts
    - tests/services/cohesion.test.ts
  modified:
    - src/workflows/buildContext.ts
    - tests/workflows/buildContext.test.ts
decisions:
  - enrichWithParentClass inserts parents before their methods (splice at index) for natural source ordering
  - traceFlow result converted to RetrievedChunk with similarity = 1 - (hopDepth * 0.1) for decreasing relevance by depth
  - trace fallback to explore mode (not lookup) when no edges table exists — explore gives broader results
  - localTasksPerformed is mode-specific array (trace vs lookup/explore) for accurate observability
  - Pre-existing tsc errors in lancedb.ts (duplicate index signatures) are out of scope for this plan
metrics:
  duration_seconds: 200
  completed_date: "2026-04-03"
  tasks_completed: 2
  files_created: 2
  files_modified: 2
---

# Phase 16 Plan 03: Cohesion Grouping and Full Retrieval Intelligence Wiring Summary

**One-liner:** File-grouped context output with parent class enrichment and BFS flow tracing via cohesion service wired into buildContext workflow.

## What Was Built

### Task 1: Cohesion Service (TDD)

Created `src/services/cohesion.ts` with three exported functions:

- **`groupChunksByFile`**: Groups `RetrievedChunk[]` into a `Map<string, RetrievedChunk[]>` keyed by `filePath`. Sorts chunks within each group by `startLine` ascending (source order).

- **`enrichWithParentClass`**: For each `method` chunk with a non-null `scope`, queries the chunks table for a `class` chunk matching the scope name in the same file. Adds the parent before the method if it fits within the remaining token budget and is not already in the chunk set. Uses SQL escaping (`'` → `''`) to prevent injection.

- **`formatGroupedContext`**: Converts `Map<string, RetrievedChunk[]>` to a formatted string. Each file section starts with `// ── {filePath} ──`, chunks are separated by `\n\n`, and sections by `\n\n---\n\n`.

All 13 tests pass covering: empty input, multi-file grouping, startLine ordering, parent enrichment, token budget enforcement, deduplication, and output format.

### Task 2: buildContext Workflow Wiring

Updated `src/workflows/buildContext.ts` with full retrieval intelligence routing:

**Trace mode (with edges table):**
1. Seed search via `searchChunks` with trace strategy (limit=3)
2. BFS flow trace via `traceFlow(edgesTable, table, seeds[0].id, { maxHops: 3 })`
3. Convert `FlowHop[]` to `RetrievedChunk[]` with `similarity = 1 - (hopDepth * 0.1)`
4. Assemble context, apply cohesion grouping
5. `localTasksPerformed`: `['embed_query', 'seed_search', 'bfs_trace', 'cohesion_group', 'token_budget']`

**Trace mode fallback (no edges table):**
- Logs warning: "No edges table found, falling back to explore mode"
- Falls through to explore mode behavior

**Lookup/explore mode:**
1. Vector search + deduplication
2. `enrichWithParentClass` for parent class chunks
3. `groupChunksByFile` + `formatGroupedContext` for file-grouped output
4. `localTasksPerformed`: `['embed_query', 'vector_search', 'dedup', 'parent_enrich', 'cohesion_group', 'token_budget']`

Stderr log updated to show `intent=` (was `mode=`).

Updated `tests/workflows/buildContext.test.ts` with 22 tests covering all modes and new cohesion/trace behaviors.

## Verification

- `npx vitest run tests/services/cohesion.test.ts` — 13/13 pass
- `npx vitest run tests/workflows/buildContext.test.ts` — 22/22 pass
- `npx vitest run` — 305/305 pass (full suite, zero regressions)
- `npx tsc --noEmit` — 2 pre-existing errors in `lancedb.ts` (duplicate index signatures, out of scope)

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — all functions are fully wired with real data sources.

## Self-Check: PASSED
