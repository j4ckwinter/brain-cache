---
phase: 60-dependency-upgrades
plan: 01
subsystem: testing
tags: [vitest, typescript, tsup, tsconfig, devDependencies]

# Dependency graph
requires: []
provides:
  - vitest v4.1.3 test runner (all 559 tests passing)
  - TypeScript 6.0.2 compiler with zero type errors
  - tsup DTS generation with ignoreDeprecations workaround
  - tsconfig with explicit types: ["node"] for TS6 compatibility
affects: [60-02, 61-test-coverage]

# Tech tracking
tech-stack:
  added: [vitest@4.1.3, typescript@6.0.2]
  patterns:
    - "vi.clearAllMocks() in beforeEach when vi.resetModules() is used in afterEach"
    - "Regular function syntax in vi.fn().mockImplementation() for constructor mocks"
    - "ignoreDeprecations: '6.0' in tsup dts.compilerOptions for TS6 baseUrl bug workaround"

key-files:
  created: []
  modified:
    - package.json
    - package-lock.json
    - tsconfig.json
    - tsup.config.ts
    - tests/workflows/askCodebase.test.ts
    - tests/workflows/index.test.ts
    - tests/workflows/init.test.ts
    - tests/workflows/search.test.ts
    - tests/mcp/server.test.ts
    - tests/distribution/pack.test.ts

key-decisions:
  - "Use ignoreDeprecations: '6.0' in tsup dts.compilerOptions — suppresses tsup baseUrl injection error until tsup PR #1390 ships"
  - "Add vi.clearAllMocks() in beforeEach for tests using vi.resetModules() in afterEach — vitest v4 no longer clears mock call history via restoreAllMocks"
  - "Convert vi.fn().mockImplementation(() => ...) arrow functions to regular functions for constructor mocks — vitest v4 enforces function/class requirement for new operator"
  - "Increase distribution/pack.test.ts timeout from 5000ms to 60000ms — build step takes >5s"

patterns-established:
  - "Pattern 1: When mocking classes used with new operator, use function () {} not () => {} in mockImplementation"
  - "Pattern 2: Use vi.clearAllMocks() at start of beforeEach when dynamic imports and resetModules are involved"

requirements-completed: [DEP-03, DEP-04]

# Metrics
duration: 7min
completed: 2026-04-07
---

# Phase 60 Plan 01: Dependency Upgrades (vitest + TypeScript) Summary

**vitest upgraded from v2 to v4.1.3 and TypeScript from 5.x to 6.0.2, with tsconfig, tsup, and 5 test files updated to resolve vitest v4 breaking changes — all 559 tests passing**

## Performance

- **Duration:** 7 min
- **Started:** 2026-04-07T13:09:17Z
- **Completed:** 2026-04-07T13:16:30Z
- **Tasks:** 1
- **Files modified:** 10

## Accomplishments

- vitest v4.1.3 installed with full test suite passing (559 tests, 34 files)
- TypeScript 6.0.2 installed with zero tsc --noEmit type errors
- tsconfig.json updated with `"types": ["node"]` for TS6 explicit types requirement
- tsup.config.ts updated with `ignoreDeprecations: "6.0"` on both DTS entries for tsup baseUrl injection bug
- Build succeeds with DTS generation (`npm run build` exits 0)

## Task Commits

1. **Task 1: Upgrade vitest to v4 and TypeScript to 6.0 with config fixes** - `e372616` (feat)

## Files Created/Modified

- `package.json` - Bumped vitest to ^4.1.3 and typescript to ^6.0.2
- `package-lock.json` - Updated lockfile with new dependency tree
- `tsconfig.json` - Added `"types": ["node"]` to compilerOptions for TS6
- `tsup.config.ts` - Changed `dts: true` to `dts: { compilerOptions: { ignoreDeprecations: "6.0" } }` on both entries
- `tests/workflows/askCodebase.test.ts` - Fixed constructor mock arrow function → regular function
- `tests/workflows/index.test.ts` - Added vi.clearAllMocks() to beforeEach
- `tests/workflows/init.test.ts` - Added vi.clearAllMocks() to all 6 describe block beforeEach calls
- `tests/workflows/search.test.ts` - Added vi.clearAllMocks() to beforeEach
- `tests/mcp/server.test.ts` - Fixed McpServer and StdioServerTransport constructor mocks
- `tests/distribution/pack.test.ts` - Added { timeout: 60000 } to slow build test

## Decisions Made

- Used `ignoreDeprecations: "6.0"` per research recommendation — matches TS6 migration aid, safe to commit, remove when tsup PR #1390 ships
- Added `"types": ["node"]` — mandatory for TS6; without it all Node.js built-in types disappear
- Used `vi.clearAllMocks()` pattern rather than changing `vi.restoreAllMocks()` to `vi.clearAllMocks()` in afterEach — keeps restore behavior for spy cleanup while adding history clear at test start

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed vitest v4 constructor mock failures in askCodebase and mcp/server tests**
- **Found during:** Task 1 (verification step — `npm test`)
- **Issue:** vitest v4 now warns and fails when `vi.fn().mockImplementation()` uses arrow functions for mocks that are called with `new`. Anthropic class mock in askCodebase.test.ts and McpServer/StdioServerTransport mocks in server.test.ts used arrow functions.
- **Fix:** Changed `() => ({...})` to `function () { return {...}; }` in the 3 affected mock implementations
- **Files modified:** tests/workflows/askCodebase.test.ts, tests/mcp/server.test.ts
- **Verification:** All tests in those files pass
- **Committed in:** e372616 (Task 1 commit)

**2. [Rule 1 - Bug] Fixed mock call count leakage across tests in 4 test files**
- **Found during:** Task 1 (verification step — `npm test`)
- **Issue:** vitest v4 no longer clears mock call history via `vi.restoreAllMocks()`. Tests using `vi.resetModules()` in afterEach share mock instances across tests, causing call counts to accumulate. Affected: index.test.ts, search.test.ts, init.test.ts (6 describe blocks).
- **Fix:** Added `vi.clearAllMocks()` at the start of each `beforeEach` block in the 4 affected files
- **Files modified:** tests/workflows/index.test.ts, tests/workflows/search.test.ts, tests/workflows/init.test.ts, tests/mcp/server.test.ts (already had clearAllMocks, needed no change)
- **Verification:** All 559 tests pass with zero call count leakage
- **Committed in:** e372616 (Task 1 commit)

**3. [Rule 1 - Bug] Fixed distribution pack test timeout**
- **Found during:** Task 1 (verification step — `npm test`)
- **Issue:** tests/distribution/pack.test.ts runs `npm run build` synchronously inside a test. Build takes ~8 seconds but vitest v4 default timeout is 5000ms (same as v2, but timing may have shifted). Test timed out.
- **Fix:** Added `{ timeout: 60000 }` to the slow test that runs the build
- **Files modified:** tests/distribution/pack.test.ts
- **Verification:** Distribution test passes within timeout
- **Committed in:** e372616 (Task 1 commit)

---

**Total deviations:** 3 auto-fixed (all Rule 1 - Bug)
**Impact on plan:** All three fixes required for test suite to pass under vitest v4. No scope creep — all changes confined to test files and config files listed in plan.

## Issues Encountered

None beyond the auto-fixed deviations above.

## Known Stubs

None.

## Next Phase Readiness

- Phase 60 Plan 02 (apache-arrow and web-tree-sitter upgrades) is ready to proceed
- All existing functionality verified working under vitest v4 and TypeScript 6.0
- The constructor mock and clearAllMocks patterns established here are relevant if Plan 02 adds new test files

---
*Phase: 60-dependency-upgrades*
*Completed: 2026-04-07*
