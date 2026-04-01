# Phase 8: Ollama Process Security — Research

**Gathered:** 2026-04-01
**Requirement:** SEC-02
**Status:** Research complete

---

## 1. Current Implementation

### 1.1 `startOllama` — `src/services/ollama.ts:49–73`

```ts
export async function startOllama(): Promise<boolean> {
  log.info('Starting Ollama server...');

  const child = spawn('ollama', ['serve'], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();           // <-- detaches from parent; Node exits independently of child

  const MAX_ATTEMPTS = 10;
  const POLL_INTERVAL_MS = 500;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    await new Promise<void>((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    const running = await isOllamaRunning();
    if (running) {
      log.info({ attempt: attempt + 1 }, 'Ollama is now running');
      return true;
    }
    ...
  }

  log.warn('Ollama did not start within timeout');
  return false;
}
```

**Key observations:**
- `detached: true` + `child.unref()` — the spawned `ollama serve` process is immediately orphaned from the Node parent. The parent process can exit without killing the child.
- No PID is stored anywhere. `child.pid` is available transiently but discarded.
- No check is done for whether Ollama is already running before spawning — the caller (`runInit`) checks first, but `startOllama` itself has no guard.
- If `startOllama` times out (returns `false`), the still-booting Ollama process is left running with no tracking reference.
- No signal handlers (`SIGINT`, `SIGTERM`, `uncaughtException`) — when brain-cache is killed mid-spawn, there is no cleanup path.
- On timeout, the log warning (`src/services/ollama.ts:71`) does not include a PID because `child.pid` was never captured for logging.

### 1.2 `isOllamaRunning` — `src/services/ollama.ts:35–42`

```ts
export async function isOllamaRunning(): Promise<boolean> {
  try {
    const res = await fetch(getOllamaHost());
    return res.ok;
  } catch {
    return false;
  }
}
```

- Checks the HTTP endpoint for `OLLAMA_HOST` (default `http://localhost:11434`).
- Returns a boolean — not the specific port or process details.
- Used as a pre-flight guard in `runInit` before calling `startOllama`, but there is a TOCTOU race: another brain-cache process could spawn between the check and the spawn.

### 1.3 `runInit` — `src/workflows/init.ts:54–64`

```ts
const running = await isOllamaRunning();
if (!running) {
  process.stderr.write('Ollama is not running. Starting...\n');
  const started = await startOllama();
  if (!started) {
    process.stderr.write(
      "Error: Could not start Ollama. Run 'ollama serve' manually, then retry 'brain-cache init'.\n"
    );
    process.exit(1);   // <-- Note: process.exit(1) still present here (HARD-01 not applied to init.ts)
  }
}
```

- The guard is `isOllamaRunning()` → `startOllama()`. There is a window between those two calls where a concurrent `brain-cache init` could also see "not running" and each spawn its own `ollama serve`.
- `process.exit(1)` on startup failure — does not do any cleanup of partially started processes (no cleanup hooks installed at that point).

### 1.4 All callers of `startOllama`

Only one caller: `src/workflows/init.ts:57`. No other workflow spawns Ollama — they check `isOllamaRunning()` and error out if it is not running.

### 1.5 All callers of `isOllamaRunning`

| File | Line | Purpose |
|------|------|---------|
| `src/workflows/init.ts` | 54 | Pre-flight before optional spawn |
| `src/workflows/index.ts` | 43 | Guard — throws if not running |
| `src/workflows/search.ts` | 30 | Guard — throws if not running |
| `src/workflows/buildContext.ts` | 34 | Guard — throws if not running |
| `src/workflows/doctor.ts` | 34 | Health reporting only |
| `src/mcp/index.ts` | 50, 124, 187, 235 | Guard in each MCP tool handler |

None of these callers ever spawn Ollama — only `runInit` does. None register signal handlers to manage the spawned process.

### 1.6 Test coverage — `tests/services/ollama.test.ts`

- `startOllama` is tested with fake timers and mocked `spawn`/`fetch`.
- Tests verify: spawn is called with `{ detached: true, stdio: 'ignore' }`, `unref()` is called, returns `true` on success and `false` on timeout.
- No tests for: PID tracking, duplicate-spawn prevention, signal handler behaviour, or error log content on timeout.

---

## 2. Identified Problems

### Problem A — No duplicate-instance prevention (`SUCCESS CRITERION 1`)

**Race:** Two concurrent `brain-cache init` runs each call `isOllamaRunning()` at nearly the same time, both see `false`, both call `startOllama()`, both spawn `ollama serve`. Ollama itself will fail the second spawn (EADDRINUSE on port 11434), but:
- Both processes are detached and unreffed — no error propagates back to brain-cache.
- The second zombie is left running briefly or forever depending on Ollama's internal error handling.
- The polling in both `startOllama` calls might both resolve to `true` once the first instance is healthy, masking the double-spawn entirely.

**Root cause:** `startOllama` does not atomically check + spawn. There is no lock file, no port-check inside `startOllama` itself, and no OS-level mutex.

### Problem B — Orphaned processes (`SUCCESS CRITERION 2`)

**The `child.unref()` call is intentional** — it allows brain-cache to exit while Ollama continues serving. That is the desired long-term behaviour for user-installed Ollama. However, when brain-cache *spawned* the Ollama process (rather than finding one already running), it becomes responsible for it:
- If `startOllama` returns `false` (timeout), a partially booting `ollama serve` is left running with no PID record. The user has no way to find or kill it from brain-cache tooling.
- If brain-cache is killed (SIGINT/SIGTERM) mid-poll loop inside `startOllama`, the spawned child is already unreffed — it becomes a permanent orphan.
- There is no distinction made between "Ollama we spawned" vs "Ollama that was already running" — so cleanup is impossible even if we wanted to kill it.

**Key distinction the implementation must make:** If Ollama was *already running* when `startOllama` was called, brain-cache must not kill it on exit. If brain-cache *spawned* it, whether to kill it on exit is debatable (the typical pattern is to leave it running as a service). The primary concern per SEC-02 is preventing *orphaned* processes from a *failed startup*, not from successful ones.

### Problem C — PID not logged on timeout (`SUCCESS CRITERION 3`)

`src/services/ollama.ts:71` logs only:
```
log.warn('Ollama did not start within timeout');
```
`child.pid` is available on the `child` object but is never captured or logged. The user cannot identify or kill the hung process.

### Problem D — `process.exit(1)` still in `init.ts` (minor, HARD-01 incomplete)

`src/workflows/init.ts:50` and `src/workflows/init.ts:63` still call `process.exit(1)` directly. HARD-01 was meant to replace all such calls with thrown errors. These were not migrated in Phase 6.

---

## 3. Recommended Approach

### 3.1 Success Criterion 1 — Prevent double-spawn

**Strategy: Port-check inside `startOllama` before spawning**

Move the `isOllamaRunning()` guard inside `startOllama` itself, so even if two concurrent callers both call `startOllama` simultaneously, only the first one to find Ollama not running proceeds with spawning. The second returns early because by the time it checks, the first has spawned and Ollama is (or is becoming) available.

This is not a perfect atomic lock, but it eliminates the common case. The remaining race window is milliseconds (between check and spawn), and Ollama itself handles the port conflict safely (EADDRINUSE causes the second spawn to exit immediately).

**Implementation:**

```ts
export async function startOllama(): Promise<boolean> {
  // Guard: check again immediately before spawning to reduce race window
  const alreadyRunning = await isOllamaRunning();
  if (alreadyRunning) {
    log.info('Ollama is already running, skipping spawn');
    return true;
  }

  log.info('Starting Ollama server...');
  const child = spawn('ollama', ['serve'], {
    detached: true,
    stdio: 'ignore',
  });
  const pid = child.pid;
  child.unref();

  // ... polling loop ...
  if (timeout) {
    log.warn({ pid }, 'Ollama did not start within timeout');
    return false;
  }
}
```

**Note:** Callers that already check `isOllamaRunning()` before calling `startOllama()` gain a redundant double-check, which is safe and cheap. This makes `startOllama` defensively correct regardless of how callers use it.

**What about a lock file?**

A lock file (e.g. `~/.brain-cache/ollama.lock`) with the PID would be the most robust solution, but it introduces:
- Stale lock file scenarios (process died, lock not cleaned up)
- Lock file cleanup on all exit paths
- Cross-process file locking on non-Linux platforms

Given the minimal complexity goal and the fact that Ollama itself rejects duplicate starts via EADDRINUSE, the double port-check approach is sufficient and simpler. Add a comment explaining the residual race and why it is acceptable.

### 3.2 Success Criterion 2 — No orphaned processes after timeout

**Strategy: Kill the child on timeout**

When `startOllama` times out, the spawned `ollama serve` process should be killed before returning `false`. This is the only scenario where an orphan from a *failed start* is left behind.

After timeout:
```ts
if (pid !== undefined) {
  try {
    process.kill(pid, 'SIGTERM');
    log.info({ pid }, 'Killed stalled Ollama process after startup timeout');
  } catch {
    // Process may have already exited — ignore ESRCH
  }
}
```

**What about successful starts?** When `startOllama` returns `true`, the Ollama process is intentionally left running (it is a server). `child.unref()` is the correct behaviour for this path. No change needed.

**What about SIGINT to brain-cache?** If the user Ctrl-C's during the poll loop:
- `child.unref()` means the spawned Ollama becomes orphaned.
- A `SIGINT` handler that calls `child.kill()` would fix this — but we lose the `child` reference after `unref()`.

The fix is to capture `child.pid` before `unref()`. Then register a one-time cleanup handler using `process.once('SIGINT', ...)` and `process.once('SIGTERM', ...)` inside `startOllama`. Remove these handlers when polling completes (either success or timeout), to avoid leaking handlers across multiple `startOllama` calls.

```ts
const cleanup = () => {
  if (pid !== undefined) {
    try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ }
  }
};
process.once('SIGINT', cleanup);
process.once('SIGTERM', cleanup);

// ... polling loop ...

// Always remove handlers when done
process.removeListener('SIGINT', cleanup);
process.removeListener('SIGTERM', cleanup);
```

This ensures: if brain-cache is killed during startup polling, the orphaned Ollama is also killed. Once polling completes successfully, the handlers are removed — Ollama runs as a background service unaffected by future brain-cache exits.

### 3.3 Success Criterion 3 — Log PID on timeout

**Already covered above.** Capture `child.pid` into a `const pid` before calling `child.unref()`, then include it in the warn log:

```ts
const pid = child.pid;
child.unref();
// ...
log.warn({ pid }, 'Ollama did not start within timeout');
```

This satisfies the requirement: "logs the PID it attempted to track and exits with a clear error message rather than hanging."

The current code hangs for exactly 5 seconds (10 × 500ms) then returns `false` — it does not hang indefinitely, but the log message is opaque. Adding `{ pid }` to the warn log and updating the message to be actionable addresses this.

### 3.4 Fix remaining `process.exit(1)` calls in `init.ts` (bonus, HARD-01 completion)

`src/workflows/init.ts:50` and `src/workflows/init.ts:63` should throw errors instead of calling `process.exit(1)`. The CLI entry point at `src/cli/index.ts` already has a catch wrapper that calls `process.exit(1)` on thrown errors. This is a trivial change that should be bundled with the phase.

---

## 4. Validation Architecture

### Unit tests to add/update in `tests/services/ollama.test.ts`

| Test | Scenario | Expected |
|------|----------|----------|
| `startOllama` — already running | `isOllamaRunning` returns true before spawn | Returns `true`, `spawn` not called |
| `startOllama` — spawns + succeeds | Normal happy path | Returns `true`, spawn called with `detached: true`, `unref()` called |
| `startOllama` — timeout, kills child | `isOllamaRunning` never returns true | Returns `false`, `process.kill(pid, 'SIGTERM')` called |
| `startOllama` — timeout logs PID | Same scenario | `log.warn` called with `{ pid }` field |
| `startOllama` — SIGINT during polling | SIGINT fired mid-poll | Registered SIGINT listener calls kill on the child PID |
| `startOllama` — success removes handlers | Polling resolves | SIGINT/SIGTERM listeners removed from `process` |

### Integration concern

- `process.kill()` needs to be mockable in tests. Use `vi.spyOn(process, 'kill')` or pass a `kill` function as a dependency injection point.
- `process.once` and `process.removeListener` also need to be verified in tests for the signal handler tests.

### Manual validation checklist (for the PR)

1. `brain-cache init` when Ollama already running: no new process, exit 0.
2. `brain-cache init` twice in quick succession (background + foreground): second invocation detects Ollama is already up (spawned by first) and skips spawn.
3. Kill brain-cache during startup poll: no zombie `ollama serve` process remains (`ps aux | grep ollama`).
4. Ollama fails to start within timeout: exit with error message containing the PID.
5. `brain-cache init` when Ollama starts successfully: Ollama keeps running after brain-cache exits.

---

## 5. Files to Change

| File | Change |
|------|--------|
| `src/services/ollama.ts` | Update `startOllama`: add pre-spawn running check, capture PID, add signal handlers, kill on timeout, improve timeout log |
| `src/workflows/init.ts` | Replace `process.exit(1)` with `throw new Error(...)` at lines 50 and 63 |
| `tests/services/ollama.test.ts` | Add tests for new behaviours: double-spawn prevention, PID logging, kill on timeout, signal handler cleanup |

---

## RESEARCH COMPLETE
