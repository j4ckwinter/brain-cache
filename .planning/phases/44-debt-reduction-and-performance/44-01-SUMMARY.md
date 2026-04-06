---
phase: 44-debt-reduction-and-performance
plan: 01
subsystem: workflows
tags: [typescript, guards, error-handling, refactor, debt-reduction]

# Dependency graph
requires: []
provides:
  - src/lib/guards.ts with requireProfile() and requireOllama() shared helpers
  - All five non-init workflow files migrated to use shared guard helpers
  - stderr monkey-patch in index.ts documented and properly typed (no any)
affects: [44-02, 44-03, 44-04, future workflow files]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Guard pattern: requireProfile() and requireOllama() are the canonical entry points for workflow precondition checks"
    - "Typed stderr override: use explicit overload signature matching process.stderr.write instead of any"

key-files:
  created:
    - src/lib/guards.ts
  modified:
    - src/lib/index.ts
    - src/workflows/buildContext.ts
    - src/workflows/search.ts
    - src/workflows/index.ts
    - src/workflows/status.ts
    - src/workflows/doctor.ts

key-decisions:
  - "Extracted requireProfile() and requireOllama() to src/lib/guards.ts — single source of truth for guard error messages"
  - "init.ts excluded from guard migration — it creates the profile so profile guards do not apply"
  - "stderr monkey-patch given detailed comment block explaining why it exists and what patterns are suppressed"

patterns-established:
  - "requireProfile: all workflows needing a profile call requireProfile() — not readProfile() + null check inline"
  - "requireOllama: all workflows needing Ollama call requireOllama() — not isOllamaRunning() + throw inline"

requirements-completed: [DEBT-02, DEBT-05]

# Metrics
duration: 8min
completed: 2026-04-06
---

# Phase 44 Plan 01: Guard Extraction and Stderr Monkey-Patch Fix Summary

**Shared requireProfile()/requireOllama() helpers extracted to src/lib/guards.ts, eliminating guard duplication across all five workflow files, with typed stderr monkey-patch replacing untyped `any` overload in index.ts**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-04-06T01:07:00Z
- **Completed:** 2026-04-06T01:15:00Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- Created src/lib/guards.ts with requireProfile() and requireOllama() — single source of truth for guard error messages
- Migrated all five workflow files (buildContext, search, index, status, doctor) from inline guard logic to shared helpers
- Replaced untyped `chunk: any` stderr monkey-patch in index.ts with properly typed overload signature
- Added detailed comment block to stderr patch explaining LanceDB NAPI binding suppression rationale

## Task Commits

Each task was committed atomically:

1. **Task 1: Create shared guard helpers in src/lib/guards.ts** - `bd3ce12` (feat)
2. **Task 2: Replace inline guards in all workflows and tighten stderr monkey-patch** - `b480b7b` (feat)

**Plan metadata:** (docs commit — see below)

## Files Created/Modified
- `src/lib/guards.ts` - New shared guard helpers: requireProfile() and requireOllama()
- `src/lib/index.ts` - Barrel updated to re-export requireProfile and requireOllama
- `src/workflows/buildContext.ts` - Migrated to requireProfile() + requireOllama() from guards.ts
- `src/workflows/search.ts` - Migrated to requireProfile() + requireOllama() from guards.ts
- `src/workflows/index.ts` - Migrated to requireProfile() + requireOllama(); stderr patch typed and documented
- `src/workflows/status.ts` - Migrated to requireProfile() from guards.ts
- `src/workflows/doctor.ts` - Migrated to requireProfile() from guards.ts

## Decisions Made
- Error messages in guards.ts match the exact strings used in the existing workflows, ensuring no behavior change
- doctor.ts retains `detectCapabilities` import from capability.js — only the readProfile guard pattern was moved
- status.ts uses only requireProfile() — no Ollama check needed for status reporting

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- Pre-existing test failures in chunker.test.ts and distribution/pack.test.ts in this worktree (missing WASM files — not present in worktree node_modules). These failures are environment-related and pre-date this plan. All 401 other tests pass.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Guard helpers are in place and exported from src/lib/index.ts — ready for 44-02 (PERF-01, PERF-02)
- No remaining inline guard patterns in any workflow file
- stderr monkey-patch in index.ts is now fully typed and documented

---
*Phase: 44-debt-reduction-and-performance*
*Completed: 2026-04-06*
