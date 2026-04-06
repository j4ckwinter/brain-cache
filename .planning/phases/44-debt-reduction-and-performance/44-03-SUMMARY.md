---
phase: 44-debt-reduction-and-performance
plan: 03
subsystem: database, services, mcp
tags: [lancedb, lancedb-connection-pool, web-tree-sitter, parser-cache, mcp-factory]

# Dependency graph
requires:
  - phase: 43-bug-fixes-and-correctness
    provides: cross-process locking and token savings unification
provides:
  - getConnection() in lancedb.ts — module-level connection pool per project root
  - _parserCache in chunker.ts — Parser instance reuse per WASM grammar file
  - createMcpServer() in mcp/index.ts — testable MCP server factory
affects: [44-04, 45-testing]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Connection pool pattern: cache lancedb.Connection per project path, never Table handles"
    - "Parser cache pattern: cache Parser instance per WASM filename across extension aliases"
    - "Factory function pattern: MCP server wrapped in createMcpServer() for testability"

key-files:
  created: []
  modified:
    - src/services/lancedb.ts
    - src/services/chunker.ts
    - src/mcp/index.ts

key-decisions:
  - "Cache Connection only, never Table handles — stale Table after --force reindex causes silent wrong-data bugs"
  - "Key parser cache by WASM filename so .ts and .mts share same Parser instance"
  - "getConnection() force param evicts pool entry — callers using --force reindex must pass force=true"

patterns-established:
  - "Connection pool: getConnection(projectRoot, force?) as single entry point for LanceDB connections"
  - "Parser cache: getParser(ext) as single entry point for web-tree-sitter Parser instances"

requirements-completed: [PERF-01, DEBT-07, DEBT-03]

# Metrics
duration: 15min
completed: 2026-04-06
---

# Phase 44 Plan 03: Connection Pooling, Parser Cache, and MCP Factory Summary

**LanceDB connection pool (PERF-01), web-tree-sitter parser instance cache (DEBT-07), and MCP server factory function (DEBT-03) added to reduce per-call overhead and improve testability**

## Performance

- **Duration:** 15 min
- **Started:** 2026-04-06T08:00:00Z
- **Completed:** 2026-04-06T08:11:38Z
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments
- Added `getConnection()` with module-level `_connectionPool` Map to lancedb.ts — one Connection per project path, force eviction on `--force` reindex
- Added `_parserCache` Map and `getParser()` helper to chunker.ts — Parser instances reused per WASM grammar, eliminating per-file Parser construction
- Wrapped all MCP tool registrations in `createMcpServer()` factory function — runtime behavior unchanged, server now instantiable without side effects

## Task Commits

Each task was committed atomically:

1. **Task 1: Add LanceDB connection pool with getConnection()** - `a328d8a` (feat)
2. **Task 2: Add parser instance cache to chunker.ts** - `e297a19` (feat)
3. **Task 3: Wrap MCP server in createMcpServer() factory** - `3819b16` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified
- `src/services/lancedb.ts` - Added `_connectionPool` Map and exported `getConnection()` with force eviction; `openDatabase()` kept as internal implementation
- `src/services/chunker.ts` - Added `_parserCache` Map, `getParser()` helper function; updated `chunkFile()` to use `getParser()` instead of `new Parser()` per call
- `src/mcp/index.ts` - Wrapped server instantiation and all `server.registerTool()` calls inside `createMcpServer()` factory; module-level `const server = createMcpServer()` for runtime entry point

## Decisions Made
- Cache `Connection` only in the pool, never `Table` handles — stale Table handles after `--force` reindex cause silent wrong-data bugs (per STATE.md key pitfall)
- Key the parser cache by WASM filename (not extension) so `.ts` and `.mts` share the same `Parser` instance (both use `tree-sitter-typescript.wasm`)
- Keep `openDatabase()` exported for backward compatibility — it remains the internal implementation called by `getConnection()`

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

Chunker tests (`tests/services/chunker.test.ts`) fail with WASM missing error (`tree-sitter.wasm not found`) — this is a pre-existing infrastructure issue requiring `npm run build` to copy WASM files. Confirmed by stashing changes and verifying same failure. Not caused by this plan's changes.

## Known Stubs

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- `getConnection()` is ready for Plan 04 callers to migrate from `openDatabase()` to `getConnection()`
- `createMcpServer()` export enables future MCP integration tests
- Parser cache is transparent to callers — `chunkFile()` API unchanged

## Self-Check: PASSED

- FOUND: src/services/lancedb.ts (contains `_connectionPool` Map and `getConnection()`)
- FOUND: src/services/chunker.ts (contains `_parserCache` Map and `getParser()`)
- FOUND: src/mcp/index.ts (contains `createMcpServer()` factory)
- FOUND: .planning/phases/44-debt-reduction-and-performance/44-03-SUMMARY.md
- FOUND commit a328d8a: feat(44-03): add LanceDB connection pool with getConnection() (PERF-01)
- FOUND commit e297a19: feat(44-03): add parser instance cache to chunker.ts (DEBT-07)
- FOUND commit 3819b16: feat(44-03): wrap MCP server in createMcpServer() factory (DEBT-03)

---
*Phase: 44-debt-reduction-and-performance*
*Completed: 2026-04-06*
