---
phase: 56-technical-debt
plan: 02
subsystem: lancedb-connection-pool
tags: [connection-pool, ttl, health-check, lancedb, debt]
requirements: [DEBT-04]

dependency_graph:
  requires: []
  provides: [ttl-connection-eviction, health-validation-isOpen]
  affects: [src/services/lancedb.ts, src/lib/config.ts]

tech_stack:
  added: []
  patterns: [PoolEntry-with-createdAt, lazy-TTL-eviction, isOpen-health-check]

key_files:
  created: []
  modified:
    - src/lib/config.ts
    - src/services/lancedb.ts
    - tests/services/lancedb.test.ts

decisions:
  - "_setPoolEntryForTest export chosen over vi.spyOn(openDatabase) because getConnection calls openDatabase by internal reference not through module export object — spy would not intercept internal calls"
  - "PoolEntry interface defined module-private (not exported) since consumers only interact via getConnection"
  - "close() guard: only call close() on eviction when isOpen()=true — avoids double-close on already-closed connections"

metrics:
  duration: 398s
  completed: "2026-04-07"
  tasks_completed: 1
  files_modified: 3
---

# Phase 56 Plan 02: TTL Connection Pool Eviction Summary

**One-liner:** LanceDB connection pool upgraded with 30-minute TTL eviction and isOpen() health validation to prevent stale connections in long-running watch sessions (DEBT-04).

---

## What Was Built

Added lazy TTL-based eviction and health validation to the LanceDB connection pool. Previously, the pool cached raw `Connection` objects indefinitely with no expiry or liveness check. This plan replaced the `Map<string, Connection>` with `Map<string, PoolEntry>` (connection + createdAt timestamp), and added logic in `getConnection` to:

1. **TTL eviction**: Entries older than 30 minutes (`CONNECTION_POOL_TTL_MS`) are evicted and replaced on next call.
2. **Health validation**: Entries where `isOpen()` returns false are evicted and replaced.
3. **Force eviction**: `force=true` closes healthy connections before removing the pool entry.
4. **Close guard**: `close()` is only called on eviction if the connection is still healthy — avoids double-close errors.

The TTL constant (`CONNECTION_POOL_TTL_MS = 30 * 60 * 1000`) lives in `src/lib/config.ts` alongside other tunables.

---

## Tasks

### Task 1: Add TTL constant and implement pool eviction with tests (DEBT-04)
**Commit:** `769b7db`
**Files:** `src/lib/config.ts`, `src/services/lancedb.ts`, `tests/services/lancedb.test.ts`
**Status:** Complete — 44/44 tests pass, full suite 559/559 passes

---

## Decisions Made

1. **`_setPoolEntryForTest` export** — `vi.spyOn(module, 'openDatabase')` cannot intercept internal calls because `getConnection` calls `openDatabase` by direct reference within the module closure, not through the exported object. A targeted test-helper export (`_setPoolEntryForTest`) allows injecting mock connections directly into the pool without disk I/O.

2. **PoolEntry kept module-private** — The `PoolEntry` interface is not exported since external consumers interact only through `getConnection`. Keeping it internal avoids API surface bloat.

3. **TTL = 30 minutes** — Conservative value matching typical Claude Code session activity windows. Long enough to avoid connection churn on active projects; short enough to catch zombie connections from idle overnight sessions.

---

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical Functionality] Added `_setPoolEntryForTest` export**
- **Found during:** Task 1 implementation
- **Issue:** The plan specified mocking `openDatabase` via `vi.spyOn`, but `getConnection` calls `openDatabase` by internal module reference. Spying on the module's exported `openDatabase` function does not intercept calls from within the same module — the spy wraps the export, not the internal binding. This caused all 7 new tests to fail or call the real `lancedb.connect`.
- **Fix:** Added `_setPoolEntryForTest(projectRoot, connection, createdAt)` export that injects a `PoolEntry` directly into `_connectionPool`. Tests that need to observe eviction behavior seed the pool with a mock connection then call `getConnection` to trigger eviction logic.
- **Files modified:** `src/services/lancedb.ts`
- **Commit:** `769b7db` (included in task commit)

---

## Known Stubs

None — all functionality is fully wired. The TTL and health logic operates on every `getConnection` call.

---

## Self-Check: PASSED

- src/lib/config.ts: FOUND
- src/services/lancedb.ts: FOUND
- tests/services/lancedb.test.ts: FOUND
- .planning/phases/56-technical-debt/56-02-SUMMARY.md: FOUND
- Commit 769b7db: FOUND
