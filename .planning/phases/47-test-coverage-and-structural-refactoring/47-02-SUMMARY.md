---
phase: 47-test-coverage-and-structural-refactoring
plan: 02
subsystem: cli-tests
tags: [vitest, commander, askCodebase]

requires:
  - phase: 47-01
provides:
  - CLI integration tests with mocked workflows
  - askCodebase API error-path tests
affects: [regression-safety]

tech-stack:
  added: []
  patterns:
    - "CLI entry: export program + isMain guard so tests import without executing parse"

key-files:
  created:
    - tests/cli/cli.test.ts
  modified:
    - src/cli/index.ts
    - tests/workflows/askCodebase.test.ts
    - tests/workflows/index.test.ts

key-decisions:
  - "Doctor/status mocks assert toHaveBeenCalled() with no args (not undefined)"

requirements-completed: [TEST-02, TEST-04, TEST-05, TEST-06]

duration: —
completed: 2026-04-06
---

# Phase 47 Plan 02: CLI and edge-case tests

## What shipped

- **`src/cli/index.ts`**: **`export const program`**; **`isMain`** via `import.meta.url` vs `process.argv[1]` so dynamic imports in tests do not run the CLI.
- **`tests/cli/cli.test.ts`**: Subcommands `init`, `index` (default / `--force` / path), `search`, `status`, `doctor`; search without query throws; doctor/status mocks match zero-argument calls.
- **`tests/workflows/askCodebase.test.ts`**: API error paths (missing key, rate limit, generic server error).

## Notes

- Index workflow edge cases (file deletion re-index, dimension fallback) live primarily in `tests/workflows/index.test.ts` alongside 47-01.
