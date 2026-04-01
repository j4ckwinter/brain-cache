---
phase: 02-storage-and-indexing
plan: 03
subsystem: storage
tags: [embedder, lancedb, apache-arrow, ollama, vector-storage, timeout, cold-start-retry, arrow-schema]

dependency_graph:
  requires:
    - phase: 02-01
      provides: EMBED_TIMEOUT_MS, COLD_START_RETRY_DELAY_MS, DEFAULT_BATCH_SIZE, IndexStateSchema, CodeChunk
    - phase: 01-01
      provides: childLogger, pino logging setup
  provides:
    - embedBatch (src/services/embedder.ts) — ollama.embed with 120s Promise.race timeout
    - embedBatchWithRetry (src/services/embedder.ts) — single cold-start retry on connection errors
    - chunkSchema (src/services/lancedb.ts) — Apache Arrow Schema with 9 fields
    - openDatabase (src/services/lancedb.ts) — LanceDB connection at .brain-cache/index
    - openOrCreateChunkTable (src/services/lancedb.ts) — table lifecycle with mismatch detection
    - insertChunks (src/services/lancedb.ts) — batch row insertion
    - readIndexState / writeIndexState (src/services/lancedb.ts) — JSON state persistence
    - ChunkRow interface (src/services/lancedb.ts) — typed row shape for LanceDB
  affects:
    - 02-04 (index workflow uses embedder + lancedb services)

tech-stack:
  added: []
  patterns:
    - Promise.race for timeout (not AbortController — ollama SDK does not accept signal directly)
    - Cold-start retry: single attempt=0 guard, 5s delay, recurse with attempt=1
    - isConnectionError: checks 4 error strings case-insensitively (ECONNRESET, ECONNREFUSED, fetch failed, socket hang up)
    - Apache Arrow explicit schema via Schema/Field/FixedSizeList/Float32 from apache-arrow@18.1.0
    - LanceDB makeArrowTable with empty array + schema for table creation
    - JSON sidecar file index_state.json validated by Zod IndexStateSchema

key-files:
  created:
    - src/services/embedder.ts
    - src/services/lancedb.ts
    - tests/services/embedder.test.ts
  modified: []

key-decisions:
  - "Promise.race with clearTimeout+.catch() instead of AbortController — ollama SDK does not expose signal param on embed()"
  - "openOrCreateChunkTable takes projectRoot as 4th param — LanceDB Connection does not expose uri property, cannot derive projectRoot from db object"
  - "timeoutPromise.catch(() => {}) suppresses unhandled rejection when Promise.race wins via embed before timeout fires"
  - "Timeout overridable via 3rd param on embedBatch — enables clean unit tests without fake timers"

patterns-established:
  - "Pattern: timeout via Promise.race with explicit clearTimeout in finally block"
  - "Pattern: cold-start retry with attempt counter (not loop) — prevents infinite recursion"
  - "Pattern: LanceDB table schema with 9-field Arrow Schema including FixedSizeList<Float32> for vector column"

requirements-completed:
  - IDX-04

duration: 5min
completed: "2026-03-31"
---

# Phase 2 Plan 3: Embedder and LanceDB Storage Services Summary

**Ollama batch embedder with 120s Promise.race timeout + cold-start retry, and LanceDB service with explicit Apache Arrow schema for typed vector storage and index state management.**

## Performance

- **Duration:** ~5 minutes
- **Started:** 2026-03-31T17:43:13Z
- **Completed:** 2026-03-31T17:48:45Z
- **Tasks:** 2 (Task 1: TDD, Task 2: implementation)
- **Files modified:** 3 created (embedder.ts, lancedb.ts, embedder.test.ts)

## Accomplishments

- Embedder service: `embedBatch` wraps `ollama.embed()` with `Promise.race` 120s timeout, `embedBatchWithRetry` handles cold-start ECONNRESET with single 5s-delay retry
- LanceDB service: explicit `Schema` with 9 Arrow fields including `FixedSizeList<Float32>` vector column; table lifecycle with model/dimension mismatch detection via `index_state.json`
- 7 embedder unit tests (all pass) covering all 6 specified behaviors plus a no-retry success path
- Full suite: 89/89 tests pass, no regressions

## Task Commits

Each task was committed atomically:

1. **Task 1 RED: Add failing embedder tests** - `d10eef4` (test)
2. **Task 1 GREEN: Implement embedder service** - `2e4712d` (feat)
3. **Task 2: LanceDB storage service** - `ec81e27` (feat)

_Note: Task 1 used TDD — test commit precedes implementation commit._

## Files Created/Modified

- `/workspace/.claude/worktrees/agent-a7123b84/src/services/embedder.ts` — `embedBatch` with Promise.race timeout, `embedBatchWithRetry` with cold-start retry, `isConnectionError` helper
- `/workspace/.claude/worktrees/agent-a7123b84/src/services/lancedb.ts` — `chunkSchema`, `openDatabase`, `openOrCreateChunkTable`, `insertChunks`, `readIndexState`, `writeIndexState`, `ChunkRow` interface
- `/workspace/.claude/worktrees/agent-a7123b84/tests/services/embedder.test.ts` — 7 test cases covering all specified behaviors

## Decisions Made

1. **Promise.race instead of AbortController**: The `ollama` SDK's `embed()` method does not accept a `signal` parameter. Used `Promise.race([embedCall, timeoutPromise])` with `clearTimeout` in `finally` to ensure cleanup.

2. **`openOrCreateChunkTable` takes `projectRoot` as 4th param**: The plan specified a 3-param signature, but LanceDB's `Connection` object does not expose a `uri` property (confirmed at runtime). Without `projectRoot`, the function cannot call `readIndexState`. Added `projectRoot` as a required 4th parameter.

3. **Timeout overridable via 3rd arg on `embedBatch`**: Enables unit testing without fake timers, avoiding a vitest fake-timer unhandled rejection edge case. Default is `EMBED_TIMEOUT_MS` (120s).

4. **`timeoutPromise.catch(() => {})`**: Prevents unhandled rejection warning when the embed call wins the race and `clearTimeout` runs but the timeout callback was already scheduled in vitest's fake timers.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `openOrCreateChunkTable` signature extended with `projectRoot`**
- **Found during:** Task 2 (LanceDB service)
- **Issue:** Plan specified `openOrCreateChunkTable(db, model, dim)` (3 params). To read `index_state.json` for mismatch detection, the function needs `projectRoot`. LanceDB's `Connection` object exposes only `['inner']` and prototype methods — no `uri` property. Without `projectRoot`, the mismatch check would always return null, silently recreating the table every time.
- **Fix:** Added `projectRoot: string` as the 2nd parameter (after `db`), shifting `model` and `dim` to 3rd and 4th.
- **Files modified:** `src/services/lancedb.ts`
- **Verification:** TypeScript compiles, function tested in vitest, mismatch detection logic verified via inspection
- **Committed in:** ec81e27

---

**Total deviations:** 1 auto-fixed (Rule 1 — bug/correctness fix on function signature)
**Impact on plan:** Signature change is necessary for correct model mismatch detection. Callers (index workflow in Plan 04) simply pass `projectRoot` which they already have.

## Issues Encountered

- **Vitest fake timer + Promise.race unhandled rejection**: When using `vi.useFakeTimers()` with `advanceTimersByTimeAsync`, the timeout callback fires during timer advancement and rejects `timeoutPromise` before the test's `expect(...).rejects` handler attaches. Fixed by switching to a real 1ms timeout in the unit test (avoids fake timers entirely for the timeout test).

## Known Stubs

None. All exports are fully implemented.

## Next Phase Readiness

- `embedBatch` and `embedBatchWithRetry` ready for use in index workflow (Plan 04)
- `openDatabase`, `openOrCreateChunkTable`, `insertChunks` ready for index workflow
- `readIndexState` / `writeIndexState` ready for index workflow
- Plan 02-02 (chunker service) provides `CodeChunk[]` that index workflow passes to embedder + lancedb
- No blockers for Plans 02-02 or 02-04

---
*Phase: 02-storage-and-indexing*
*Completed: 2026-03-31*
