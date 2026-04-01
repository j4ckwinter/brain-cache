---
phase: 01-foundation
plan: 01
subsystem: infra
tags: [typescript, pino, zod, tsup, vitest, commander, node22]

# Dependency graph
requires: []
provides:
  - "TypeScript project scaffold with brain-cache bin, ESM module type"
  - "tsup build tooling producing dist/cli.js"
  - "vitest test framework configured for tests/**/*.test.ts"
  - "VRAMTier type and CapabilityProfileSchema (zod v4) in src/lib/types.ts"
  - "GLOBAL_CONFIG_DIR, PROFILE_PATH, CONFIG_PATH, PROJECT_DATA_DIR constants in src/lib/config.ts"
  - "Pino logger writing to stderr fd 2, level controlled by BRAIN_CACHE_LOG env var"
  - "childLogger factory for component-scoped logging"
affects:
  - "02-storage-indexing"
  - "03-retrieval-context"
  - "04-mcp-claude"
  - "05-cli-completion"

# Tech tracking
tech-stack:
  added:
    - "pino ^9 (structured JSON logger)"
    - "commander 14.0.3 (CLI framework)"
    - "zod ^4.3.6 (schema validation — upgraded from v3 per CLAUDE.md)"
    - "tsx 4.21.0 (dev TypeScript runner)"
    - "tsup ^8 (build bundler)"
    - "vitest ^2 (test runner)"
    - "pino-pretty ^11 (dev log formatter)"
    - "@types/node ^22"
    - "typescript ^5"
  patterns:
    - "ESM-first: package.json type=module, tsconfig module=Node16"
    - "stderr-only logging: pino.destination(2), stdout reserved for MCP"
    - "Env-var log level: BRAIN_CACHE_LOG controls level, default=warn"
    - "Config dir pattern: ~/.brain-cache/ for global, .brain-cache/ for per-project"

key-files:
  created:
    - "package.json"
    - "tsconfig.json"
    - "tsup.config.ts"
    - "vitest.config.ts"
    - ".nvmrc"
    - "src/lib/types.ts"
    - "src/lib/config.ts"
    - "src/services/logger.ts"
    - "tests/services/logger.test.ts"
  modified:
    - ".gitignore"

key-decisions:
  - "zod upgraded to v4 (per CLAUDE.md stack requirements — 14x faster parsing)"
  - "pino.destination(2) for stderr; stdout strictly reserved for MCP stdio transport"
  - "BRAIN_CACHE_LOG env var only for log level — no CLI flags, no config file option"
  - "ESM module type with Node16 module resolution for full ESM compatibility"

patterns-established:
  - "Logger pattern: import { logger, childLogger } from '../services/logger.js'"
  - "Types pattern: import { VRAMTier, CapabilityProfile } from '../lib/types.js'"
  - "Config pattern: import { GLOBAL_CONFIG_DIR, PROFILE_PATH } from '../lib/config.js'"
  - "Test pattern: vi.resetModules() between env-var-dependent tests for isolation"

requirements-completed: [INF-04]

# Metrics
duration: 3min
completed: 2026-03-31
---

# Phase 01 Plan 01: Project Scaffold and Core Infrastructure Summary

**TypeScript project scaffold with pino stderr logger (fd 2), zod v4 CapabilityProfileSchema, and config path constants forming the foundation for all subsequent plans**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-31T16:44:48Z
- **Completed:** 2026-03-31T16:47:48Z
- **Tasks:** 2 (plus TDD test commit)
- **Files modified:** 11

## Accomplishments

- brain-cache TypeScript project scaffold with ESM, Node16 module resolution, strict mode
- pino logger writing exclusively to stderr fd 2 — stdout preserved clean for MCP stdio transport
- Zod v4 CapabilityProfileSchema with VRAMTier enum, version literal, and nullable fields
- Config path constants establishing ~/.brain-cache/ global dir and .brain-cache/ per-project dir
- 14 passing tests covering schema validation, config constants, and log level resolution

## Task Commits

Each task was committed atomically:

1. **Task 1: Project scaffold with package.json, TypeScript config, build tooling, folder structure** - `c9b4e75` (chore)
2. **Task 2 RED: Failing tests for logger, types, config constants** - `2c9e4d5` (test)
3. **Task 2 GREEN: Implement shared types, config constants, and stderr-only pino logger** - `da43d46` (feat)

## Files Created/Modified

- `package.json` - brain-cache bin, ESM module type, commander/pino/zod deps, tsup/vitest/tsx devDeps
- `tsconfig.json` - strict, Node16 module resolution, ES2022 target
- `tsup.config.ts` - ESM build with CLI entry at src/cli/index.ts
- `vitest.config.ts` - test runner for tests/**/*.test.ts
- `.nvmrc` - pinned to Node 22
- `.gitignore` - added node_modules/, dist/, .brain-cache/
- `src/lib/types.ts` - VRAMTier, CapabilityProfileSchema (zod v4), CapabilityProfile
- `src/lib/config.ts` - GLOBAL_CONFIG_DIR, PROFILE_PATH, CONFIG_PATH, PROJECT_DATA_DIR
- `src/services/logger.ts` - pino to stderr fd 2, BRAIN_CACHE_LOG env var, childLogger
- `tests/services/logger.test.ts` - 14 tests for logger, schema, and config
- `src/{cli,services,workflows,lib,tools}/index.ts` - barrel export placeholders

## Decisions Made

- Upgraded zod to v4 (from the `^3.0.0` initial spec) per CLAUDE.md which mandates zod v4 for 14x faster parsing and smaller bundle. This is a CLAUDE.md-driven adjustment.
- ESM-first module system (`"type": "module"`) with `Node16` module resolution to ensure full ESM compatibility with tsx and tsup.
- pino writes exclusively to fd 2 (stderr). stdout is strictly reserved for MCP JSON-RPC stdio transport — any stdout pollution corrupts MCP communication silently.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - CLAUDE.md Constraint] Upgraded zod from v3 to v4**
- **Found during:** Task 1 (package.json creation)
- **Issue:** CLAUDE.md §Technology Stack explicitly mandates `zod` v4 ("v4 now stable", "14x faster parsing"). Initial package.json spec used `^3.0.0`.
- **Fix:** Installed zod v3 first per spec, then ran `npm install zod@^4.0.0` to meet CLAUDE.md requirement.
- **Files modified:** package.json, package-lock.json
- **Verification:** `node_modules/zod/package.json` shows version `4.3.6`, all tests pass
- **Committed in:** c9b4e75 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (CLAUDE.md stack constraint)
**Impact on plan:** Necessary upgrade to meet project stack requirements. No behavior change to tests or implementation.

## Issues Encountered

None — plan executed cleanly after zod version correction.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- All foundational imports ready: types.ts, config.ts, logger.ts
- Phase 2 (Storage and Indexing) can immediately import from these three modules
- TypeScript compiles cleanly with 0 errors
- 14 tests pass; test framework configured and operational
- Build tooling verified: tsup configured for dist/cli.js output

---
*Phase: 01-foundation*
*Completed: 2026-03-31*

## Self-Check: PASSED

- All 10 files confirmed present on disk
- All 3 commits (c9b4e75, 2c9e4d5, da43d46) confirmed in git log
- TypeScript compiles cleanly (0 errors)
- 14 vitest tests pass
