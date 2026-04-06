---
phase: 45-auto-index-retry-test-and-withguards-extraction
plan: 02
subsystem: mcp
tags: [mcp, withGuards, factory, stdio]

requires:
  - phase: "45-auto-index-retry-test-and-withguards-extraction"
    provides: Plan 01 retry tests (TEST-03)
provides:
  - src/mcp/guards.ts with withGuards (profile, Ollama, optional auto-index retry)
  - src/mcp/server.ts factory createMcpServer + handlers
  - src/mcp/main.ts production stdio entry
  - Removed src/mcp/index.ts; tsup MCP entry is main.ts
affects: [MCP consumers, init workflow dist/mcp.js]

tech-stack:
  added: []
  patterns:
    - "Higher-order withGuards(handler, { autoIndex, operationName })"
    - "doctor registered without withGuards (Option A)"

key-files:
  created:
    - src/mcp/guards.ts
    - src/mcp/server.ts
    - src/mcp/main.ts
  modified:
    - tsup.config.ts
    - tests/mcp/server.test.ts
    - src/tools/index.ts
  deleted:
    - src/mcp/index.ts

key-decisions:
  - "doctor stays a plain handler so health reporting works without a capability profile"
  - "index_repo inner logic unchanged: resolve(path), validateIndexPath, runIndex(resolvedPath, { force })"

patterns-established:
  - "MCP bundle entry is main.ts; tests import server.ts only"

requirements-completed: [DEBT-01, DEBT-03]

duration: 25min
completed: 2026-04-06
---

# Phase 45 Plan 02: withGuards extraction and MCP split (DEBT-01, DEBT-03) Summary

**Centralises profile, Ollama, and auto-index retry in `withGuards`, moves `createMcpServer` to `server.ts`, and uses `main.ts` as the only stdio entry so tests never load transport side effects.**

## Performance

- **Duration:** ~25 min (includes Plan 01)
- **Tasks:** 2 (guards + server/main/build/tests)
- **Files:** 7 changed in refactor commit

## Accomplishments

- `withGuards` implements the prior guard order and retry contract, including DEBT-01 comment on `"No index found"`
- `operationName` preserves `Search failed…`, `Context build failed…`, and after-retry messages
- `index_repo`, `search_codebase`, and `build_context` use `withGuards`; `doctor` does not (commented)
- `dist/mcp.js` built from `src/mcp/main.ts`; all 461 tests pass including four Plan 01 retry tests

## Task Commits

1. **Task 1 + 2: guards, server split, build, tests** — `feat(45-02): extract withGuards and split MCP server entry` (see `git log`)

## Files Created/Modified

- `src/mcp/guards.ts` — `withGuards`, `McpResult`, `WithGuardsOptions`
- `src/mcp/server.ts` — `createMcpServer`, `buildSearchResponse`, `buildContextResponse`, tool registrations
- `src/mcp/main.ts` — `StdioServerTransport` + `createMcpServer`
- `src/mcp/index.ts` — removed
- `tsup.config.ts` — `mcp` entry → `src/mcp/main.ts`
- `tests/mcp/server.test.ts` — dynamic import `../../src/mcp/server.js`
- `src/tools/index.ts` — comment update

## Deviations from Plan

### None — behaviour preserved

- `index_repo` handler keeps `resolve(path)` then `validateIndexPath` then `runIndex(resolvedPath, { force })` (plan pseudocode used `runIndex(path, { force })` without resolve/validate — existing behaviour kept).
- `buildSearchResponse` / `buildContextResponse` remain local functions inside `createMcpServer` in `server.ts` (acceptable per CONTEXT “can stay in server.ts”).

## Known Stubs

None.

## Self-Check: PASSED

- `src/mcp/guards.ts`, `src/mcp/server.ts`, `src/mcp/main.ts` exist; `src/mcp/index.ts` does not
- `npx vitest run tests/mcp/server.test.ts`, `npm run build`, `npm test` all exit 0
- Four Plan 01 retry tests still pass
