---
phase: quick
plan: 260401-ffn
subsystem: mcp
tags: [mcp, testing, vitest, token-savings]
dependency_graph:
  requires: []
  provides: [passing-mcp-tests, vitest-version-define]
  affects: [tests/mcp/server.test.ts, vitest.config.ts]
tech_stack:
  added: []
  patterns: [vitest-define-globals, mcp-response-format]
key_files:
  created: []
  modified:
    - vitest.config.ts
    - tests/mcp/server.test.ts
decisions:
  - "Added __BRAIN_CACHE_VERSION__ define to vitest.config.ts at the top-level defineConfig object (sibling to test), matching tsup.config.ts pattern with value '0.0.0-test'"
  - "Updated build_context success test to split response text on '\\n\\n---\\n' separator before parsing JSON, then assert savings line separately"
metrics:
  duration: "~2 minutes"
  completed: "2026-04-01"
  tasks_completed: 2
  tasks_total: 2
  files_changed: 2
---

# Phase quick Plan 260401-ffn: Fix vitest config and build_context test for token savings summary

Fixed the `__BRAIN_CACHE_VERSION__` define missing from vitest.config.ts (which caused all 17 MCP server tests to fail with ReferenceError) and updated the build_context success test to handle the JSON + plain-text savings line response format.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Fix vitest config and update build_context test | d74f465 | vitest.config.ts, tests/mcp/server.test.ts |
| 2 | Verify full build and test suite | (no separate commit — verification only) | — |

## What Was Done

**Task 1:** Two changes applied atomically:

1. `vitest.config.ts` — added `define: { __BRAIN_CACHE_VERSION__: JSON.stringify('0.0.0-test') }` as a top-level sibling to `test`, mirroring the tsup.config.ts pattern. This unblocked all 17 MCP server tests that were failing with `ReferenceError: __BRAIN_CACHE_VERSION__ is not defined`.

2. `tests/mcp/server.test.ts` — updated the `build_context` "returns JSON ContextResult with metadata on success" test. The response text is now `JSON.stringify(result) + savingsLine` where the savings line is appended after `\n\n---\n`. The test now splits on that separator, parses only the JSON portion, and adds a new assertion: `expect(savingsPart).toBe('brain-cache token savings: 150 tokens sent vs ~1000 without brain-cache (85% reduction)')`.

**Task 2:** `npm run build` succeeded cleanly. `npx vitest run tests/mcp/server.test.ts` — all 17 pass. Full suite (`npx vitest run`) shows pre-existing failures in 5 test files unrelated to this plan (see Deferred Issues below).

## Deviations from Plan

None — plan executed exactly as written. `src/mcp/index.ts` was not modified (savings line implementation was already correct).

## Known Stubs

None. The savings line in `src/mcp/index.ts` is wired to live `result.metadata` values from `runBuildContext`.

## Deferred Issues

Pre-existing test failures (existed before this plan, out of scope):

| File | Count | Root Cause |
|------|-------|------------|
| tests/services/chunker.test.ts | suite error | Native tree-sitter binary ELF mismatch (platform issue) |
| tests/services/embedder.test.ts | 1 | `embedBatch` now passes `truncate: true` but test expects call without it |
| tests/services/retriever.test.ts | 1 | `distanceThreshold` changed from 0.3 to 0.4 in strategy, test not updated |
| tests/workflows/search.test.ts | 10 | Uncommitted `search.ts` adds `table.countRows()` but mock doesn't implement it |
| tests/workflows/index.test.ts | 1 | `embedBatchWithRetry` now called with extra `dimension` arg, test not updated |

## Self-Check: PASSED

- vitest.config.ts: FOUND
- tests/mcp/server.test.ts: FOUND
- commit d74f465: FOUND
