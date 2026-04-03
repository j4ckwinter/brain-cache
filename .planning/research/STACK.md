# Stack Research

**Domain:** Claude Code status line integration for local session stats display
**Researched:** 2026-04-03
**Confidence:** HIGH (Claude Code docs verified via official source; npm versions confirmed via registry)

---

## Scope

This is a **delta research document** for the v2.4 Status Line milestone. The base stack
(Node.js 22, TypeScript, Commander CLI, Ollama, Anthropic SDK, LanceDB, chokidar v5,
tree-sitter, pino, zod v4, dedent) is validated and unchanged. This document covers ONLY
what is new for:

1. Session stats accumulation after each MCP tool call (STAT-01)
2. Status line script rendering cumulative savings (STAT-02)
3. `brain-cache init` status line installation (STAT-03)
4. Session stats reset on new session or TTL expiry (STAT-04)

---

## Recommended Stack

### New Dependencies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `write-file-atomic` | 7.0.1 | Atomic JSON writes for session stats file and `~/.claude/settings.json` | MCP handlers run per-tool-call; concurrent calls from the same session could cause partial writes and corrupt the stats JSON. `write-file-atomic` uses the POSIX temp-file-then-rename pattern: writes to a randomly named temp file in the same directory as the target, then calls `rename()`. `rename()` is atomic on Linux/macOS POSIX filesystems — readers either see the old file or the new file, never a partial write. Handles SIGINT/SIGTERM cleanup of temp files. Serializes concurrent writes to the same path. Maintained by the npm org; 1,600+ downstream projects; ships its own TypeScript declarations (no `@types/` package needed). Supports Node.js `^20.17.0 || >=22.9.0` — compatible with the project's Node 22 LTS requirement. |

### Supporting Libraries

No other new libraries required. All other capabilities are met by the existing stack:

| Need | Existing Solution |
|------|------------------|
| JSON parsing in status line script | Node.js built-in `JSON.parse` |
| File reads in status line script | Node.js built-in `fs.readFileSync` |
| `~/.claude/settings.json` manipulation | `write-file-atomic` (same new dep) |
| Token savings values | Existing `ContextMetadata.tokensSent` and `ContextMetadata.estimatedWithoutBraincache` |
| ANSI output in status line | Node.js built-in string escape codes |
| Session expiry logic | Native `Date.now()` comparison |

---

## Session Stats File Format

The MCP handlers write a JSON stats file to a well-known path after each tool call.
The status line script reads from that path on each invocation.

**Path:** `~/.brain-cache/session-stats.json`

**Schema:**
```typescript
interface SessionStats {
  version: 1;
  sessionId: string;        // From Claude Code status line stdin's session_id field
  updatedAt: string;        // ISO 8601 — used for TTL-based session expiry (4-hour window)
  tokensSaved: number;      // Cumulative: sum of (estimatedWithout - tokensSent) across calls
  tokensSent: number;       // Cumulative: sum of actual tokens sent to Claude
  estimatedWithout: number; // Cumulative: sum of estimated tokens without brain-cache
  toolCallCount: number;    // Number of MCP retrieval tool calls this session
  reductionPct: number;     // Math.round((tokensSaved / estimatedWithout) * 100)
}
```

**Design decisions:**
- `version: 1` allows schema migration without breaking old readers
- `updatedAt` ISO string enables TTL check: reset stats if older than 4 hours (covers a full work session without requiring Claude Code hooks to signal session end)
- All numerics are integers — no float precision risk in JSON serialization
- `sessionId` from the Claude Code status line stdin JSON (`session_id` field) enables the status line script to detect session changes and display `idle` for a new session before any tool calls accumulate

**Why `~/.brain-cache/` not `/tmp/`:**
- `/tmp/` is wiped on reboot; the stats file should survive short restarts
- Same directory as `profile.json` — no new directory creation required
- Multiple users on the same machine would not conflict
- The file is small (<300 bytes) and has no disk-space concern

---

## Status Line Script Design

**Language:** Node.js (`.js` file at `~/.claude/brain-cache-statusline.js`)

**Why Node.js over shell+jq:**
- Brain-cache already requires Node.js as a hard dependency — no new dependency for the user
- Node.js `fs.readFileSync` + `JSON.parse` handles the stats file without any external tools
- `jq` is not universally installed; depending on it creates a hidden install requirement
- Node.js optional chaining and null-coalescing handle missing/null JSON fields more clearly than shell conditional chains
- The official Claude Code status line documentation shows Node.js as a first-class supported script language with a provided example that reads stdin and processes JSON
- The status line script runs in the same Node.js environment already on the machine

**Output format:**
```
brain-cache  ↓38%  12.4k saved
```
When no tool calls have accumulated yet for this session:
```
brain-cache  idle
```

**ANSI color:** Permitted for status line output. Unlike MCP tool output (which is consumed
by Claude and must be plain text to avoid token inflation), status line output renders in the
terminal directly. Use green for the savings percentage, dim for `idle`.

**Settings entry installed by `brain-cache init`:**
```json
{
  "statusLine": {
    "type": "command",
    "command": "node ~/.claude/brain-cache-statusline.js"
  }
}
```

**Script location rationale (`~/.claude/` not `~/.brain-cache/`):**
- Claude Code's `/statusline` command places generated scripts in `~/.claude/` by convention
- Users expect Claude Code scripts in `~/.claude/`
- `~/.brain-cache/` is the data directory; `~/.claude/` is the scripts/tools directory
- Aligns with where `settings.json` lives (`~/.claude/settings.json`)

---

## `~/.claude/settings.json` Manipulation in `brain-cache init`

`brain-cache init` must merge the `statusLine` field into `~/.claude/settings.json` without
overwriting other user settings (e.g. `theme`, `vim`, `model`).

**Approach:**
1. Read `~/.claude/settings.json` with `fs.readFileSync` (treat ENOENT as empty `{}`)
2. Parse JSON; merge `statusLine` field only — all other fields preserved
3. Write back with `write-file-atomic` (same new dependency, same atomic guarantee)
4. Idempotency check: skip write if `statusLine.command` already contains `brain-cache-statusline`

**Existing precedent:** The current `init.ts` uses `writeFileSync` for `.mcp.json`. For
`settings.json`, `write-file-atomic` is the correct choice because `~/.claude/settings.json`
is a shared global file that other processes (e.g. Claude Code itself, other tools) may write
concurrently. The `.mcp.json` is project-local and less likely to have concurrent writers, but
`settings.json` merits the stronger guarantee.

---

## Integration With Existing Token Savings Computation

The existing `ContextMetadata` type in `src/lib/types.ts` already provides:
```typescript
interface ContextMetadata {
  tokensSent: number;
  estimatedWithoutBraincache: number;
  reductionPct: number;
  filesInContext: number;
  localTasksPerformed: string[];
  cloudCallsMade: number;
}
```

The MCP handlers in `src/mcp/index.ts` compute savings in `buildSearchResponse` and
`buildContextResponse`. `traceFlow` and `explainCodebase` produce equivalent data.

**The v2.4 work is purely additive to these existing handlers:**
1. After computing savings (which already happens), read `~/.brain-cache/session-stats.json`
2. Accumulate: add `(estimatedWithout - tokensSent)` to `tokensSaved`, increment `toolCallCount`
3. Write back atomically with `write-file-atomic`
4. The status line script reads this file independently on each status bar update

**No new savings computation logic needed.** The accumulation formula:
```typescript
const callSavings = metadata.estimatedWithoutBraincache - metadata.tokensSent;
stats.tokensSaved += callSavings;
stats.tokensSent  += metadata.tokensSent;
stats.estimatedWithout += metadata.estimatedWithoutBraincache;
stats.toolCallCount += 1;
stats.reductionPct = stats.estimatedWithout > 0
  ? Math.round((stats.tokensSaved / stats.estimatedWithout) * 100)
  : 0;
```

**Display formatting in status line script:**
```typescript
const savedK = (stats.tokensSaved / 1000).toFixed(1) + 'k';
// e.g. "brain-cache  ↓38%  12.4k saved"
```

---

## Installation

```bash
# New runtime dependency only
npm install write-file-atomic@7.0.1

# No @types/ package needed — write-file-atomic 7.x ships bundled TypeScript declarations
```

---

## Alternatives Considered

| Recommended | Alternative | Why Not |
|-------------|-------------|---------|
| `write-file-atomic` 7.0.1 | Manual `fs.writeFile` + `fs.rename` with temp path | Correctly handling temp file cleanup on SIGINT/SIGTERM, and serializing concurrent writes, is non-trivial to implement correctly. `write-file-atomic` covers both and is the established standard (used by npm itself). |
| `write-file-atomic` 7.0.1 | `fast-write-atomic` (mcollina) | Less battle-tested (~50 dependents vs 1,600+); `write-file-atomic` is the npm-org-maintained canonical version |
| `write-file-atomic` 7.0.1 | `graceful-fs` | `graceful-fs` retries on EMFILE errors — it does not provide write atomicity. Different problem. |
| Node.js script | Shell + jq | `jq` not universally installed; Node.js already required by brain-cache; shell error handling is fragile for JSON edge cases |
| `~/.brain-cache/session-stats.json` | `/tmp/brain-cache-stats.json` | `/tmp/` wiped on reboot; no user isolation in shared environments; inconsistent with existing `~/.brain-cache/` data convention |
| TTL-based expiry (4h) | `session_id` file-naming (one file per session) | File-per-session creates unbounded file accumulation without cleanup logic; TTL + `sessionId` field in a single file achieves the same reset detection with simpler management |
| TTL-based expiry (4h) | Hook-based session start signal | Claude Code hooks for session lifecycle are not documented in the status line API; TTL is the documented-safe approach for external session tracking |

---

## What NOT to Add

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| SQLite for session stats | Massively over-engineered for a single 200-byte JSON file; adds a native addon dependency | `write-file-atomic` + JSON |
| Redis / any network store | Violates "no external servers" constraint | Local file |
| `chokidar` watch on stats file | Status line script already re-executes on each assistant message via Claude Code's built-in trigger; no reactive watching needed | Direct `readFileSync` in each script invocation |
| `@anthropic-ai/tokenizer` | Token savings are already computed in MCP workflow handlers — no re-counting needed | Read `ContextMetadata.tokensSent` and `ContextMetadata.estimatedWithoutBraincache` directly |
| A background aggregation daemon | Adds operational complexity and a new process to manage; MCP handlers are already the right accumulation point | Accumulate in-process in each MCP handler, flush atomically after each call |
| `chalk` or `kleur` for ANSI | Unnecessary dep for 2-3 escape codes; chalk v5+ has CJS compatibility issues | Raw ANSI escape codes: `\x1b[32m` (green), `\x1b[2m` (dim), `\x1b[0m` (reset) |

---

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| `write-file-atomic@7.0.1` | Node.js `^20.17.0 \|\| >=22.9.0` | Project uses Node 22 LTS — fully compatible |
| `write-file-atomic@7.0.1` | TypeScript 5.x | Ships bundled `.d.ts` declarations — no `@types/write-file-atomic` needed |

---

## Sources

- [Claude Code status line docs](https://code.claude.com/docs/en/statusline) — Configuration format (`~/.claude/settings.json` `statusLine` field), stdin JSON schema (`session_id` field confirmed), Node.js script examples, update trigger behavior (after each assistant message), `command` field runs in shell. HIGH confidence — official Anthropic docs, fetched directly.
- [npm registry: write-file-atomic](https://registry.npmjs.org/write-file-atomic/latest) — v7.0.1 confirmed as current latest. HIGH confidence — direct registry query.
- [write-file-atomic GitHub](https://github.com/npm/write-file-atomic) — Temp-file-rename atomicity pattern, concurrent write serialization, npm org maintenance. HIGH confidence.
- `/workspace/src/lib/types.ts` — `ContextMetadata` interface with `tokensSent`, `estimatedWithoutBraincache`, `reductionPct` fields. Direct read.
- `/workspace/src/mcp/index.ts` — `buildSearchResponse`, `buildContextResponse` savings computation pattern. Direct read.
- `/workspace/src/workflows/init.ts` — Existing init pattern for `.mcp.json` manipulation (idempotency check, `writeFileSync` usage). Direct read.
- `/workspace/.planning/PROJECT.md` — v2.4 goals (STAT-01 through STAT-04), existing validated stack. Direct read.

---
*Stack research for: brain-cache v2.4 Status Line — Claude Code status line integration*
*Researched: 2026-04-03*
