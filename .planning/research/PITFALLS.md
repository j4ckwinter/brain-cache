# Pitfalls Research

**Domain:** MCP Session Stats Accumulation + Claude Code Status Line Integration — brain-cache v2.4
**Researched:** 2026-04-03
**Confidence:** HIGH (critical pitfalls sourced from official Claude Code docs, confirmed Node.js behavior, and a verified GitHub issue; integration gotchas from official Claude Code JSON schema documentation; performance traps from observed MCP benchmarks)

---

## Critical Pitfalls

### Pitfall 1: Concurrent MCP Handler Writes Without Atomicity Cause Corrupt Stats Files

**What goes wrong:**
Multiple brain-cache MCP tool calls can execute concurrently (e.g. Claude calls `search_codebase` and `build_context` in the same message). Both handlers finish at roughly the same time and both try to write the session stats file. With naive `fs.writeFile`, the sequence is: Handler A reads current stats → Handler B reads current stats → Handler A writes updated stats → Handler B writes updated stats based on its stale read. Handler B's write silently overwrites Handler A's contribution, permanently losing one tool call's savings from the accumulated total.

**Why it happens:**
`fs.writeFile` is not atomic for read-modify-write operations. Two async operations on the same file path can both reach the "read existing content" step before either completes the "write updated content" step. Node.js's single-threaded event loop does NOT protect against this — the interleaving happens across multiple `await` boundaries.

**How to avoid:**
Use write-file-atomic (`write-file-atomic` npm package, maintained by npm itself) which serializes concurrent writes to the same path via an internal per-path queue. The pattern is:
1. Read current stats with `fs.readFile`.
2. Compute updated stats in memory.
3. Write with `writeFileAtomic` — concurrent writes to the same path are queued and applied in order, preventing interleaving.

Alternative: use an async mutex (e.g. `async-mutex` package) around the read-modify-write block. This is more explicit but adds a dependency.

Do NOT use `proper-lockfile` — it uses advisory file locking which only works between processes that all opt in to the lock, and it adds polling overhead on every write.

**Warning signs:**
- Accumulated `totalTokensSaved` resets unexpectedly between tool calls in a single session
- The stats file contains a token count lower than the sum of what individual tool calls reported
- Stats show only the last tool call's contribution when Claude calls two tools simultaneously

**Phase to address:**
STAT-01 (session-level token savings accumulation). Implement write-file-atomic from the start — do not defer this to a "hardening" phase. Once handlers are shipping real calls, data loss is silent and hard to detect in testing.

---

### Pitfall 2: Status Line Script Uses `jq` — Fails Silently on Machines Without It

**What goes wrong:**
Official Claude Code docs and community examples use `jq` for JSON parsing in bash status line scripts. `jq` is not installed by default on many Linux distributions or minimal macOS setups. When `jq` is missing, the script fails silently — the status line shows nothing, with no error surfaced to the user. This is a particularly poor failure mode for a feature that is supposed to be always-visible.

**Why it happens:**
`jq` is a standalone binary that must be installed separately (`brew install jq` on macOS, `apt install jq` on Ubuntu). The docs recommend it, examples use it, so script authors assume it is universally available. Claude Code runs the status line command in a subshell using the user's PATH at the time Claude Code was launched — if `jq` is not on that PATH, the script exits non-zero with no stdout output, and the status bar goes blank.

**How to avoid:**
Write the status line script in Node.js instead of bash. Node.js is guaranteed to be present on any machine running brain-cache. A Node.js script reads stdin with event listeners, parses JSON natively, reads the brain-cache stats file with `fs.readFileSync`, and prints to stdout — zero external tool dependencies.

If bash is used anyway (for simplicity), add an explicit `command -v jq || exit 0` guard at the top so a missing `jq` produces a blank status instead of a non-zero exit code that triggers Claude Code's error state.

**Warning signs:**
- Status line shows nothing after installation on a Linux machine
- `claude --debug` output shows the status line script exiting with code 127 (command not found)
- User reports "status line worked on my Mac but not in CI or a Docker container"

**Phase to address:**
STAT-02 (status line script rendering). Write the script in Node.js. Include a test mode: `echo '{"session_id":"test"}' | node ~/.claude/braincache-statusline.js` must produce output without requiring any other tool.

---

### Pitfall 3: Stats File Persists Across Dead Sessions — Stale Data Displayed

**What goes wrong:**
The stats file accumulates token savings across tool calls. When Claude Code is closed and a new session starts, the old stats file is still on disk. The new session's first tool call reads the stale file and continues accumulating from the previous session's totals. The status line then shows inflated cumulative savings that span multiple unrelated sessions, making the metric meaningless.

**Why it happens:**
The MCP server process is stateless between Claude Code sessions — there is no reliable shutdown hook that fires when Claude Code exits. The MCP server communicates via stdio, and when Claude Code terminates, the MCP process may receive a SIGTERM or may just have its stdin pipe closed. Neither guarantees that a cleanup handler runs before the process exits. A stats file written per-call persists until something explicitly removes it.

**How to avoid:**
Use a TTL-based expiry strategy on the stats file, not a shutdown hook. The stats file should include a `lastUpdatedAt` timestamp (Unix epoch ms). When the status line script reads the file, if `Date.now() - lastUpdatedAt > SESSION_TTL_MS` (recommended: 2 hours), treat the data as from a dead session and show `idle` instead of the stale numbers.

When the MCP handler writes stats, always update `lastUpdatedAt` to `Date.now()`. New sessions naturally "reset" the display because the old file becomes stale after 2 hours of inactivity — no shutdown hook required.

Do NOT use `session_id` from the status line stdin JSON to detect session boundaries and reset the file. The status line script receives `session_id` from Claude Code's stdin, but the MCP handler has no access to that field — the two components run in different processes and there is no reliable mechanism to pass the current session ID from the status line script to the MCP handler.

**Warning signs:**
- Token savings counter shows cumulative totals from previous days
- `totalCallCount` exceeds what is plausible for a single session (e.g. 50+ tool calls)
- Status line shows savings after restarting Claude Code without using any brain-cache tools in the new session

**Phase to address:**
STAT-04 (session stats reset). Implement TTL check in both the stats writer (embed `lastUpdatedAt`) and the status line script reader (check TTL before rendering). The TTL value should be configurable but default to 2 hours.

---

### Pitfall 4: `settings.json` Installation Clobbers Existing `statusLine` Config

**What goes wrong:**
`brain-cache init` automates status line installation by writing to `~/.claude/settings.json`. If the user already has a `statusLine` config — either a custom one they wrote or one from another tool — the naive approach of doing `settings = { ...settings, statusLine: {...} }` silently overwrites their existing configuration. The user loses their custom status line with no warning.

Additionally, there is a known Claude Code bug (GitHub issue #19487, confirmed active as of 2026) where project-level `.claude/settings.local.json` completely overwrites `~/.claude/settings.local.json` rather than deep-merging. This means if a user's project has its own settings file, the `statusLine` written to global settings may be ignored entirely.

**How to avoid:**
Before writing `statusLine`, check if `~/.claude/settings.json` already contains a `statusLine` key. If it does, print a warning and do not overwrite:
```
brain-cache: settings.json already contains a statusLine config.
To install, manually add or merge the brain-cache status line command.
Run `brain-cache init --show-statusline` to print the config to copy.
```

Provide `--force` to allow overwriting if the user explicitly consents.

For the project settings override bug: document in `brain-cache init` output that project-level `.claude/settings.local.json` files may suppress the global `statusLine` config. Recommend users check their project settings if the status line does not appear.

**Warning signs:**
- User reports status line stopped working after opening a project with `.claude/settings.local.json`
- `brain-cache init` completes successfully but status line never appears
- User has a custom status line that disappears after running `brain-cache init`

**Phase to address:**
STAT-03 (`brain-cache init` status line installation). The init command must read, parse, and merge — never blindly overwrite. Test on a settings file that already has `statusLine` and verify the command warns and exits rather than clobbering.

---

### Pitfall 5: Temp File Atomic Write Fails With EXDEV on Some Linux Configurations

**What goes wrong:**
The standard atomic write pattern writes to a temporary file and then calls `fs.rename` to atomically replace the target. On some Linux systems (notably Debian/Ubuntu with default `tmpfs` at `/tmp`), the temp file and the target stats file are on different filesystems. `fs.rename` across filesystems fails with `EXDEV: cross-device link not permitted`. The write-file-atomic library handles this by catching EXDEV and falling back to copy+unlink, but a hand-rolled atomic write using `os.tmpdir()` for the temp file will crash.

**Why it happens:**
`fs.rename` is a wrapper around the POSIX `rename(2)` syscall which is only atomic within the same filesystem. When the temp file is on `/tmp` (tmpfs) and the stats file is in `~/.claude/` (ext4 or the user's home filesystem), the rename fails. This is a well-known Node.js footgun documented in multiple open issues.

**How to avoid:**
Use the `write-file-atomic` npm package, which already handles the EXDEV case correctly (copy+unlink fallback). If writing a custom implementation, create the temp file in the same directory as the target stats file, not in `os.tmpdir()`. The temp file path should be: `path.join(path.dirname(statsFilePath), '.braincache-stats.tmp')`. A rename within the same directory is always on the same filesystem.

**Warning signs:**
- Stats file writes fail with `EXDEV` errors in pino logs on Linux
- Stats file is never created despite successful tool calls
- Works on macOS, fails on Linux CI

**Phase to address:**
STAT-01 (stats accumulation implementation). This is prevented entirely by using `write-file-atomic`. Only relevant if implementing a custom atomic write — in which case use same-directory temp files.

---

### Pitfall 6: Status Line Script Performance — Slow File Read Blocks the Update Cycle

**What goes wrong:**
The status line script runs after every Claude Code assistant message. Claude Code cancels a running script if a new update triggers before it finishes (documented in official Claude Code docs: "if a new update triggers while your script is still running, the in-flight execution is cancelled"). A slow script produces stale or absent status line output. Reading the brain-cache stats file synchronously is fast, but if the script does any additional work (network calls, spawning subprocesses, running `git` commands) the combined time may exceed the debounce window and cause cancellation.

**Why it happens:**
Status line scripts are run as fresh subprocesses on every tick. There is no persistent process that maintains state between invocations. If the script does any I/O beyond a single file read, that I/O happens every tick. The official Claude Code docs warn about this explicitly and show a caching pattern for git operations (cache to `/tmp/` with a 5-second TTL using a stable filename, not `$$` or `process.pid` which change every invocation).

**How to avoid:**
Keep the brain-cache status line script to two operations only: (1) read stdin JSON (async, non-blocking), (2) read the stats file with `fs.readFileSync`. Both are local file operations with no subprocess spawning. Total execution time should be under 50ms on any reasonable machine.

Do NOT combine the brain-cache status line with git status, cost tracking, or other dynamic data that requires subprocess execution. If users want combined status lines, document how to compose scripts — but brain-cache's script should do exactly one thing: display brain-cache savings.

Do NOT use `process.pid` or `Math.random()` in the stats file path (some developers do this thinking it creates a per-process file) — the status line is a different process each invocation and will never find a file keyed by the previous invocation's PID.

**Warning signs:**
- Status line shows `idle` even after tool calls (script cancelled before completing)
- Status line flickers or disappears when Claude is actively responding
- Adding git status to the script causes the brain-cache savings to stop updating

**Phase to address:**
STAT-02 (status line script). Keep the script minimal. Measure execution time in the test suite using a mock stats file: the script must complete in under 100ms on a cold Node.js start.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Use `fs.writeFile` directly for stats instead of write-file-atomic | No extra dependency | Silent data loss on concurrent tool calls (two parallel MCP handlers overwrite each other) | Never — concurrent writes are the normal case |
| Write status line script in bash with `jq` | Fewer lines of code | Silent failure on Linux machines without `jq` installed | Never — Node.js is guaranteed present; bash + jq is not |
| Rely on MCP server shutdown hook to reset stats | Conceptually clean session boundary | MCP stdio process has no reliable shutdown hook; hook may not fire on hard kills | Never — use TTL-based expiry instead |
| Use `os.tmpdir()` for temp file in custom atomic write | Standard practice for temp files | EXDEV crash on Linux tmpfs configurations | Never — use same-directory temp files or write-file-atomic |
| Overwrite `statusLine` in settings.json unconditionally during init | Simpler init code | Silently destroys user's existing custom status line | Never — check for existing config, warn if present |
| Combine brain-cache savings with git status in one script | Richer status line | Git subprocess adds 50-200ms; script may be cancelled mid-run; savings stop displaying | Only if user explicitly opts in to a combined script |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Claude Code `settings.json` | Write `statusLine` key with `fs.writeFile(path, JSON.stringify(settings))` — clobbers other keys if concurrent process also writes settings | Read → merge in memory → write atomically. Never use JSON.stringify on the full settings object; use a targeted merge of just the `statusLine` key |
| Claude Code status line stdin | Assume all JSON fields are always present | Fields like `rate_limits`, `session_name`, `vim`, `agent`, `worktree` are conditionally absent. `context_window.current_usage` is `null` before first API call. Always use optional chaining and fallbacks |
| Stats file and MCP handler | MCP handler runs in the same Node.js process as the MCP server — multiple tool calls share the same process | Write-file-atomic queues writes per-path within the same process. Safe. But if two MCP servers are somehow spawned (e.g. both project `.mcp.json` and user MCP config), two processes could write the same stats file — write-file-atomic's queue is per-process, not cross-process |
| Status line script PATH | Script uses `node` but Claude Code's launch PATH may not include the Node.js binary from nvm or nodenv | Use an absolute path to `node` in the shebang, or resolve it at `brain-cache init` time and embed it. Example: `#!/usr/bin/env node` works when `env` can resolve `node`, but nvm-managed `node` may not be on `env`'s PATH in non-interactive shells |
| TTL reset vs. session_id | Use `session_id` from Claude Code status line stdin to detect new sessions and reset stats | Status line script and MCP handler are separate processes with no shared channel. The status line can read `session_id` from stdin, but cannot write it to a location the MCP handler reads before tool calls execute — the first tool call of a new session fires before the status line has a chance to update the session marker |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Reading stats file inside MCP handler on the hot path (every tool call) | +5–15ms added to every `search_codebase`, `build_context`, `trace_flow` call | Stats write is append-only (write after work completes, not before). Never read the stats file inside the retrieval hot path — only write | Every tool call; compounds with concurrent calls |
| Spawning a subprocess in the status line script | Script exceeds debounce window; status line shows stale data or goes blank | Use only Node.js built-ins (fs, JSON) in the status line script — no child_process | Scripts taking >300ms (Claude Code debounce threshold) |
| Calling `JSON.parse(fs.readFileSync(...))` per MCP tool call with no error handling | Crash if stats file is malformed (truncated mid-write during a previous crash) | Wrap stats file reads in try/catch; treat parse errors as "no existing stats" and start fresh | Any time a previous write was interrupted by SIGKILL |
| Writing stats file synchronously before returning tool response | Adds synchronous file I/O to the MCP response path | Fire-and-forget: `writeStats(stats).catch(logger.error)` — do not await in the tool handler's return path | Always — sync writes in MCP handlers block the stdio transport |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Stats file path not validated before `brain-cache init` writes to settings.json | Path traversal: a misconfigured stats path written to settings.json could point to an arbitrary file that the status line script reads | Stats file path is always derived from `~/.claude/braincache-stats.json` — it is never user-configurable and never interpolated from external input |
| Status line script output includes raw file paths or session IDs | Leaks workspace paths to anyone who can see the terminal | Status line should display only numeric savings metrics (`↓38% 12.4k saved`) — never include full paths or IDs |
| `brain-cache init` writes to project-level `.claude/settings.json` instead of user-level `~/.claude/settings.json` | Status line config gets committed to git, exposing local script paths to collaborators | Always write to `~/.claude/settings.json` (user scope). Never write to project-level settings during init |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Status line shows `idle` at session start with no explanation | User thinks brain-cache is broken | Show `brain-cache  idle` on first render (before any tool calls) — the word "idle" communicates readiness, not failure |
| Status line shows raw token counts with no units (`12453`) | Meaningless to users who don't think in tokens | Always abbreviate: `12.4k saved`, `↓38%` — include units and directional indicators |
| `brain-cache init` succeeds but status line requires restarting Claude Code | User thinks installation failed | Print a clear post-install message: "Restart Claude Code to activate the status line." The official docs confirm settings changes don't apply until the next interaction |
| Status line disappears when notifications appear (token warnings, MCP errors) | User thinks the status line broke | Expected behavior per official docs — notifications share the status bar row. Document this in `brain-cache init` output |

---

## "Looks Done But Isn't" Checklist

- [ ] **Concurrent write safety:** Simulate two concurrent MCP tool calls (Promise.all of two handler invocations) and verify the stats file contains the sum of both, not just one contribution.
- [ ] **Stats file TTL reset:** Set `lastUpdatedAt` to 3 hours ago in a test stats file; verify the status line script shows `idle`, not the stale numbers.
- [ ] **No `jq` dependency:** Run the status line script on a machine (or Docker container) without `jq` installed; verify it produces correct output.
- [ ] **settings.json merge safety:** Run `brain-cache init` on a settings.json that already has a `statusLine` key; verify the command warns and does not overwrite.
- [ ] **EXDEV safety (Linux):** Verify `write-file-atomic` is used (not hand-rolled rename from `/tmp/`); no EXDEV errors in pino log on Ubuntu.
- [ ] **Script execution time:** Pipe a mock JSON blob to the status line script and measure wall-clock time; must be under 100ms.
- [ ] **Fire-and-forget stats write:** Verify MCP tool handler returns its response before the stats file write completes (write is not awaited on the return path).
- [ ] **Node.js shebang resolves on nvm setups:** Test the status line script on a machine using nvm; verify `#!/usr/bin/env node` resolves to the active nvm node.

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Stats file corrupted by interrupted write | LOW | Delete `~/.claude/braincache-stats.json`; stats reset to zero on next tool call |
| Settings.json `statusLine` clobbered by `brain-cache init` | LOW | User restores their previous `statusLine` config from git history or backup; add `--dry-run` flag to `brain-cache init` for future diagnosis |
| Status line not appearing due to project settings override bug | LOW | User adds `statusLine` config to project's `.claude/settings.local.json` as a duplicate; document this workaround in the init output |
| Stale stats from dead session displayed | LOW | User deletes stats file manually, or waits for TTL expiry (max 2 hours) |
| Status line script cancelled by Claude Code debounce | LOW | Audit the script for slow operations; remove any subprocess spawning; measure execution time |
| Stats write contention between two MCP server instances | MEDIUM | Ensure only one brain-cache MCP server instance is configured per machine; check both `~/.claude/settings.json` and project `.mcp.json` for duplicate brain-cache entries |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Concurrent write corruption | STAT-01 (stats accumulation) | Promise.all concurrent handler test; stats file contains sum of both contributions |
| `jq` dependency failure | STAT-02 (status line script) | Run script in Docker container without `jq`; output still correct |
| Stale stats from dead session | STAT-04 (session reset) | Manually backdate `lastUpdatedAt`; verify `idle` display |
| Settings.json clobber on init | STAT-03 (brain-cache init) | Run init on file with existing `statusLine`; verify warning, no overwrite |
| EXDEV on Linux tmpfs | STAT-01 (stats accumulation) | Use write-file-atomic; confirm in pino log no EXDEV errors on Ubuntu CI |
| Script performance / cancellation | STAT-02 (status line script) | Measure cold-start execution time under 100ms |
| project settings.local.json override | STAT-03 (brain-cache init) | Document workaround; verify init prints warning about project settings override bug |

---

## Sources

- [Claude Code status line official docs](https://code.claude.com/docs/en/statusline) — JSON schema, debounce behavior (300ms), cancellation of in-flight scripts, caching pattern, Windows config, troubleshooting; confirmed April 2026
- [Claude Code settings official docs](https://code.claude.com/docs/en/settings) — settings scopes, merge order, managed/user/project/local hierarchy; confirmed April 2026
- [GitHub issue #19487 — project settings.local.json overwrites global settings](https://github.com/anthropics/claude-code/issues/19487) — confirmed bug: project-level settings.local.json replaces global settings.local.json instead of deep-merging; workaround is duplicating global keys into project file; active as of April 2026
- [write-file-atomic npm](https://www.npmjs.com/package/write-file-atomic) — serializes concurrent writes per-path via internal Promise queue; maintained by npm; handles EXDEV via copy+unlink fallback
- [Node.js EXDEV cross-device link issue #19077](https://github.com/nodejs/node/issues/19077) — `fs.rename` fails across filesystems; `/tmp` on tmpfs → home directory on ext4 is the common Linux trigger
- [proper-lockfile npm](https://www.npmjs.com/package/proper-lockfile) — mkdir-based advisory locking; NOT recommended for this use case due to advisory-only nature and polling overhead
- [MCP Server Performance Benchmark v2](https://www.tmdevlab.com/mcp-server-performance-benchmark-v2.html) — Node.js MCP handler latency characteristics; target under 200ms for simple tools

---
*Pitfalls research for: brain-cache v2.4 Status Line — session stats accumulation and status line scripting*
*Researched: 2026-04-03*
