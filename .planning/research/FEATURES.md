# Feature Research

**Domain:** Claude Code status line — cumulative MCP tool token savings display for brain-cache v2.4
**Researched:** 2026-04-03
**Confidence:** HIGH (official Claude Code docs fetched directly; brain-cache codebase token savings patterns read directly)

---

## Context: Scope of This Research

This research covers the **v2.4 Status Line** milestone only. It is a subsequent milestone layered on top of an already-shipped MCP tool suite. The status line is not a new tool — it is a visibility layer that surfaces token savings already computed per-tool-call.

**Four requirements from the milestone (STAT-01 through STAT-04):**

1. **STAT-01** — Session-level token savings accumulation in MCP retrieval handlers
2. **STAT-02** — Status line script rendering cumulative savings for Claude Code
3. **STAT-03** — `brain-cache init` installs and configures the status line into Claude Code settings
4. **STAT-04** — Session stats reset on new session or TTL-based expiry

**What already exists (not in scope for v2.4):**
- Token savings computed per tool call in 4 retrieval handlers: `search_codebase`, `build_context`, `trace_flow`, `explain_codebase` — all in `src/mcp/index.ts`
- `tokensSent`, `estimatedWithout`, `reductionPct`, `filesInContext` fields are already populated per call
- `brain-cache init` command exists in `src/workflows/init.ts` — the installer
- MCP server runs as a stdio process — it has no persistent HTTP listener

---

## How Claude Code Status Lines Work

**Mechanism (HIGH confidence — official docs):**

- Claude Code pipes a JSON blob to a shell script via stdin after every assistant message, permission-mode change, or vim-mode toggle
- Updates are debounced at 300ms; in-flight executions are cancelled when a new update arrives
- The script reads stdin, extracts fields, and writes text to stdout — Claude Code displays that text at the bottom of the terminal
- Script is configured in `~/.claude/settings.json` (user-level) or `.claude/settings.json` (project-level) under the `statusLine` key
- Status line is disabled when `disableAllHooks: true` is set — it is treated like a hook
- The status line does NOT consume API tokens — it runs locally

**JSON passed to the script — relevant fields (HIGH confidence — official docs):**

| Field | Description |
|-------|-------------|
| `session_id` | Unique session identifier — changes when a new Claude Code session starts |
| `transcript_path` | Path to conversation transcript file — changes on `/clear` |
| `context_window.total_input_tokens` | Cumulative input tokens for the session |
| `cost.total_cost_usd` | Total session cost in USD |
| `workspace.current_dir` | Current working directory — useful for project scoping |
| `workspace.project_dir` | Directory where Claude Code was launched |
| `model.display_name` | Model name (e.g. "Opus") |

**What is NOT in the JSON:** brain-cache tool call history. The JSON is Claude Code session data only. Brain-cache stats must be written to a local file by the MCP handlers and read by the status line script.

**Update timing:** The script runs after each assistant message — not after each tool call. Brain-cache tools may be called multiple times per message. The status line reflects the accumulated state as of when the script runs.

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features that must exist for the status line to be useful. Missing any of these makes the feature feel broken or incomplete.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Cumulative savings display: tokens saved + reduction %** | The core value proposition. "brain-cache  ↓38%  12.4k saved" is the stated target format from PROJECT.md. If the number isn't visible, the feature doesn't exist. | MEDIUM | Requires STAT-01 (stats accumulation) to exist before STAT-02 (script) can read anything. The `reductionPct` and `tokensSent`/`estimatedWithout` fields are already computed — this is about persisting and summing them. |
| **Idle state when no tool calls have occurred** | Before any brain-cache tool is called in a session, the stats file either doesn't exist or contains zeros. The script must output something meaningful (e.g. `brain-cache  idle`) rather than blank, error, or stale numbers. | LOW | Guard: if stats file missing or all-zero, print idle label. Graceful degradation is table stakes for a status line — a blank status line is confusing. |
| **Session boundary reset** | Stats from a previous session must not bleed into the current session's display. A user who closes Claude Code and reopens it should see fresh stats. | MEDIUM | The `session_id` field in the status line JSON is the authoritative session identifier. The stats file should store the last seen `session_id`. When the script reads a different `session_id` from the JSON, the stats are stale — either zero them out or the accumulation side should detect the new session. TTL-based expiry is the simplest alternative if session_id detection is unavailable to the MCP process. |
| **Init-time installation into settings.json** | Developers expect `brain-cache init` to handle all setup. Having to manually edit `~/.claude/settings.json` after init is a known friction point. The init command should add the `statusLine` config entry automatically. | LOW | The target config entry is simple: `{ "statusLine": { "type": "command", "command": "node <path-to-script>" } }`. Existing `init.ts` already handles `.mcp.json` injection — same pattern applies here. |
| **No blank output on error** | If the stats file is malformed, inaccessible, or the script crashes, Claude Code shows a blank status line or an ugly error. The script must have a try/catch that falls back to the idle label. | LOW | Standard scripting hygiene. Without this, a JSON parse error in the stats file would silently break the status line with no indication of why. |

### Differentiators (Competitive Advantage)

Features that make the status line noticeably more useful than a basic "tokens saved" counter.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Tool call count alongside savings** | "brain-cache  ↓38%  12.4k saved  (4 calls)" gives context for the savings number — a 38% reduction on 4 tool calls is very different from 38% on 40 calls. Low implementation cost, high interpretability gain. | LOW | Increment a `callCount` field in the stats file on each tool call. Display as a parenthetical or secondary metric. |
| **Per-project stats isolation** | Brain-cache is used across multiple projects simultaneously. Stats from a `~/projects/api` session should not aggregate with stats from a `~/projects/frontend` session. The stats file path should include the project directory hash or the workspace path to prevent cross-contamination. | MEDIUM | Use `workspace.project_dir` from the status line JSON (or `path` arg from MCP tool call) to partition stats files. E.g. `.brain-cache/<project-hash>/session-stats.json`. Alternatively, scope by `session_id` alone (since each session is implicitly one project). |
| **Compact format that survives narrow terminals** | The status line competes with Claude Code's built-in notifications (MCP errors, token warnings, rate limits) on the same row. A long label gets truncated. Target: under 40 characters for the core metrics, with optional extended format for wide terminals. | LOW | Follow the format in PROJECT.md: `brain-cache  ↓38%  12.4k saved`. Keep label, reduction %, and absolute count. Drop secondary metrics (cost, call count) if needed for brevity. |
| **Human-readable token abbreviation** | "12400 tokens saved" is harder to scan than "12.4k saved". Abbreviate to one decimal + unit suffix. | LOW | Standard formatting: < 1000 = exact, >= 1000 = `X.Xk`, >= 1000000 = `X.Xm`. Pure formatting, no logic change. |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **Real-time update after every tool call** | Users want to see the counter tick up immediately after each brain-cache call | The status line script runs after assistant messages, not after tool calls. There is no mechanism to trigger a status line update mid-message. Attempting a workaround (e.g. a background polling loop) would add complexity and conflict with the 300ms debounce. | Accept message-level granularity. Stats accumulate across tool calls in a message; the display updates after the assistant responds. This is how all Claude Code status line integrations work. |
| **Savings breakdown by tool** | "build_context saved 8k, trace_flow saved 4k" | Adds visual noise to a narrow status line. Most sessions use 1-2 tools repeatedly; a breakdown adds complexity for minimal insight. | Surface aggregate only. If per-tool breakdown is needed, expose it in `brain-cache status` CLI command (already exists in v1.0). |
| **Session cost delta attributable to brain-cache** | "brain-cache saved you $0.03 this session" | Cost savings require knowing what Claude would have spent without brain-cache, which is speculative. The token reduction % is objective; cost savings involves model pricing assumptions and context window fill-rate estimates. | Show token reduction % which is model-agnostic. Avoid cost attribution that could be misleading or incorrect across model tiers. |
| **Cross-session cumulative totals** | "Total: 2.1M tokens saved across all sessions" | Cross-session stats require persistent storage beyond a single session file, versioning, and a background aggregation mechanism. Out of scope for a status line. The status line is per-session by definition in Claude Code. | Expose lifetime stats in the `brain-cache status` CLI command if ever needed; keep the status line session-scoped. |
| **Animated or blinking updates** | Make the counter feel "live" | ANSI animations in status lines cause rendering glitches in Claude Code — the official docs warn that complex escape sequences "can occasionally cause garbled output if they overlap with other UI updates." | Static output only. Plain text with at most a directional indicator (`↓`). No ANSI blink or progress animations. |
| **jq dependency for the stats script** | jq makes parsing simple for bash scripts | The official Claude Code status line examples use jq, but requiring `jq` to be installed adds a setup step. Brain-cache targets Node.js — write the status line script in Node.js (which is already required for brain-cache) to avoid the jq dependency entirely. | Node.js script that uses `JSON.parse` directly. Already used by brain-cache — no new runtime dependency. |

---

## Feature Dependencies

```
[STAT-01: Session stats accumulation in MCP handlers]
    └──required-by──> [STAT-02: Status line script]
    └──required-by──> [STAT-04: Session reset logic]

[STAT-02: Status line script]
    └──requires──> [STAT-01: Stats file exists with correct schema]
    └──required-by──> [STAT-03: init installs the script path]

[STAT-03: brain-cache init installs status line config]
    └──requires──> [STAT-02: Script file path is known/stable]
    └──independent-of──> [STAT-04: TTL reset can ship before or after]

[STAT-04: Session boundary reset]
    └──requires-or-provides──> session_id from status line JSON OR TTL timestamp in stats file
    └──can-be-embedded-in──> [STAT-01: accumulator checks session_id before writing]
```

### Dependency Notes

- **STAT-01 must ship before STAT-02:** The script cannot display stats that do not exist. STAT-01 (writing to a stats file after each tool call) is the data producer; STAT-02 is the consumer. They can be developed in parallel but STAT-01 must be complete for the end-to-end flow to work.
- **STAT-03 is independently shippable but requires STAT-02's script path to be known:** The init installer needs to point at a specific script file. If the script path changes, init must be updated. Finalize the script output path before wiring init.
- **STAT-04 session detection has two implementation paths:** (a) The MCP handler (STAT-01 side) embeds the `session_id` into the stats file and resets counters when `session_id` changes; (b) the status line script (STAT-02 side) detects the ID change from the JSON and signals a reset by deleting or zeroing the stats file. Path (a) is cleaner — the MCP process owns the stats file and is the authoritative writer. However, the MCP process does not receive the `session_id` directly from Claude Code; it would need to read it from the transcript path or via a convention. Path (b) is simpler: the script resets the stats file when it detects a new `session_id`. A TTL fallback (e.g. reset stats older than 4 hours) handles edge cases where Claude Code crashes without a clean session end.
- **Existing token savings computation is the correct upstream source:** The `tokensSent`, `estimatedWithout`, and `reductionPct` fields are already computed correctly in `src/mcp/index.ts` in `buildSearchResponse`, `buildContextResponse`, and the `trace_flow` and `explain_codebase` handlers. STAT-01 adds a side-effect: after computing these values, also append them to the stats file. No changes needed to the savings computation logic.

---

## MVP Definition for v2.4

### Launch With (v2.4 core — all four STAT requirements)

- [ ] **STAT-01: Stats file accumulation** — After each of the 4 retrieval tool calls, append `{ tokensSent, estimatedWithout, reductionPct, filesInContext, toolName, timestamp }` to a project-scoped JSON stats file at `.brain-cache/session-stats.json`. Include a `sessionId` field (sourced from a local UUID generated at MCP startup, or from environment if Claude Code exposes it). Sum `tokensSent` and `estimatedWithout` across calls to compute cumulative reduction %.
- [ ] **STAT-02: Status line Node.js script** — Script reads `.brain-cache/session-stats.json`, computes cumulative `reductionPct = 1 - totalTokensSent / totalEstimatedWithout`, formats as `brain-cache  ↓{pct}%  {totalSaved} saved`. Falls back to `brain-cache  idle` when file missing, empty, or all-zero. Falls back to `brain-cache  error` on parse failure.
- [ ] **STAT-03: init installs status line config** — `brain-cache init` writes the `statusLine` entry to `~/.claude/settings.json` (merging with existing config, not overwriting). Points to the brain-cache status line script in the package's `bin/` or `dist/` directory.
- [ ] **STAT-04: Session boundary reset** — Status line script reads `session_id` from Claude Code JSON stdin. If `session_id` in stats file differs from the current JSON `session_id`, the stats are from a previous session — display idle or reset. TTL fallback: if stats file `timestamp` is older than 4 hours, treat as expired.

### Add After Validation (v2.4.x)

- [ ] **Tool call count in display** — Add `callCount` increment to STAT-01, surface as `(N calls)` in STAT-02 output. Trigger: user feedback that the count adds useful context to the % number.
- [ ] **Per-project stats isolation** — Scope the stats file path using `workspace.project_dir` hash from the status line JSON. Trigger: user reports stats bleeding across projects in multi-project workflows.

### Future Consideration (v2.5+)

- [ ] **Lifetime stats in `brain-cache status` CLI** — Aggregate stats across sessions for cumulative reporting. Requires a separate append-only log file and a separate CLI command.
- [ ] **Stats export / webhook** — Push savings stats to an external dashboard. Out of scope for a local developer tool; revisit only if enterprise use cases emerge.

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Stats file accumulation (STAT-01) | HIGH — prerequisite for all else | LOW (append to file after existing computation) | P1 |
| Status line script (STAT-02) | HIGH — the visible output | LOW (Node.js script, JSON.parse, string format) | P1 |
| Init installs config (STAT-03) | MEDIUM — reduces setup friction | LOW (merge into existing init workflow) | P1 |
| Session reset / TTL expiry (STAT-04) | MEDIUM — prevents stale data confusion | LOW (session_id comparison + TTL check) | P1 |
| Tool call count in display | LOW | LOW | P2 |
| Per-project stats isolation | MEDIUM | MEDIUM | P2 |
| Lifetime stats in CLI | LOW | MEDIUM | P3 |

---

## Formatting Conventions from Official Docs

The following are confirmed behaviors from the official Claude Code status line documentation (HIGH confidence):

- **Script receives JSON via stdin** — `input=$(cat)` pattern or `process.stdin` in Node.js
- **Script writes to stdout** — one line per `echo` / `console.log` statement; multiple lines are displayed as multiple rows
- **ANSI color codes are supported** — `\033[32m` green, `\033[33m` yellow, `\033[31m` red, `\033[0m` reset
- **Script runs in a new process per update** — no persistent state inside the script process; all state must be in a file
- **Cache slow operations** — the docs explicitly recommend caching expensive operations to a file with a freshness check (5-second TTL example); brain-cache's stats file IS the cache
- **Updates are debounced at 300ms** — rapid changes batch together; no need to worry about multiple writes per second
- **In-flight script is cancelled on new update** — keep the script fast (< 50ms); reading one JSON file and formatting a string is well within this budget
- **`session_id` field is available** — confirmed present in the full JSON schema from official docs
- **`transcript_path` changes on `/clear`** — can be used as a secondary session boundary signal
- **No jq needed if using Node.js** — `JSON.parse` handles the stdin JSON directly

---

## Sources

- [Claude Code status line official docs](https://code.claude.com/docs/en/statusline) — Full JSON schema, configuration format, update timing, caching recommendations (HIGH confidence — official docs fetched directly)
- `/workspace/src/mcp/index.ts` — `buildSearchResponse`, `buildContextResponse`, trace_flow and explain_codebase handlers; existing `tokensSent`, `estimatedWithout`, `reductionPct` computation (HIGH confidence — direct codebase read)
- `/workspace/.planning/PROJECT.md` — STAT-01 through STAT-04 requirements, target display format `brain-cache  ↓38%  12.4k saved` (HIGH confidence — project source of truth)
- `/workspace/src/workflows/init.ts` — Existing init workflow that STAT-03 will extend (HIGH confidence — direct codebase read)
- [Claude Code hooks reference](https://code.claude.com/docs/en/hooks) — Hook lifecycle events, trust model, disableAllHooks interaction (HIGH confidence — official docs)

---

*Feature research for: brain-cache v2.4 Status Line milestone*
*Researched: 2026-04-03*
