# Deferred Items — Phase 60

## Pre-existing Test Failures (Out of Scope)

### tests/workflows/buildContext.test.ts — 2 failures

- `does not call expandByEdges when mode is trace but no edges table`
- `does not call expandByEdges when mode is explore even with edges table`

**Status:** Pre-existing failures confirmed by running test suite both before and after apache-arrow upgrade. Not caused by this phase.

**Root cause (apparent):** The `expandByEdges` mock is being called when the test expects it NOT to be called. This suggests the wiring of `expandByEdges` in `buildContext.ts` (likely added in phase 59) is unconditional, but the tests expect conditional calling based on mode + edges table availability.

**Resolution:** Investigate in a future phase (likely a phase 59 or 61 cleanup task).

**Discovered in:** 60-02 Task 1 (apache-arrow upgrade)
