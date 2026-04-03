# Project Research Summary

**Project:** brain-cache v2.4 Status Line
**Domain:** Claude Code status line integration — session-level token savings display
**Researched:** 2026-04-03
**Confidence:** HIGH

## Executive Summary

The v2.4 Status Line milestone adds a visibility layer to an already-working MCP tool suite. Brain-cache already computes per-call token savings in four retrieval handlers (`search_codebase`, `build_context`, `trace_flow`, `explain_codebase`). The v2.4 work is purely additive: persist those savings to a session stats file after each tool call, expose a Node.js script that Claude Code runs after each assistant message to display them, and wire `brain-cache init` to install the script and update `~/.claude/settings.json` automatically. No new savings computation logic is needed.

The recommended implementation uses file-based IPC as the only viable integration mechanism. The MCP server process and the Claude Code status line script are separate processes with no shared memory or communication channel. A JSON stats file at `~/.brain-cache/session-stats.json`, written atomically by MCP handlers and read by the status line script on each invocation, is the correct and only reasonable design. The status line script must be written in Node.js (not bash with `jq`) because Node.js is guaranteed present on any machine running brain-cache, while `jq` is not.

The primary risks are concrete and well-understood: concurrent MCP handler writes corrupting the stats file (solved by `write-file-atomic`), stale stats from a dead session bleeding into a new session (solved by TTL-based expiry, not shutdown hooks), and `brain-cache init` clobbering existing `statusLine` config in `settings.json` (solved by read-merge-write with an idempotency guard). All three risks have clear prevention strategies that must be applied from the start — none are candidates for deferral to a hardening pass.

---

## Key Findings

### Recommended Stack

The base stack (Node.js 22, TypeScript, Commander, Ollama, Anthropic SDK, LanceDB, pino, zod v4) is unchanged. A single new runtime dependency is required: `write-file-atomic@7.0.1`, maintained by the npm organization, which handles the POSIX temp-file-rename atomic write pattern, concurrent write serialization per-path, and EXDEV cross-device-link recovery for Linux tmpfs configurations. It ships bundled TypeScript declarations (no `@types/` package needed) and supports Node.js `^20.17.0 || >=22.9.0` — compatible with the project's Node 22 LTS requirement.

All other capabilities — JSON parsing, file reads, ANSI color codes, session expiry — are handled by Node.js built-ins. No `jq`, no `chalk`, no SQLite, no background daemon.

**Core technologies (new for v2.4):**
- `write-file-atomic@7.0.1`: atomic stats file writes — prevents data corruption from concurrent MCP handler invocations; handles Linux EXDEV edge case automatically
- Node.js built-ins (`fs`, `JSON`): status line script runtime — node is guaranteed present on any brain-cache machine; no external tool dependencies
- `~/.brain-cache/session-stats.json`: file-based IPC — the only viable cross-process communication mechanism between the MCP server and the Claude Code status line runner

### Expected Features

The milestone has four requirements (STAT-01 through STAT-04), all rated P1. Research confirms these are the right scope — additional features (tool call count in display, per-project stats isolation, lifetime stats) are P2/P3 and validated for post-launch.

**Must have (table stakes):**
- Cumulative savings display (`brain-cache  ↓38%  12.4k saved`) — the core value proposition; without it the feature does not exist
- Idle state when no tool calls have occurred — a blank or erroring status line is worse than no status line; `brain-cache  idle` communicates readiness, not failure
- Session boundary reset (TTL-based, 4-hour window) — stale stats from a prior session make the metric meaningless; TTL is the correct approach because the MCP server has no shutdown hook
- `brain-cache init` installs status line config into `~/.claude/settings.json` — developers expect a single setup command; manual edits kill adoption
- Graceful error fallback — any script crash must produce `brain-cache  idle`, not a blank or garbled status line

**Should have (post-launch validation):**
- Tool call count alongside savings (`(4 calls)`) — provides context for interpreting the percentage; trivial to add once core is shipping
- Per-project stats isolation — prevents multi-project workflows from cross-contaminating stats; medium complexity using `workspace.project_dir` hash

**Defer (v2.5+):**
- Lifetime cumulative stats in `brain-cache status` CLI — requires separate append-only log and a new CLI subcommand; out of scope for a status line feature
- Stats export or webhook — enterprise use case; no current demand signal

### Architecture Approach

The architecture is a clean producer/consumer split across two new source files and modifications to two existing files. `src/services/sessionStats.ts` owns the stats file (read, accumulate, TTL reset, atomic write). `src/workflows/statusLine.ts` owns the installed script template and the `settings.json` mutation logic. The MCP handlers in `src/mcp/index.ts` call `accumulateStats` as a fire-and-forget side effect after each successful tool response — critically, this goes in the MCP handler layer, not the workflow layer, because CLI invocations of the same workflows must not write MCP session stats. The status line script is an installed Node.js file at `~/.brain-cache/statusline.sh` that does exactly two things: reads the stats file and prints formatted output.

**Major components:**
1. `src/services/sessionStats.ts` (NEW) — owns `~/.brain-cache/session-stats.json`: read, accumulate, TTL-based session reset, atomic write via `write-file-atomic`
2. `src/workflows/statusLine.ts` (NEW) — owns the status line script template and `~/.claude/settings.json` `statusLine` entry installation; called by `runInit`
3. `src/mcp/index.ts` (MODIFIED) — fire-and-forget `accumulateStats()` call after each of the 4 retrieval tool handlers; `.catch(() => {})` ensures stats failure never fails a tool call
4. `src/workflows/init.ts` (MODIFIED) — new Step 12 calls `installStatusLineScript()` and merges the returned settings fragment using read-merge-write
5. `src/lib/config.ts` (MODIFIED) — three new constants: `SESSION_STATS_PATH`, `STATUS_LINE_SCRIPT_PATH`, `SESSION_STATS_TTL_MS`
6. `~/.brain-cache/statusline.sh` (NEW installed artifact) — short Node.js script; reads stats file; outputs one line to stdout; must complete under 100ms cold-start

### Critical Pitfalls

1. **Concurrent write corruption** — multiple MCP tool calls in one Claude message can both read-modify-write the stats file concurrently; with naive `fs.writeFile` the later write silently discards the earlier one. Prevention: use `write-file-atomic` from day one; never defer. Verification: `Promise.all` of two concurrent handler invocations must produce stats equaling the sum of both contributions.

2. **Stale session stats displayed in a new session** — the MCP server has no reliable shutdown hook; the stats file persists across Claude Code restarts. Prevention: TTL-based expiry (4-hour default) embedded in the stats file `lastUpdatedAt` field; status line shows `idle` when the file is older than TTL. Do not attempt to use `session_id` from the status line stdin JSON — the MCP handler has no access to that field and the two processes have no shared channel.

3. **`jq` dependency fails silently on Linux** — if the status line script is written in bash using `jq`, it fails with exit code 127 on machines without `jq`, producing a blank status line with no user-visible error. Prevention: write the script in Node.js. This is non-negotiable; `jq` is not universally installed.

4. **`settings.json` clobber during init** — naive overwrite of `~/.claude/settings.json` destroys existing `statusLine` config from other tools or user customization. Prevention: read → check for existing `statusLine` key → warn and skip if present → write only if absent (or if `--force` is passed). A known Claude Code bug (issue #19487) means project-level `settings.local.json` can suppress global settings entirely — document this in init output.

5. **Script performance and cancellation** — Claude Code cancels a running status line script when a new update triggers (300ms debounce). Any subprocess spawning or network call will cause cancellations and a blank status line. Prevention: the script does exactly two operations (read stdin JSON, read stats file with `fs.readFileSync`); target under 50ms; verify cold-start execution time in the test suite.

---

## Implications for Roadmap

Based on the dependency graph confirmed in architecture research, implementation has a clear three-phase structure. Phases 1 and 2 can be combined; Phase 3 depends on Phase 2 for meaningful integration testing of the end-to-end flow.

### Phase 1: Stats Infrastructure

**Rationale:** `sessionStats.ts` service and `config.ts` constants are pure data-layer work with no dependencies on UI or install logic. Everything else depends on this foundation. Implementing `write-file-atomic` atomicity here, at the start, prevents silent data loss from being a hidden problem that only surfaces under concurrent load.

**Delivers:** `src/services/sessionStats.ts` with `readSessionStats()` and `accumulateStats()`, `src/lib/config.ts` constants (`SESSION_STATS_PATH`, `STATUS_LINE_SCRIPT_PATH`, `SESSION_STATS_TTL_MS`), and unit tests verifying atomic writes, TTL reset behavior, and concurrent write safety.

**Addresses:** STAT-01 (infrastructure), STAT-04 (TTL session reset embedded in `accumulateStats` — reset counters before accumulating when `lastUpdatedAt` is older than TTL)

**Avoids:** Concurrent write corruption (Pitfall 1), EXDEV on Linux tmpfs (Pitfall 5), stale session stats (Pitfall 3)

### Phase 2: MCP Handler Instrumentation

**Rationale:** With the stats service ready, wiring the four MCP handlers is a small, well-bounded change. The fire-and-forget side effect pattern — `accumulateStats(delta).catch(() => {})` after each successful tool response — must go in the MCP handler layer, not the workflow layer, to preserve CLI/MCP separation. This is the data producer that Phase 3's script depends on for end-to-end testing.

**Delivers:** All four MCP handlers in `src/mcp/index.ts` accumulate stats after each tool call. Integration test: invoke a tool via MCP, verify `~/.brain-cache/session-stats.json` is created and contains correct accumulated values. Concurrent invocation test: two parallel tool calls produce a stats file containing the sum of both.

**Addresses:** STAT-01 (behavior)

**Uses:** `write-file-atomic` (new runtime dependency), `sessionStats` service from Phase 1

**Avoids:** Stats write blocking tool response (fire-and-forget, not awaited on return path — Pitfall 6 performance concern)

### Phase 3: Rendering and Installation

**Rationale:** The status line script and init installation are the user-visible output. They depend on the stats file being written (Phase 2) for any meaningful end-to-end validation. The script template, `statusLine.ts` workflow, and `runInit` Step 12 are logically cohesive — they all belong to the install/render tier and ship together.

**Delivers:** `src/workflows/statusLine.ts` (script template + settings fragment), `runInit` Step 12 addition, Node.js status line script installed at `~/.brain-cache/statusline.sh` with correct permissions (`chmod +x`), `~/.claude/settings.json` mutation with read-merge-write idempotency guard.

**Addresses:** STAT-02 (status line script rendering), STAT-03 (init installation)

**Avoids:** `jq` dependency failure (Pitfall 2 — Node.js script only, no bash), `settings.json` clobber (Pitfall 4 — check for existing `statusLine` key, warn and skip if present), script cancellation (Pitfall 6 — script does only `readFileSync` + string format, target under 50ms)

### Phase Ordering Rationale

- STAT-01 must precede STAT-02: the script cannot display stats that do not exist. The stats file is the IPC contract between the two halves of the system.
- STAT-04 (TTL reset) is implemented inside Phase 1's `accumulateStats` function, not as a separate phase — the reset logic lives in the writer, where it can act before accumulating a stale file's values.
- STAT-03 (init installation) requires STAT-02's script path to be stable before wiring, but is otherwise independent; grouping STAT-02 and STAT-03 in Phase 3 is natural since both belong to the render/install tier.
- The architecture explicitly requires stats accumulation in the MCP handler layer, not the workflow layer — this is the single most important structural decision for maintaining CLI/MCP separation and must be established in Phase 2 rather than "fixed later."

### Research Flags

All phases have standard, well-documented patterns. No `/gsd:research-phase` calls are needed during planning.

- **Phase 1 (stats service):** atomic file writes with `write-file-atomic` are a solved problem; TTL comparison is standard `Date.now()` arithmetic; file schema is fully specified in STACK.md
- **Phase 2 (MCP instrumentation):** fire-and-forget side effect pattern is already established in the codebase; integration points in `src/mcp/index.ts` are identified with exact handler names
- **Phase 3 (rendering + install):** Claude Code `statusLine` API is fully documented in official docs; `settings.json` read-merge-write follows the existing `runInit` precedent for `.mcp.json`

One execution-time validation to perform during Phase 3: test that `#!/usr/bin/env node` in the status line script resolves correctly on nvm-managed Node installations in non-interactive shells. If it does not, resolve the absolute `node` path at `brain-cache init` time and embed it in the generated script.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | `write-file-atomic@7.0.1` confirmed via npm registry; TypeScript declarations bundled confirmed; Node 22 compatibility confirmed; base stack unchanged and validated in prior milestones |
| Features | HIGH | STAT-01 through STAT-04 requirements sourced from PROJECT.md; Claude Code status line JSON schema confirmed from official docs; `session_id` field presence and all behavioral constraints confirmed |
| Architecture | HIGH | Official Claude Code statusLine docs confirmed execution model, stdin schema, debounce behavior (300ms), cancellation behavior, and settings format; existing codebase read directly for all integration points |
| Pitfalls | HIGH | Concurrent write risk confirmed from Node.js async behavior; EXDEV issue sourced from Node.js GitHub issue #19077; settings clobber risk from Claude Code issue #19487 (confirmed active April 2026); `jq` availability risk confirmed from official doc examples using it |

**Overall confidence:** HIGH

### Gaps to Address

- **nvm/nodenv PATH resolution for status line script:** `#!/usr/bin/env node` may not resolve on nvm-managed Node installations in non-interactive shells (Claude Code's launch environment). Validate during Phase 3 implementation. Mitigation: resolve absolute `node` path at `brain-cache init` time and embed it in the generated script rather than relying on `env` PATH resolution.

- **Two concurrent MCP server instances:** `write-file-atomic`'s concurrent write queue is per-process. If a user accidentally configures brain-cache in both `~/.claude/settings.json` and a project `.mcp.json`, two server processes could contend on the same stats file. Low probability scenario — document in troubleshooting output of `brain-cache init`.

- **`session_id` as future reset signal:** Research confirms the MCP server cannot currently receive `session_id` from Claude Code's status line stdin — these are separate processes with no shared channel. TTL is the correct fallback. If Claude Code adds a mechanism to pass session metadata to MCP servers in a future version, session-based reset could replace the TTL approach. No action needed now; the TTL implementation is correct and sufficient.

---

## Sources

### Primary (HIGH confidence)

- [Claude Code status line official docs](https://code.claude.com/docs/en/statusline) — execution model, stdin JSON schema, `session_id` field, debounce (300ms), in-flight cancellation, settings format, caching recommendations; confirmed April 2026
- [Claude Code settings official docs](https://code.claude.com/docs/en/settings) — settings scopes, merge order, `disableAllHooks` interaction, `statusLine` key confirmed in settings table; confirmed April 2026
- [npm registry: write-file-atomic@7.0.1](https://registry.npmjs.org/write-file-atomic/latest) — version confirmed; TypeScript declarations bundled; Node 22 compatible
- [write-file-atomic GitHub (npm org)](https://github.com/npm/write-file-atomic) — temp-file-rename atomicity pattern, per-path concurrent write queue, EXDEV copy+unlink fallback
- Direct codebase reads: `src/mcp/index.ts`, `src/workflows/init.ts`, `src/lib/config.ts`, `src/lib/types.ts`, `src/services/configLoader.ts` — all current integration points confirmed

### Secondary (MEDIUM confidence)

- [GitHub issue #19487](https://github.com/anthropics/claude-code/issues/19487) — confirmed bug: project `settings.local.json` replaces global `settings.local.json` instead of deep-merging; active as of April 2026
- [MCP Server Performance Benchmark v2](https://www.tmdevlab.com/mcp-server-performance-benchmark-v2.html) — Node.js MCP handler latency characteristics; target under 200ms for simple tools

### Tertiary (LOW confidence)

- [Node.js EXDEV issue #19077](https://github.com/nodejs/node/issues/19077) — cross-device rename failure on Linux tmpfs; mitigated entirely by using `write-file-atomic` which handles this case with copy+unlink fallback

---
*Research completed: 2026-04-03*
*Ready for roadmap: yes*
