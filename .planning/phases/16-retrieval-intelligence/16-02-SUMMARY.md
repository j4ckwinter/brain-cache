---
phase: 16-retrieval-intelligence
plan: 02
subsystem: retrieval
tags: [bfs, flow-tracing, call-edges, cycle-detection, lancedb, tdd]

# Dependency graph
requires:
  - phase: 15-01
    provides: EdgeRow interface and queryEdgesFrom function in lancedb.ts
  - phase: 15-03
    provides: edges table populated with call/import edges from chunker

provides:
  - traceFlow BFS service for multi-hop call-path tracing
  - resolveSymbolToChunkId helper with same-file locality heuristic
  - FlowHop interface in types.ts

affects: [17-mcp-tools, trace_flow MCP tool]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "BFS with visited Set for cycle detection (canonical pattern, no external lib)"
    - "SQL predicate single-quote escaping via .replace(/'/g, \"''\")"
    - "Locality heuristic: same-file chunk preferred when symbol name matches multiple chunks"

key-files:
  created:
    - src/services/flowTracer.ts
    - tests/services/flowTracer.test.ts
  modified:
    - src/lib/types.ts
    - src/services/lancedb.ts
    - src/services/index.ts

key-decisions:
  - "EdgeRow and queryEdgesFrom added to this worktree's lancedb.ts — Phase 15-01 provides these in main workspace but worktree was at older commit"
  - "FlowHop added to types.ts in this worktree — Plan 16-01 adds it in main workspace but both plans are Wave 1 parallel"
  - "Import edges are filtered out before resolveSymbolToChunkId is called — avoids unnecessary chunk lookups"
  - "maxHops check uses depth >= maxHops (not depth > maxHops) so maxHops=1 means 1 hop from seed"

# Metrics
duration: 3min
completed: 2026-04-02
---

# Phase 16 Plan 02: BFS Flow Tracer Summary

**One-liner:** BFS flow tracer with cycle detection, hop depth cap, and same-file locality heuristic for symbol resolution.

## What Was Built

New `src/services/flowTracer.ts` service providing two exported functions:

- `traceFlow(edgesTable, chunksTable, seedChunkId, opts?)` — BFS traversal over call edges, returns `FlowHop[]` ordered by hop depth
- `resolveSymbolToChunkId(chunksTable, toSymbol, fromFile)` — resolves a symbol name to a chunk ID using locality heuristic

Key behaviors implemented:
- Cycle detection via `Set<string>` visited tracking
- Only `call` edges followed (import edges skipped)
- Dead-end symbols (toSymbol not in chunks table) silently skipped
- Hop depth capped at `maxHops` (default 3) — children not enqueued when `depth >= maxHops`
- SQL injection prevention via `replace(/'/g, "''")` before predicate construction
- Same-file match preferred over cross-file match for symbol resolution

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added EdgeRow interface and queryEdgesFrom to worktree lancedb.ts**
- **Found during:** Task 1 setup — flowTracer.ts imports these from `./lancedb.js` but they didn't exist in the worktree
- **Issue:** Phase 15-01 adds these to the main workspace lancedb.ts, but this worktree is a parallel agent at an older commit
- **Fix:** Added `EdgeRow` interface and `queryEdgesFrom` function to `/workspace/.claude/worktrees/agent-a6ab0898/src/services/lancedb.ts` matching the exact shape from the main workspace
- **Files modified:** src/services/lancedb.ts
- **Commit:** 6678d19

**2. [Rule 3 - Blocking] Added FlowHop interface to worktree types.ts**
- **Found during:** Task 1 setup — flowTracer.ts imports FlowHop from types.ts but it didn't exist
- **Issue:** Plan 16-01 adds FlowHop in the main workspace types.ts, but both plans run as Wave 1 parallel agents
- **Fix:** Added `FlowHop` interface to `/workspace/.claude/worktrees/agent-a6ab0898/src/lib/types.ts`
- **Files modified:** src/lib/types.ts
- **Commit:** 6678d19

## Test Coverage

11 tests passing in `tests/services/flowTracer.test.ts`:

- No outgoing call edges → seed-only result
- Linear chain (seed → A → B) → 3 hops at depths 0, 1, 2
- Cycle (A → B → A) → both chunks appear exactly once
- maxHops=1 → only seed and first hop, queryEdgesFrom not called for second hop
- maxHops=0 → only seed, queryEdgesFrom never called
- Dead-end symbol → trace stops gracefully
- Import edge filtering → only call edges followed
- resolveSymbolToChunkId same-file preference
- resolveSymbolToChunkId cross-file fallback (first match)
- resolveSymbolToChunkId null on no match
- SQL injection escape in symbol names

## Known Stubs

None.

## Self-Check: PASSED
