---
phase: 33-reset-to-v1-core
plan: 02
subsystem: testing
tags: [vitest, build, mcp, chunker, retriever, embedder, incremental-indexing]

dependency_graph:
  requires:
    - phase: 33-01
      provides: v3.0-skill-reshape branch with hardened core services and incremental indexing
  provides:
    - green-build (npm run build exits 0, dist/ produced)
    - green-tests (226 tests passing across 15 test files)
    - validated-mcp-server (exactly 4 tools: index_repo, search_codebase, build_context, doctor)
  affects: [phase-34-statusline-port]

tech-stack:
  added: []
  patterns:
    - Tests updated to match v1.1 API surface (ChunkResult destructuring, new return types)
    - Error propagation via throw — no process.exit() in workflow tests
    - Mock strategy: declare classifyRetrievalMode + classifyQueryIntent (alias) in retriever mock

key-files:
  created: []
  modified:
    - tests/services/chunker.test.ts
    - tests/services/embedder.test.ts
    - tests/services/ollama.test.ts
    - tests/services/retriever.test.ts
    - tests/workflows/buildContext.test.ts
    - tests/workflows/index.test.ts
    - tests/workflows/init.test.ts
    - tests/workflows/search.test.ts
    - tests/mcp/server.test.ts
    - package-lock.json

key-decisions:
  - "Updated tests to match new API surface rather than reverting source to old API — v1.1 improvements are correct"
  - "retriever tests now use lookup/trace/explore modes (v1.1 intent classification)"
  - "MCP server tests updated to assert formatted text output (not JSON) for search_codebase, build_context, doctor"
  - "buildContext estimatedWithoutBraincache formula includes TOOL_CALL_OVERHEAD_TOKENS (300 per tool call)"

patterns-established:
  - "ChunkResult destructuring: const { chunks, edges } = chunkFile(...)"
  - "embedBatchWithRetry destructuring: const { embeddings, skipped } = await embedBatchWithRetry(...)"

requirements-completed:
  - SKILL-02

duration: 13min
completed: 2026-04-04
---

# Phase 33 Plan 02: Verify Build and Tests Summary

**Green build (zero TS errors) and 226 passing tests on v3.0-skill-reshape branch, with validated 4-tool MCP server**

## Performance

- **Duration:** ~13 min
- **Started:** 2026-04-04T09:54:00Z
- **Completed:** 2026-04-04T10:07:00Z
- **Tasks:** 2
- **Files modified:** 10

## Accomplishments

- Build succeeds: `npm run build` exits 0, dist/ produced with both CLI and MCP entries
- All 226 tests pass across 15 test files (zero failures)
- MCP server registers exactly 4 tools (index_repo, search_codebase, build_context, doctor) — verified by `grep -c "registerTool" src/mcp/index.ts` returning 4
- No test files for removed v2.0+ services exist on branch

## Task Commits

1. **Task 1: Fix compilation errors and ensure build succeeds** - `97508f2` (chore)
2. **Task 2: Fix tests and validate MCP tool registration** - `d94b569` (test)

## Files Created/Modified

- `tests/services/chunker.test.ts` - Updated to destructure `{ chunks, edges }` from chunkFile(); added edges assertion
- `tests/services/embedder.test.ts` - Updated embedBatch to expect `truncate: true`; embedBatchWithRetry returns `{ embeddings, skipped }`
- `tests/services/ollama.test.ts` - Fixed startOllama test: first fetch must return false (pre-spawn guard)
- `tests/services/retriever.test.ts` - Updated classifyQueryIntent tests to use lookup/explore modes; RETRIEVAL_STRATEGIES uses new keys
- `tests/workflows/buildContext.test.ts` - Mock uses classifyRetrievalMode; estimatedWithoutBraincache includes tool call overhead
- `tests/workflows/index.test.ts` - chunkFile mock returns `{ chunks, edges }`; added incremental indexing function mocks
- `tests/workflows/init.test.ts` - embedBatchWithRetry called with 3rd arg (undefined dimension)
- `tests/workflows/search.test.ts` - Mock exports classifyRetrievalMode; error handling tests use throw assertions
- `tests/mcp/server.test.ts` - search_codebase/build_context/doctor return formatted text (not JSON)
- `package-lock.json` - Updated for --legacy-peer-deps install

## Decisions Made

- Updated tests to match v1.1 API surface rather than reverting source to old API. The v1.1 improvements (error propagation via throw, ChunkResult return type, embedBatchWithRetry returning `{ embeddings, skipped }`) are correct behavior.
- MCP server test: `search_codebase` and `build_context` now assert formatted text strings because the v3.0 MCP handlers return human-readable text with token savings footer (not raw JSON).
- `doctor` tool test updated to assert text contains status labels (`running`, `not_installed`, `not_running`) rather than parsing JSON.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Functionality] Added incremental indexing function mocks to index.test.ts**
- **Found during:** Task 2 — index.ts imports readFileHashes, writeFileHashes, withWriteLock, etc. but test mock only had 4 lancedb functions
- **Issue:** Test would throw "not mocked" errors for new lancedb functions
- **Fix:** Added complete mock coverage for all lancedb functions used by incremental indexing pipeline
- **Files modified:** tests/workflows/index.test.ts
- **Commit:** d94b569

**2. [Rule 1 - Bug] Updated embedBatchWithRetry mock return values in 3 test files**
- **Found during:** Task 2 — source now returns `{ embeddings, skipped }` but mocks returned `number[][]`
- **Issue:** Workflow code destructures `const { embeddings } = await embedBatchWithRetry(...)` — old mock caused runtime errors
- **Fix:** Updated all mocks to return `{ embeddings: [...], skipped: 0 }`
- **Files modified:** tests/workflows/search.test.ts, tests/workflows/buildContext.test.ts, tests/workflows/index.test.ts
- **Commit:** d94b569

**3. [Rule 1 - Bug] Fixed startOllama test for pre-spawn isOllamaRunning guard**
- **Found during:** Task 2 — test used single fetch mock resolving `{ ok: true }` but new code calls isOllamaRunning first
- **Issue:** Pre-spawn guard saw Ollama "already running" and returned without calling spawn
- **Fix:** Mock first fetch call to return `{ ok: false }` (not running), subsequent calls return `{ ok: true }`
- **Files modified:** tests/services/ollama.test.ts
- **Commit:** d94b569

---

**Total deviations:** 3 auto-fixed (1 missing functionality, 2 bugs)
**Impact on plan:** All fixes necessary for test correctness. No scope creep.

## Known Stubs

None — all tests assert actual implementation behavior.

## Issues Encountered

- `npm install` failed with ERESOLVE due to tree-sitter peer dependency conflicts. Resolved with `--legacy-peer-deps` flag. This is a pre-existing tree-sitter ecosystem issue unrelated to v3.0 changes.

## Next Phase Readiness

- v3.0-skill-reshape branch is in a clean, shippable state
- Build produces dist/ with both CLI and MCP entries
- 226 tests pass, 4 MCP tools registered
- Ready for Phase 34: status line cherry-pick

## Self-Check: PASSED

- SUMMARY.md exists at .planning/phases/33-reset-to-v1-core/33-02-SUMMARY.md: FOUND
- Commit 97508f2 (chore: install deps): FOUND
- Commit d94b569 (test: update tests): FOUND

---
*Phase: 33-reset-to-v1-core*
*Completed: 2026-04-04*
