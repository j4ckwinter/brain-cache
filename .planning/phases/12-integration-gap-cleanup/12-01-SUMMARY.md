---
phase: 12-integration-gap-cleanup
plan: 01
subsystem: mcp
tags: [mcp, ollama, typescript, zod, testing]

# Dependency graph
requires:
  - phase: 10-incremental-indexing-and-intent-classification
    provides: runIndex with force option already wired in CLI
  - phase: 08-ollama-process-security
    provides: startOllama with spawn management
provides:
  - index_repo MCP tool with force?: boolean input field
  - OLLAMA_HOST remote guard in startOllama preventing rogue local spawns
  - getOllamaHost() utility for env-aware host resolution
  - tools/index.ts documented as intentionally empty (DEBT-04)
affects: [mcp-tool-consumers, ollama-service-callers]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pre-spawn check: detect if Ollama already running before spawning new process"
    - "Remote host guard: throw descriptive error when OLLAMA_HOST points to non-localhost"
    - "Zod optional boolean: z.boolean().optional().describe(...) for MCP tool flags"

key-files:
  created: []
  modified:
    - src/mcp/index.ts
    - src/services/ollama.ts
    - src/tools/index.ts
    - tests/mcp/server.test.ts
    - tests/services/ollama.test.ts

key-decisions:
  - "Added pre-spawn isOllamaRunning() check to startOllama() — avoids spawning when Ollama already running, required for 127.0.0.1 guard test to pass cleanly"
  - "getOllamaHost() added as exported utility — needed by guard logic and makes OLLAMA_HOST resolution testable"
  - "Updated existing spawn test to mock fetch as failing initially — reflects correct pre-spawn check behavior"

patterns-established:
  - "Pattern: MCP optional boolean flag — z.boolean().optional().describe(...) in inputSchema"
  - "Pattern: Remote host guard — string comparison against known localhost forms before spawning"

requirements-completed: [DEBT-04, DEBT-01, DEBT-03, SEC-02]

# Metrics
duration: 3min
completed: 2026-04-01
---

# Phase 12 Plan 01: Integration Gap Cleanup Summary

**MCP index_repo force reindex wired, OLLAMA_HOST remote spawn guard added with getOllamaHost() utility, tools barrel documented as intentionally empty**

## Performance

- **Duration:** 3 min
- **Started:** 2026-04-01T06:27:48Z
- **Completed:** 2026-04-01T06:31:00Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- index_repo MCP tool now accepts `force?: boolean` and threads it to `runIndex(path, { force })`
- startOllama() throws a descriptive error when OLLAMA_HOST points to a non-localhost address
- getOllamaHost() exported as a reusable utility for OLLAMA_HOST env var resolution
- Pre-spawn check added to startOllama() — skips spawn if Ollama is already running
- tools/index.ts barrel explicitly documents DEBT-04 as intentionally empty

## Task Commits

Each task was committed atomically:

1. **Task 1: Add force option to MCP index_repo tool and update tools barrel** - `66ed4fe` (feat)
2. **Task 2: Add OLLAMA_HOST remote guard to startOllama** - `d741b51` (feat)

## Files Created/Modified
- `src/mcp/index.ts` - Added force?: boolean to index_repo Zod inputSchema, destructure and thread to runIndex
- `src/services/ollama.ts` - Added getOllamaHost(), remote host guard, pre-spawn running check in startOllama()
- `src/tools/index.ts` - Updated comment to explicitly state DEBT-04 intentional empty status
- `tests/mcp/server.test.ts` - Added two test cases for force threading (force=true and undefined)
- `tests/services/ollama.test.ts` - Added tests for remote guard, getOllamaHost, updated spawn test

## Decisions Made
- Added `getOllamaHost()` as an exported function (not referenced in original plan but required for the guard and testability)
- Added pre-spawn `isOllamaRunning()` check in `startOllama()` — the plan referenced a "pre-spawn check" that didn't exist; adding it was necessary for the 127.0.0.1 test expectation (spawn not called when already running) and is also better behavior
- Updated the existing `startOllama` test that mocked fetch as immediately successful — with the pre-spawn check added, fetch returning ok before spawn means spawn is never called; test now correctly mocks ECONNREFUSED first then ok

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added getOllamaHost() function — referenced but missing**
- **Found during:** Task 2 (OLLAMA_HOST remote guard)
- **Issue:** Plan's interface spec listed `getOllamaHost()` as an existing function, but it did not exist in `src/services/ollama.ts`
- **Fix:** Added `export function getOllamaHost(): string` returning `process.env.OLLAMA_HOST ?? 'http://localhost:11434'`
- **Files modified:** src/services/ollama.ts
- **Verification:** getOllamaHost tests pass; guard uses it correctly
- **Committed in:** d741b51 (Task 2 commit)

**2. [Rule 1 - Bug] Added pre-spawn isOllamaRunning() check and updated existing test**
- **Found during:** Task 2 (test for 127.0.0.1 expected spawn not called)
- **Issue:** The plan's test expected `mockSpawn` NOT to be called when Ollama is already running at 127.0.0.1, but existing code always spawned before checking. The existing spawn test also used a fetch stub returning ok from the start, which broke with the new pre-spawn check.
- **Fix:** Added pre-spawn `isOllamaRunning()` check that short-circuits before spawn; updated existing test to mock fetch as ECONNREFUSED first (not running), then ok (running after spawn)
- **Files modified:** src/services/ollama.ts, tests/services/ollama.test.ts
- **Verification:** All 15 ollama tests pass including updated spawn test and new 127.0.0.1 test
- **Committed in:** d741b51 (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 bug)
**Impact on plan:** Both auto-fixes necessary for correctness. getOllamaHost() was a missing prerequisite. Pre-spawn check was implied by the plan's test expectations. No scope creep.

## Issues Encountered
None beyond the auto-fixed deviations above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All 4 requirements satisfied: DEBT-04, DEBT-01, DEBT-03, SEC-02
- 230 tests passing (up from 224 at v1.0 due to new test cases added in phases 10-12)
- Integration gap cleanup complete — v1.1 hardening milestone closing

---
*Phase: 12-integration-gap-cleanup*
*Completed: 2026-04-01*
