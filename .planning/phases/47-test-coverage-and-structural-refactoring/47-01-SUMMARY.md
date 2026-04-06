---
phase: 47-test-coverage-and-structural-refactoring
plan: 01
subsystem: workflows
tags: [refactor, index, token-savings]

requires:
  - phase: 46
provides:
  - Exported helpers computeFileDiffs, processFileGroup, printSummary and types FileDiffResult, IndexGroupStats
  - runIndex pipeline composed from extracted functions
  - Verification that computeTokenSavings is the single utility (MCP server imports and uses it)
affects: [maintainability, tests]

tech-stack:
  added: []
  patterns:
    - "Index workflow: diff → per-group processing → summary as named units"

key-files:
  created: []
  modified:
    - src/workflows/index.ts
    - tests/workflows/index.test.ts

key-decisions:
  - "Table type imported from @lancedb/lancedb for processFileGroup parameters"

requirements-completed: [REFAC-01, REFAC-02, REFAC-03]

duration: —
completed: 2026-04-06
---

# Phase 47 Plan 01: Index workflow split and token savings verification

## What shipped

- **`src/workflows/index.ts`**: `runIndex` delegates to **`computeFileDiffs`**, **`processFileGroup`**, and **`printSummary`**; types **`FileDiffResult`** and **`IndexGroupStats`** exported for tests and callers.
- **Token savings**: Confirmed **`computeTokenSavings`** in `src/lib/tokenSavings.ts` is used by **`src/mcp/server.ts`** (no duplicate savings math in handlers).
- **Tests** (`tests/workflows/index.test.ts`): coverage for the new helpers, incremental re-index file removal (`deleteChunksByFilePaths`), and embedding dimension fallback for unknown models.

## Notes

- Phase 45 MCP structure (withGuards / factory) was already in place; this plan focused on index workflow structure and savings unification checks.
