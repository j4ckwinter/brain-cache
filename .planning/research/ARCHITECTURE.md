# Architecture Research

**Domain:** Claude Code status line integration for a local MCP tool suite
**Researched:** 2026-04-03
**Confidence:** HIGH — official Claude Code statusLine docs confirmed at code.claude.com/docs/en/statusline; existing codebase read directly

---

## System Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                     Claude Code (host process)                    │
│  ┌────────────────────┐         ┌──────────────────────────────┐ │
│  │   MCP stdio server │         │  statusLine runner (host UI)  │ │
│  │   src/mcp/index.ts │         │  runs ~/.brain-cache/         │ │
│  └────────┬───────────┘         │  statusline.sh after each    │ │
│           │ tool results        │  assistant message            │ │
│           │                     └──────────────┬───────────────┘ │
└───────────┼─────────────────────────────────── │ ───────────────┘
            │                                     │
            ▼                                     ▼
┌───────────────────────┐           ┌─────────────────────────────┐
│  workflow layer       │           │  Session stats file          │
│  runBuildContext      │──writes──▶│  ~/.brain-cache/             │
│  runTraceFlow         │           │  session-stats.json          │
│  runExplainCodebase   │           └──────────────┬──────────────┘
│  runSearch (passive)  │                          │ reads
└───────────────────────┘                          ▼
                                   ┌─────────────────────────────┐
                                   │  statusline.sh              │
                                   │  reads session-stats.json   │
                                   │  prints: brain-cache ↓38%  │
                                   │          12.4k saved        │
                                   └─────────────────────────────┘
```

---

## How the Claude Code Status Line Works

**Configuration** (HIGH confidence — official docs, code.claude.com/docs/en/statusline, April 2026):

```json
{
  "statusLine": {
    "type": "command",
    "command": "~/.brain-cache/statusline.sh"
  }
}
```

This goes into `~/.claude/settings.json` (user scope — applies to all projects for that user).

**Execution model:**
- Claude Code runs the script and pipes a JSON object to stdin after each assistant message.
- The script reads stdin, outputs text to stdout; that text appears as the status line.
- Updates debounced at 300ms. If a new update triggers while the script is running, the in-flight execution is cancelled.
- The script is a new process on every invocation — no shared state between calls.
- Scripts that exit with non-zero code or produce no output cause the status line to go blank.
- The status line is disabled when `disableAllHooks: true` is set in settings.

**The session JSON from Claude Code does NOT contain brain-cache stats.** It contains Claude's own context window data, cost, model info, and session metadata. Brain-cache stats must come from a separate file that the MCP handlers write.

**Key architectural implication:** The statusline script is the reader of a file that MCP handlers write. File-based IPC is the only viable mechanism — the script is a short-lived process with no connection to the MCP server process.

---

## Integration Architecture: New vs Modified Components

### New Components

#### 1. `src/services/sessionStats.ts` — Stats accumulation service

**Purpose:** Read/write the session stats file at `~/.brain-cache/session-stats.json`. Owns the file format, TTL-based session boundary detection, and atomic writes.

**Responsibility boundary:** This is a service (not a workflow) because it has no orchestration — it is a pure data store abstraction. It sits alongside `configLoader.ts` and `capability.ts` in the services layer.

**Interface:**
```typescript
export interface SessionStats {
  startedAt: string;           // ISO 8601
  lastUpdatedAt: string;       // ISO 8601
  totalTokensSaved: number;
  totalTokensSent: number;
  totalCallCount: number;
  reductionPctLatest: number;  // pct from most recent call
}

export async function readSessionStats(): Promise<SessionStats | null>
export async function accumulateStats(delta: {
  tokensSaved: number;
  tokensSent: number;
  reductionPct: number;
}): Promise<void>
```

**File location:** `~/.brain-cache/session-stats.json` — alongside `profile.json` and `config.json`, consistent with the existing global config pattern in `src/lib/config.ts`.

**Session TTL:** The MCP handlers receive no session ID from Claude Code (the MCP protocol carries no such metadata). TTL-based reset is the correct approach: if `lastUpdatedAt` is more than N hours old (e.g., 4 hours), `accumulateStats` resets counters before accumulating the new delta. This handles session boundaries without any session ID coordination.

**Atomic write:** Write to `session-stats.json.tmp` then `fs.rename()` to final path. POSIX `rename` is atomic. Prevents the statusline script from reading a partial file.

#### 2. `~/.brain-cache/statusline.sh` — Status line shell script

**Purpose:** Read `~/.brain-cache/session-stats.json` and print formatted status line output to stdout.

**Not a TypeScript file in src/.** It is a shell script (or Node.js script) that Claude Code invokes directly. Shell is simplest: no Node.js startup overhead, no build step, no dist path to manage.

**Output format:**
- When calls exist: `brain-cache  ↓38%  12.4k saved`
- When no calls yet (missing file, zero calls): `brain-cache  idle`
- On parse error: `brain-cache  idle` — never fail silently (blank = confusing)

**Location:** `~/.brain-cache/statusline.sh` — global config directory, not per-project. Installed by `brain-cache init`.

**Token display:** `totalTokensSaved / 1000` formatted as `12.4k`. Use `reductionPctLatest` for the percentage (most recent call's reduction, not a session average — simpler and more actionable for the user).

#### 3. `src/workflows/statusLine.ts` — Script template and install logic

**Purpose:** Generate the `statusline.sh` script content, write it to `~/.brain-cache/statusline.sh`, make it executable, and return the `settings.json` fragment for `runInit` to apply.

**Why a workflow, not a service:** The install logic is orchestration — it coordinates writing the script, setting permissions, and computing the settings fragment. This mirrors how `runInit` already contains orchestration logic for `.mcp.json` and `CLAUDE.md`.

**Interface:**
```typescript
export async function installStatusLineScript(): Promise<{
  scriptPath: string;
  settingsFragment: { statusLine: { type: string; command: string } };
}>
```

The `settingsFragment` returns `{ statusLine: { type: "command", command: "~/.brain-cache/statusline.sh" } }`.

The script template is a string constant in this file — no external file needed at build time.

### Modified Components

#### 4. `src/mcp/index.ts` — Stats accumulation after each retrieval tool call

**What changes:** After each successful response from `runBuildContext`, `runTraceFlow`, `runExplainCodebase`, and `runSearch`, call `accumulateStats` from the sessionStats service.

**Where exactly:** In each MCP handler, after the workflow completes and the response object is constructed, before `return`. The token savings numbers come from the workflow result metadata that is already available at this point.

**Why the MCP handler layer, not the workflow layer:**
- The CLI also calls the same workflows (`brain-cache context`, `brain-cache ask`). CLI invocations should not accumulate MCP session stats.
- Workflows are orchestration and must stay decoupled from persistence side effects.
- The MCP handler already has all needed fields (`tokensSent`, `estimatedWithoutBraincache`, `reductionPct`) from the workflow result.

**Pattern:**
```typescript
// After successful result in build_context handler:
await accumulateStats({
  tokensSaved: result.metadata.estimatedWithoutBraincache - result.metadata.tokensSent,
  tokensSent: result.metadata.tokensSent,
  reductionPct: result.metadata.reductionPct,
}).catch(() => { /* non-fatal — stats failure must not fail the tool call */ });
```

The `.catch(() => {})` is required: stats persistence failure must never cause a tool call to fail.

**search_codebase handler:** Include for completeness. Its savings estimate uses `tokensSent * 3` (approximate), but accumulated values will be in the same ballpark as the other tools.

#### 5. `src/workflows/init.ts` — Status line installation

**What changes:** Add Step 12 at the end of `runInit` that calls `installStatusLineScript()` and then merges the returned `settingsFragment` into `~/.claude/settings.json`.

**Pattern for `~/.claude/settings.json` mutation:**
```typescript
const settingsPath = join(homedir(), '.claude', 'settings.json');
// Read existing file if present, parse, deep merge settingsFragment, write back
```

Same pattern as the existing `.mcp.json` mutation (read → parse → merge → write).

**Idempotency guard:** Check if `statusLine.command` is already set to the correct path before writing. If already correct, print "skipping" and move on — same approach as the `.mcp.json` check at lines 103-106.

**Permissions:** After writing the script file, call `fs.chmod(scriptPath, 0o755)` to make it executable.

#### 6. `src/lib/config.ts` — New path constants

**What changes:** Add:
```typescript
export const SESSION_STATS_PATH = join(GLOBAL_CONFIG_DIR, 'session-stats.json');
export const STATUS_LINE_SCRIPT_PATH = join(GLOBAL_CONFIG_DIR, 'statusline.sh');
export const SESSION_STATS_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours
```

---

## Data Flow

### Per-Tool-Call Stats Accumulation

```
MCP handler (build_context / trace_flow / explain_codebase / search_codebase)
    │
    ├─ calls workflow (runBuildContext / runTraceFlow / runExplainCodebase / runSearch)
    │       │
    │       └─ returns result.metadata: { tokensSent, estimatedWithoutBraincache, reductionPct }
    │
    ├─ formats response (existing logic, unchanged)
    │
    └─ fire-and-forget: accumulateStats(delta)
            │
            ├─ reads ~/.brain-cache/session-stats.json
            ├─ if lastUpdatedAt > TTL: reset counters
            ├─ adds delta to totals
            └─ atomically writes ~/.brain-cache/session-stats.json
```

### Status Line Render (triggered by Claude Code after each response)

```
Claude Code (host process)
    │
    └─ forks ~/.brain-cache/statusline.sh
            │
            ├─ receives Claude's session JSON on stdin (not used)
            │
            ├─ reads ~/.brain-cache/session-stats.json
            │
            └─ prints to stdout:
                  "brain-cache  ↓38%  12.4k saved"    (if totalCallCount > 0)
                  "brain-cache  idle"                   (if missing / no calls)
```

### Init Flow

```
runInit (src/workflows/init.ts)
    │
    ├─ Step 1-10 (existing: hardware, Ollama, model, profile, .mcp.json, CLAUDE.md)
    │
    └─ Step 12 (NEW): installStatusLineScript()
            │
            ├─ write script content to ~/.brain-cache/statusline.sh
            ├─ chmod +x ~/.brain-cache/statusline.sh
            └─ merge { statusLine: ... } into ~/.claude/settings.json
```

---

## Component Boundaries

| Component | Responsibility | Layer | Communicates With |
|-----------|---------------|-------|-------------------|
| `src/services/sessionStats.ts` | Read/write `~/.brain-cache/session-stats.json`, TTL reset | service | Called by MCP handlers (fire-and-forget) |
| `src/workflows/statusLine.ts` | Generate script content, write to disk, return settings fragment | workflow | Called by `runInit` |
| `src/mcp/index.ts` (modified) | Accumulate stats after each retrieval tool response | mcp handler | Calls `sessionStats` service |
| `src/workflows/init.ts` (modified) | Install status line script into `~/.claude/settings.json` | workflow | Calls `statusLine` workflow |
| `src/lib/config.ts` (modified) | Path and TTL constants for new features | lib | Imported by `sessionStats` service and `statusLine` workflow |
| `~/.brain-cache/statusline.sh` | Read stats file, render status line text | installed artifact (shell script) | Reads `session-stats.json` at runtime |
| `~/.brain-cache/session-stats.json` | Persisted session stats (file-based IPC) | runtime artifact | Written by MCP handlers, read by statusline.sh |
| `~/.claude/settings.json` | User-scoped Claude Code settings declaring statusLine command | installed artifact (JSON) | Written by `runInit`, read by Claude Code |

---

## Recommended File Structure (new additions only)

```
src/
├── services/
│   └── sessionStats.ts       # NEW — read/write ~/.brain-cache/session-stats.json
├── workflows/
│   └── statusLine.ts         # NEW — script template + ~/.claude/settings.json integration
└── mcp/
    └── index.ts              # MODIFIED — accumulateStats() after each retrieval tool

~/.brain-cache/               # existing global config dir
├── profile.json              # existing
├── config.json               # existing (optional user config)
└── session-stats.json        # NEW runtime artifact — written by MCP, read by statusline.sh

~/.brain-cache/statusline.sh  # NEW installed artifact — shell script, chmod +x

~/.claude/
└── settings.json             # MODIFIED — statusLine entry added by brain-cache init
```

The script lives at `~/.brain-cache/statusline.sh`, not `~/.claude/statusline.sh`. Brain-cache owns its config directory; `~/.claude/` is Claude Code's territory and should not be used for brain-cache artifacts beyond settings.json modifications.

---

## Architectural Patterns

### Pattern 1: Non-fatal fire-and-forget side effect

**What:** Stats accumulation is called after the main operation, with `.catch(() => {})`. It never propagates errors.

**When to use:** Any side effect that should not degrade the primary tool response.

**Why here:** The MCP tool contract is to return a response to Claude. Stats persistence is secondary infrastructure. If the disk is full or the stats file is locked, the tool call must still succeed.

### Pattern 2: File-based IPC for cross-process data

**What:** The MCP server (long-lived Node.js process, possibly running in a Docker container or remote environment) writes a JSON file. The statusline script (short-lived shell process, spawned by Claude Code's host) reads it.

**When to use:** When two processes cannot share memory and the data is infrequently written.

**Why this over alternatives:**
- Unix socket: too much complexity for stats that change once per tool call.
- Environment variable: cannot be set on the statusline.sh process by the MCP server.
- SQLite: no new dependency warranted for a single stats record.
- Posting to a localhost HTTP server: adds a long-running server process, overkill.

**Atomic write:** Write to `session-stats.json.tmp` then `fs.rename()` to prevent partial reads.

### Pattern 3: TTL-based session identity

**What:** A "session" is defined as activity within a rolling TTL window (default 4 hours). When `accumulateStats` is called and `lastUpdatedAt` is more than TTL old, counters reset before the delta is added.

**When to use:** When the component writing stats (MCP server) has no visibility into session start/stop events from the host (Claude Code).

**Why not use session_id from Claude Code:** The `session_id` field is present in the JSON that Claude Code sends to the statusline script's stdin. However, the MCP server has no way to receive that value — it communicates only via JSON-RPC stdio with the tool caller (Claude itself). There is no channel for the statusline script to pass `session_id` to the MCP server. TTL is simpler and sufficient.

### Pattern 4: Workflow produces the installer, runInit orchestrates

**What:** `statusLine.ts` is a workflow that knows how to produce the shell script and the settings fragment. `runInit` calls it, same as it calls other install helpers. `runInit` is the single place that orchestrates all first-run installation steps.

**When to use:** When a new feature requires both a file artifact and a config change during `init`. Adding the logic to `runInit` directly would make it too large; a dedicated workflow keeps responsibilities separated.

---

## Anti-Patterns

### Anti-Pattern 1: Accumulating stats in the workflow layer

**What people do:** Add `accumulateStats()` to `runBuildContext`, `runTraceFlow`, `runExplainCodebase`.

**Why it's wrong:** Workflows are shared between CLI and MCP. The CLI (`brain-cache context`, `brain-cache ask`) calls the same workflows but should not write MCP session stats. Stats accumulation is an MCP-specific side effect.

**Do this instead:** Accumulate in the MCP handler layer only. The MCP server is the only process where these stats are meaningful.

### Anti-Pattern 2: Polling or computing in the statusline script

**What people do:** Have the statusline script call `brain-cache status`, read LanceDB, or re-compute savings on each invocation.

**Why it's wrong:** The script runs after every Claude message, potentially multiple times per minute. LanceDB and Ollama calls have cold-start overhead. The script would be slow enough to trigger cancellations (the in-flight script is cancelled when a new update arrives).

**Do this instead:** The MCP server writes pre-computed stats to a flat JSON file. The statusline script reads only that file — cat + jq, no computation, no external processes.

### Anti-Pattern 3: Installing the script to `~/.claude/`

**What people do:** Put the script at `~/.claude/statusline.sh` to mirror Claude Code's own examples.

**Why it's wrong:** `~/.claude/` is Claude Code's user config directory. Brain-cache does not own it. Future Claude Code updates may add their own `statusline.sh` default or conflict with arbitrary files placed there.

**Do this instead:** Install at `~/.brain-cache/statusline.sh`. The `settings.json` `command` path simply points there. Brain-cache already owns `~/.brain-cache/`.

### Anti-Pattern 4: Awaiting stats accumulation before returning the tool response

**What people do:** `await accumulateStats(delta)` before `return response` so stats are guaranteed written.

**Why it's wrong:** Adds latency to every tool call. Turns a non-critical side effect into a blocking operation.

**Do this instead:** Fire-and-forget with `.catch`. The status line runs after the response is delivered — by then the file write will have completed.

### Anti-Pattern 5: Storing the session stats TTL in `~/.brain-cache/config.json` (user config)

**What people do:** Let users configure the TTL via `config.json`, treating it like other retrieval settings.

**Why it's wrong:** The TTL is an implementation detail of the stats service, not a user-tunable parameter. Adding it to user config creates surface area without value.

**Do this instead:** Hardcode the TTL as a constant in `src/lib/config.ts`. If it needs to change, it is a code change.

---

## Build Order

The four active requirements have a clear dependency chain:

```
Phase A: src/services/sessionStats.ts
    │     (new file, depends only on config.ts constants)
    │
    ├── Phase B: MCP handler instrumentation  (STAT-01)
    │     (depends on sessionStats service)
    │     Testable: run brain-cache tools via MCP, verify session-stats.json created/updated
    │
    └── Phase C: statusLine workflow + runInit integration  (STAT-02, STAT-03)
          (depends on sessionStats for path constants)
          (depends on Phase B for an actual stats file to read during end-to-end test)
          Testable: run brain-cache init, verify ~/.brain-cache/statusline.sh exists
                    and ~/.claude/settings.json contains statusLine entry
          Testable: verify statusline.sh outputs expected format given a test stats file

Phase D: TTL/session reset logic  (STAT-04)
    (depends on Phase B — needs live stats accumulation to test expiry correctly)
    Can be implemented as part of Phase A but tested after Phase B
```

**Recommended phase grouping:**

- **Phase 1 (foundation):** `sessionStats.ts` service (STAT-01 infra) + `src/lib/config.ts` constants
- **Phase 2 (accumulation):** MCP handler instrumentation (STAT-01 behavior) + TTL reset in service (STAT-04)
- **Phase 3 (rendering + install):** `statusLine.ts` workflow + `runInit` integration + shell script template (STAT-02, STAT-03)

Phases 1 and 2 can be combined; Phase 3 depends on the stats file being written by Phase 2 for meaningful integration testing.

---

## Integration Points Summary

| Integration Point | New or Modified | Build Order |
|-------------------|-----------------|-------------|
| `src/lib/config.ts` | MODIFIED — add 3 constants | Phase 1 |
| `src/services/sessionStats.ts` | NEW | Phase 1 |
| `src/mcp/index.ts` — build_context handler | MODIFIED | Phase 2 |
| `src/mcp/index.ts` — trace_flow handler | MODIFIED | Phase 2 |
| `src/mcp/index.ts` — explain_codebase handler | MODIFIED | Phase 2 |
| `src/mcp/index.ts` — search_codebase handler | MODIFIED | Phase 2 |
| `src/workflows/statusLine.ts` | NEW | Phase 3 |
| `src/workflows/init.ts` | MODIFIED — Step 12 | Phase 3 |
| `~/.brain-cache/session-stats.json` | NEW runtime artifact | written at Phase 2 runtime |
| `~/.brain-cache/statusline.sh` | NEW installed artifact | installed at Phase 3 runtime |
| `~/.claude/settings.json` | MODIFIED installed artifact | mutated at Phase 3 runtime |

---

## Sources

- [Claude Code statusLine documentation](https://code.claude.com/docs/en/statusline) — HIGH confidence, official docs. Confirmed April 2026: `~/.claude/settings.json` key is `statusLine`, `type: "command"`, script receives JSON on stdin, updates after each assistant message, debounced 300ms, cancelled if new update arrives while running.
- [Claude Code settings documentation](https://code.claude.com/docs/en/settings) — HIGH confidence. Confirms `disableAllHooks: true` also disables statusLine. `statusLine` appears in settings table with `{"type": "command", "command": "~/.claude/statusline.sh"}` as example.
- Direct codebase reads: `src/mcp/index.ts`, `src/workflows/init.ts`, `src/lib/config.ts`, `src/lib/types.ts`, `src/services/configLoader.ts`, `src/workflows/buildContext.ts` — HIGH confidence, current state.

---

*Architecture research for: brain-cache v2.4 status line integration*
*Researched: 2026-04-03*
