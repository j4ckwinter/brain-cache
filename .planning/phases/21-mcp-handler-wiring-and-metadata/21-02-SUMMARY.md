---
phase: 21-mcp-handler-wiring-and-metadata
plan: "02"
subsystem: mcp-tests
tags: [mcp, tests, formatters, pipeline-label, token-savings, assertions]
dependency_graph:
  requires: [src/mcp/index.ts, src/lib/format.ts, tests/mcp/server.test.ts]
  provides: [updated-mcp-handler-test-assertions]
  affects: [tests/mcp/server.test.ts]
tech_stack:
  added: []
  patterns: [text-based-assertions, anti-json-bleed, pipeline-label-verification]
key_files:
  created: []
  modified:
    - tests/mcp/server.test.ts
decisions:
  - "trace_flow mock upgraded to include proper metadata.localTasksPerformed and hopDepth — removed as any cast"
  - "fakeContextResult mock extended with filesInContext: 2 to satisfy buildContextResponse metadata destructuring"
  - "explain_codebase assertion uses 'Architecture overview' (not '# Codebase Architecture Overview') — matches formatToolResponse summary line from handler"
metrics:
  duration_minutes: 3
  tasks_completed: 2
  files_modified: 1
  completed_date: "2026-04-03"
---

# Phase 21 Plan 02: MCP Handler Test Assertion Updates Summary

**One-liner:** Updated all 6 MCP handler test assertions to verify formatted text output instead of JSON, adding Pipeline label and token savings footer assertions for all 4 retrieval tools.

---

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Update index_repo and doctor test assertions | c69e4d1 | tests/mcp/server.test.ts |
| 2 | Update retrieval tool test assertions with Pipeline and savings checks | b6ef50d | tests/mcp/server.test.ts |

---

## What Was Built

### Task 1: index_repo and doctor

Replaced 5 `JSON.parse`-based test assertions with formatted text assertions:

**index_repo success test** (renamed "returns formatted index result on success"):
- Removed `JSON.parse` + `parsed.status/fileCount/chunkCount` assertions
- Added `text.not.toContain('{')`, `text.toContain('Indexed')`, `text.toContain('5 files')`, `text.toContain('42 chunks')`

**doctor tests** — all 4 success cases updated:
1. "returns formatted health output even without profile" — asserts `Ollama:`, `running`, `Embedding model: none`
2. "returns ollamaStatus not_installed when Ollama is missing" — asserts `Ollama: not_installed`
3. "returns formatted full health output when everything is running" — asserts full formatted health lines including VRAM, embedded model, index state
4. "returns ollamaStatus not_running when installed but not running" — asserts `Ollama: not_running`

### Task 2: Retrieval tools (search_codebase, build_context, trace_flow, explain_codebase)

**search_codebase** (renamed "returns formatted ranked list with savings and pipeline on success"):
- Replaced JSON.parse assertions with text assertions for ranked list format
- Added `Pipeline: embed -> search -> dedup` and `Tokens sent to Claude:` assertions

**build_context** (renamed "returns formatted context with savings and pipeline on success"):
- Added `filesInContext: 2` to `fakeContextResult.metadata` mock
- Replaced JSON.parse assertions with text assertions for formatted context
- Added `Pipeline: embed_query -> vector_search -> dedup -> token_budget` and savings assertions

**trace_flow** (renamed "returns formatted hops with savings and pipeline on success"):
- Upgraded mock from `as any` cast to proper typed object with `hopDepth: 0` and `metadata.localTasksPerformed`
- Replaced JSON.parse assertions with text assertions for hop format
- Added `Pipeline: embed_query -> seed_search -> bfs_trace -> compress` and savings assertions

**explain_codebase** (renamed "returns architecture overview with savings and pipeline on success"):
- Removed `# Codebase Architecture Overview` heading assertion (handler uses `formatToolResponse` summary, not a markdown heading)
- Added `Tokens sent to Claude:`, `200`, `Pipeline: embed_query -> vector_search` assertions

---

## Verification Results

1. `grep -c "JSON.parse" tests/mcp/server.test.ts` → **0** (zero remaining)
2. `grep -c "Pipeline:" tests/mcp/server.test.ts` → **4** (one per retrieval tool)
3. `grep -c "Tokens sent to Claude:" tests/mcp/server.test.ts` → **4** (one per retrieval tool)
4. `grep -c "not.toContain" tests/mcp/server.test.ts` → **6** (anti-JSON bleed assertions)
5. `npm run test -- tests/mcp/server.test.ts` → **25 tests passed**
6. `npm run test` full suite → **445 tests passed, 26 test files**

---

## Deviations from Plan

### Auto-fixed Issues

None — plan executed exactly as written with two minor adjustments noted:

**1. [Rule 1 - Bug] explain_codebase heading assertion**
- **Found during:** Task 2
- **Issue:** Plan said to "remove the assertion for `# Codebase Architecture Overview` heading if the handler now uses formatToolResponse" — this was indeed the case; the handler produces `Architecture overview for /my/project.` as summary, not a markdown heading
- **Fix:** Used `toContain('Architecture overview')` instead of the heading string
- **Files modified:** tests/mcp/server.test.ts
- **Commit:** b6ef50d

**2. [Rule 2 - Missing data] filesInContext in fakeContextResult mock**
- **Found during:** Task 2
- **Issue:** `fakeContextResult.metadata` was missing `filesInContext` field required by `buildContextResponse` destructuring in `mcp/index.ts`
- **Fix:** Added `filesInContext: 2` to the mock metadata
- **Files modified:** tests/mcp/server.test.ts
- **Commit:** b6ef50d

---

## Known Stubs

None — all assertions test live formatter output. No hardcoded placeholder values.

---

## Self-Check: PASSED

- [x] tests/mcp/server.test.ts exists and is modified
- [x] `grep -c "JSON.parse" tests/mcp/server.test.ts` returns 0
- [x] Commit c69e4d1 exists (Task 1)
- [x] Commit b6ef50d exists (Task 2)
- [x] Full test suite passes: 445 tests, 0 failures
