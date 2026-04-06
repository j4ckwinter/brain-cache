---
phase: 45-auto-index-retry-test-and-withguards-extraction
plan: 01
subsystem: testing
tags: [vitest, mcp, auto-index]

requires:
  - phase: "44-debt-reduction-and-performance"
    provides: MCP handler structure in src/mcp/index.ts
provides:
  - Four regression tests for search_codebase and build_context auto-index retry (success + double-fail)
  - sessionStats mock for MCP server tests
affects: [45-02 withGuards extraction]

tech-stack:
  added: []
  patterns: ["vi.mock sessionStats alongside existing workflow mocks"]

key-files:
  created: []
  modified:
    - tests/mcp/server.test.ts
    - src/lib/pathValidator.ts
    - tests/lib/pathValidator.test.ts

key-decisions:
  - "macOS temp lives under /var/folders — exempt from blanket /var block before DEBT work breaks unrelated tests"
  - "Traversal tests use anchored paths so resolution hits /etc regardless of process cwd"

patterns-established:
  - "Retry tests: mockRun* reject once then resolve; assert runIndex once and workflow twice"

requirements-completed: [TEST-03]

duration: 12min
completed: 2026-04-06
---

# Phase 45 Plan 01: Auto-index retry tests (TEST-03) Summary

**Adds four MCP integration tests that prove search_codebase and build_context auto-index retry behaviour (including failure after retry), plus a sessionStats mock so success paths stay isolated from real disk.**

## Performance

- **Duration:** ~12 min
- **Tasks:** 1 (plus Rule 3 fix for full suite)
- **Files modified:** 3

## Accomplishments

- `vi.mock` for `sessionStats` with `accumulateStats` resolved stub
- Search: retry success (runIndex ×1, runSearch ×2, “Found 1 result”); double-fail (“after auto-index”)
- build_context: same pattern with `mockRunBuildContext`
- Full `npm test` green after path-validator fix for macOS `/var/folders` temp dirs and stable traversal test inputs

## Task Commits

1. **Task 1: accumulateStats mock + four retry tests** — `test(45-01): add MCP auto-index retry tests and sessionStats mock` (see `git log`)
2. **Rule 3: full suite** — `fix(45-01): allow macOS /var/folders temp paths in path validator`

## Files Created/Modified

- `tests/mcp/server.test.ts` — sessionStats mock; four new describe cases
- `src/lib/pathValidator.ts` — early return for `/var/folders` paths (macOS temp)
- `tests/lib/pathValidator.test.ts` — traversal cases use `/tmp/foo/../../../etc…` so resolution is stable

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] pathValidator + tests failed on macOS full suite**
- **Found during:** Task 1 verification (`npm test`)
- **Issue:** Blanket `/var` block rejected `tmpdir()` under `/var/folders`; traversal tests depended on cwd for `../../etc`
- **Fix:** Whitelist `/var/folders` before `/var` checks; anchor traversal inputs to resolve to `/etc`
- **Files:** `src/lib/pathValidator.ts`, `tests/lib/pathValidator.test.ts`
- **Commit:** second commit on branch

### None otherwise

Plan 01 production code was intentionally unchanged except the Rule 3 fix required for acceptance “full suite green”.

## Known Stubs

None.

## Self-Check: PASSED

- `tests/mcp/server.test.ts` exists with four new test names
- `git log` contains both `test(45-01)` and `fix(45-01)` commits
