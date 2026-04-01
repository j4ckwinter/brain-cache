---
plan: "08-01"
status: complete
started: 2026-04-01T04:27:00Z
completed: 2026-04-01T04:29:30Z
---

# Plan 08-01: Summary

## Result
Hardened the Ollama process lifecycle in brain-cache: added pre-spawn duplicate detection, PID tracking, signal handler registration/cleanup, and orphan process killing on timeout. Also completed the HARD-01 gap by replacing all remaining `process.exit(1)` calls in `init.ts` with thrown errors.

## Tasks
| Task | Status | Commit |
|------|--------|--------|
| 08-01-T1 | ✓ | 3ad0719 |
| 08-01-T2 | ✓ | 6e7c781 |
| 08-01-T3 | ✓ | e424f81 |
| init.test.ts fixup | ✓ | 5449231 |

## Key Changes
- `src/services/ollama.ts` — `startOllama()` now: (1) calls `isOllamaRunning()` before spawn to prevent duplicate instances, (2) captures `child.pid` before `child.unref()`, (3) registers SIGINT/SIGTERM handlers to kill the spawned process if brain-cache is killed mid-startup, (4) removes those handlers after the poll loop, (5) sends SIGTERM to the spawned PID on timeout to prevent orphan processes
- `src/workflows/init.ts` — replaced both `process.exit(1)` calls with `throw new Error(...)`, completing the HARD-01 gap
- `tests/services/ollama.test.ts` — added 5 new test cases covering: pre-spawn guard (no spawn when already running), PID capture, timeout kill with SIGTERM, signal handler registration/removal, ESRCH error tolerance on kill
- `tests/workflows/init.test.ts` — updated 2 test assertions to match the new thrown-error behavior instead of `process.exit(1)`

## Self-Check
PASSED — All 229 tests pass. Pre-existing TS error in `src/services/lancedb.ts` is unrelated to this plan and was present before any changes.
