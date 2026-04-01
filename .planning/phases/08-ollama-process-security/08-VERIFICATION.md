---
phase: 8
status: passed
verified: 2026-04-01
verifier: claude-sonnet-4-6
---

# Phase 8 Verification: Ollama Process Security

**Phase goal:** Brain-cache never leaves orphaned Ollama processes and never spawns a second instance when one is already running.
**Requirement:** SEC-02 — Fix detached Ollama process management — PID tracking, race condition prevention, port check before spawn.

---

## Check 1: Double-Spawn Prevention

**File:** `src/services/ollama.ts`

PASSED. `startOllama()` calls `isOllamaRunning()` as its very first action before any `spawn()` call. If the check returns `true`, the function logs `'Ollama is already running, skipping spawn'` and returns `true` immediately without ever invoking `spawn`. An inline comment in the code explains this reduces the TOCTOU race window (noting that Ollama itself handles EADDRINUSE safely if a race still occurs after the check).

Key evidence (lines 52–56 of `src/services/ollama.ts`):
```ts
const alreadyRunning = await isOllamaRunning();
if (alreadyRunning) {
  log.info('Ollama is already running, skipping spawn');
  return true;
}
```

Test coverage: `"returns true without spawning when Ollama is already running"` — asserts `mockSpawn` is NOT called when the pre-spawn check resolves `{ ok: true }`. PASSES.

---

## Check 2: Orphan Prevention — Signal Handlers and Timeout Kill

**File:** `src/services/ollama.ts`

PASSED. All three orphan-prevention mechanisms are present:

**2a. PID captured before unref (lines 65–67):**
```ts
const pid = child.pid;
child.unref();
```
`pid` is captured into a `const` before `unref()` is called, so it remains accessible after the child is detached.

**2b. SIGINT/SIGTERM handlers registered during polling (lines 74–83):**
```ts
const cleanup = () => {
  try {
    if (pid !== undefined) process.kill(pid, 'SIGTERM');
  } catch { /* Ignore ESRCH */ }
};
process.once('SIGINT', cleanup);
process.once('SIGTERM', cleanup);
```
Registered immediately after spawn, before the polling loop begins.

**2c. Handlers removed after polling completes (lines 97–98):**
```ts
process.removeListener('SIGINT', cleanup);
process.removeListener('SIGTERM', cleanup);
```
Removed on both the success path and before the timeout kill path.

**2d. Spawned process killed on timeout (lines 105–110):**
```ts
try {
  if (pid !== undefined) process.kill(pid, 'SIGTERM');
} catch { /* Ignore ESRCH */ }
```
Executes when the poll loop exhausts all attempts without a successful readiness check.

---

## Check 3: PID Logging on Timeout

**File:** `src/services/ollama.ts` (line 110)

PASSED. The timeout log includes `{ pid }` as a structured field:
```ts
log.warn({ pid }, 'Ollama did not start within timeout — killed spawned process (PID: ' + pid + ')');
```
The test run output confirms this fires correctly — three timeout warn lines were visible in the test output, each containing the PID field as a pino structured log:
```
{"level":40,...,"component":"ollama","pid":22222,"msg":"Ollama did not start within timeout — killed spawned process (PID: 22222)"}
{"level":40,...,"component":"ollama","pid":99999,"msg":"Ollama did not start within timeout — killed spawned process (PID: 99999)"}
{"level":40,...,"component":"ollama","pid":77777,"msg":"Ollama did not start within timeout — killed spawned process (PID: 77777)"}
```

---

## Check 4: Test Suite

**File:** `tests/services/ollama.test.ts`

PASSED. All 241 tests pass across 15 test files. The `startOllama` describe block contains 7 test cases (5 new ones added in phase 08-01, 2 pre-existing).

New tests and what they cover:
| Test | Behavior Verified |
|------|------------------|
| "returns true without spawning when Ollama is already running" | Double-spawn prevention — `mockSpawn` not called |
| "captures PID and includes it in success log" | PID capture before `unref()`, returns `true` |
| "kills spawned process on timeout" | `process.kill(99999, 'SIGTERM')` called on poll exhaustion |
| "registers and removes signal handlers during polling" | `process.once('SIGINT'/'SIGTERM')` and `process.removeListener` both asserted |
| "kills spawned process on timeout even if process.kill throws ESRCH" | ESRCH tolerance — returns `false` without unhandled exception |

Full test run result: **15 test files, 241 tests, 0 failures**.

---

## Check 5: SEC-02 Cross-Reference

**File:** `.planning/REQUIREMENTS.md`

SEC-02 is currently marked `[ ]` (pending) in REQUIREMENTS.md — the checkbox has not been updated yet. All implementation criteria from SEC-02 are satisfied by the code:

| SEC-02 criteria | Status |
|----------------|--------|
| PID tracking | DONE — `const pid = child.pid` before `unref()` |
| Race condition prevention | DONE — `isOllamaRunning()` pre-spawn guard |
| Port check before spawn | DONE — same pre-spawn guard via HTTP probe |

The `init.ts` `process.exit(1)` calls referenced in the plan's HARD-01 gap are also resolved — both replaced with `throw new Error(...)`. TypeScript type check (`tsc --noEmit`) reports zero errors.

**Note:** REQUIREMENTS.md SEC-02 checkbox should be updated from `[ ]` to `[x]` and the traceability table status updated from `Pending` to `Complete`.

---

## Summary

| Check | Result |
|-------|--------|
| 1. Double-spawn prevention (`isOllamaRunning` before `spawn`) | PASSED |
| 2a. PID captured before `unref` | PASSED |
| 2b. SIGINT/SIGTERM handlers registered during polling | PASSED |
| 2c. Signal handlers removed after poll loop | PASSED |
| 2d. Spawned process killed on timeout | PASSED |
| 3. PID field present in timeout warn log | PASSED |
| 4. All tests pass (241/241) | PASSED |
| 5. SEC-02 implementation complete | PASSED |

**Overall status: PASSED**

All must-haves from the phase plan are implemented and verified. The only administrative gap is the SEC-02 checkbox in REQUIREMENTS.md which should be ticked as complete.
