---
phase: 01-foundation
plan: 03
subsystem: cli
tags: [commander, workflows, init, doctor, ollama, capability-detection]

# Dependency graph
requires:
  - phase: 01-02
    provides: capability detection service, Ollama lifecycle service, logger, types, config
  - phase: 01-01
    provides: project scaffold, tsup config, vitest, pino logger, types, config

provides:
  - runInit workflow: orchestrates GPU detection, Ollama lifecycle, model pull, profile write
  - runDoctor workflow: reads saved profile, re-detects live capabilities, reports Ollama status
  - Commander CLI entry point with brain-cache init and doctor commands
  - Working dist/cli.js binary produced by tsup

affects: [02-storage-indexing, 03-retrieval-context, 04-mcp-server, 05-cli-completion]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Workflow layer: runXxx() functions orchestrate services, handle exit codes, write to stderr"
    - "CLI layer: thin Commander wrappers with dynamic import() for lazy workflow loading"
    - "TDD: write failing tests first, implement to make them pass"

key-files:
  created:
    - src/workflows/init.ts
    - src/workflows/doctor.ts
    - tests/workflows/init.test.ts
  modified:
    - src/workflows/index.ts
    - src/cli/index.ts

key-decisions:
  - "Dynamic import() in CLI commands for lazy loading — keeps brain-cache startup fast"
  - "Shebang in tsup banner only (not src file) — avoids double shebang in ESM output"
  - "Workflows call process.exit(1) directly — not throw — for clear exit semantics in CLI context"

patterns-established:
  - "Workflow pattern: runXxx() async function, all output via process.stderr.write, process.exit(1) for failures"
  - "CLI pattern: program.command().action() with dynamic import('../workflows/xxx.js')"
  - "Test pattern: vi.mock services before importing workflows, spy on process.stderr/stdout/exit"

requirements-completed: [INF-01, INF-02, INF-03, INF-04]

# Metrics
duration: 2min
completed: 2026-03-31
---

# Phase 1 Plan 03: Init and Doctor Workflows Summary

**Commander CLI with init and doctor commands wiring GPU detection, Ollama auto-start, embedding model pull, and profile persistence via runInit/runDoctor workflows**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-31T17:00:13Z
- **Completed:** 2026-03-31T17:02:53Z
- **Tasks:** 2 (+ TDD RED commit)
- **Files modified:** 5

## Accomplishments

- runInit workflow orchestrates full Phase 1 setup: detectCapabilities -> check/start Ollama -> pullModelIfMissing -> writeProfile
- runDoctor workflow reads saved profile, re-detects live capabilities, reports Ollama installed/running/version to stderr
- Commander CLI entry point produces working dist/cli.js with brain-cache init and doctor commands
- All output exclusively via process.stderr.write — zero stdout contamination
- 24 new tests (init.test.ts) + 73 total passing tests across full suite
- CPU-only machines complete init successfully with a warning about slower indexing

## Task Commits

Each task was committed atomically:

1. **TDD RED: init and doctor test suite** - `3fbaab3` (test)
2. **Task 1: init and doctor workflows** - `0c96d82` (feat)
3. **Task 2: Commander CLI entry point** - `ee67f1d` (feat)

## Files Created/Modified

- `src/workflows/init.ts` - runInit(): orchestrates capability detection, Ollama lifecycle, model pull, profile write
- `src/workflows/doctor.ts` - runDoctor(): reads saved profile, re-detects live, reports system health
- `src/workflows/index.ts` - Updated barrel export for init and doctor
- `src/cli/index.ts` - Commander CLI with brain-cache init/doctor commands via dynamic import
- `tests/workflows/init.test.ts` - 24 tests covering runInit and runDoctor behavior

## Decisions Made

- Dynamic import() in CLI action handlers for lazy loading (keeps startup fast per Commander best practice)
- Shebang removed from src/cli/index.ts — tsup banner adds it to dist/cli.js, avoids double shebang in ESM output
- Workflows call process.exit(1) directly rather than throwing, which is the correct CLI contract

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Removed duplicate shebang from src/cli/index.ts**
- **Found during:** Task 2 (CLI implementation + build verification)
- **Issue:** Plan showed `#!/usr/bin/env node` in the src file and tsup config has `banner.js: '#!/usr/bin/env node'` — resulting in double shebang in dist/cli.js causing `SyntaxError: Invalid or unexpected token` when running `node dist/cli.js`
- **Fix:** Removed the shebang from src/cli/index.ts; tsup banner handles it correctly
- **Files modified:** src/cli/index.ts
- **Verification:** `node dist/cli.js --help` shows brain-cache commands, `node dist/cli.js --version` outputs 0.1.0
- **Committed in:** ee67f1d (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Necessary fix for the build to produce a working binary. No scope creep.

## Issues Encountered

None beyond the shebang fix documented above.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Phase 1 is functionally complete: INF-01 (GPU detection + profile), INF-02 (graceful CPU degradation), INF-03 (auto model selection), INF-04 (stderr-only logging) all satisfied end-to-end
- Working binary at dist/cli.js — `brain-cache init` and `brain-cache doctor` are operational
- Phase 2 (Storage and Indexing) can begin: LanceDB + tree-sitter chunking + batch embedding

---
*Phase: 01-foundation*
*Completed: 2026-03-31*

## Self-Check: PASSED

- src/workflows/init.ts: FOUND
- src/workflows/doctor.ts: FOUND
- src/cli/index.ts: FOUND
- tests/workflows/init.test.ts: FOUND
- dist/cli.js: FOUND
- 01-03-SUMMARY.md: FOUND
- Commit 3fbaab3: FOUND
- Commit 0c96d82: FOUND
- Commit ee67f1d: FOUND
