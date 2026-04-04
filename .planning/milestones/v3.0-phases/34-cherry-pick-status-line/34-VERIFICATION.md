---
phase: 34-cherry-pick-status-line
verified: 2026-04-04T03:40:00Z
status: passed
score: 4/4 must-haves verified
re_verification: false
---

# Phase 34: Cherry-Pick Status Line Verification Report

**Phase Goal:** The status line UX (token savings display in Claude Code) works on the stripped-down codebase, with sessionStats wired into the 3 remaining MCP handlers
**Verified:** 2026-04-04T03:40:00Z
**Status:** passed
**Re-verification:** No — initial verification
**Branch verified:** v3.0-skill-reshape

## Goal Achievement

### Observable Truths (from ROADMAP success criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | sessionStats.ts exists and accumulates stats from build_context and search_codebase handlers | VERIFIED | File exists with full implementation; accumulateStats called at lines 156 and 227 of src/mcp/index.ts (search_codebase and build_context respectively); fire-and-forget (no await) confirmed |
| 2 | statusline.mjs renders savings or idle state | VERIFIED | File exists at src/scripts/statusline.mjs with renderOutput, readStats, formatTokenCount, IDLE_OUTPUT; renders `brain-cache  idle\n` when no stats or expired; renders `brain-cache  ↓{pct}%  {n} saved\n` when stats valid |
| 3 | `brain-cache init` installs status line into Claude Code settings | VERIFIED | src/workflows/init.ts Step 9 writes statusline.mjs to ~/.brain-cache/ with chmod 755; Step 10 merges statusLine key into ~/.claude/settings.json; idempotency and warn-on-existing both implemented |
| 4 | All status line tests pass | VERIFIED | 33 tests across 3 test files all pass (8 sessionStats unit + 19 statusline unit + 6 integration subprocess); full suite of 259 tests passes |

**Score:** 4/4 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/services/sessionStats.ts` | Token savings accumulation service | VERIFIED | 112 lines; exports accumulateStats, StatsDelta, SessionStats, SESSION_STATS_PATH, STATS_TTL_MS, _resetMutexForTesting; mutex-serialized, atomic write via .tmp rename; inline config.json TTL read (no configLoader dep) |
| `src/scripts/statusline.mjs` | Standalone status line renderer | VERIFIED | 89 lines; exports formatTokenCount, readStats, renderOutput, IDLE_OUTPUT, _readStatsFromPath; stdin/stdout protocol guarded by import.meta.url check |
| `src/lib/statusline-script.ts` | Embedded script content for init deployment | VERIFIED | 93 lines; exports STATUSLINE_SCRIPT_CONTENT as template literal; inner backticks encoded as \u0060 to avoid esbuild parse error |
| `src/lib/config.ts` | SESSION_STATS_FILENAME constant | VERIFIED | Line 36: `export const SESSION_STATS_FILENAME = 'session-stats.json';` present alongside GLOBAL_CONFIG_DIR and other path constants |
| `src/mcp/index.ts` | MCP handlers with accumulateStats wiring | VERIFIED | Line 16 imports accumulateStats; line 156 in search_codebase, line 227 in build_context; both fire-and-forget (no await) |
| `src/workflows/init.ts` | Init workflow with statusline install and settings.json merge | VERIFIED | Line 4 imports STATUSLINE_SCRIPT_CONTENT; Steps 9 and 10 implement idempotent install and merge; warns on existing statusLine entry and custom content |
| `tests/services/sessionStats.test.ts` | 8 unit tests | VERIFIED | 8 tests pass; covers create, accumulate, concurrent, TTL reset, TTL within, no-throw, valid JSON keys, custom TTL via config.json file |
| `tests/scripts/statusline.test.ts` | Unit tests for statusline pure functions | VERIFIED | 19 tests pass; covers formatTokenCount edge cases, _readStatsFromPath null cases, renderOutput formatting |
| `tests/scripts/statusline.integration.test.ts` | 6 integration tests | VERIFIED | 6 tests pass; runs statusline.mjs as subprocess with HOME env override; covers valid stats, no file, expired, malformed, zero estimated, cold-start timing |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| src/services/sessionStats.ts | src/lib/config.ts | import GLOBAL_CONFIG_DIR, SESSION_STATS_FILENAME | WIRED | Line 3: `import { GLOBAL_CONFIG_DIR, SESSION_STATS_FILENAME } from '../lib/config.js'` |
| src/mcp/index.ts | src/services/sessionStats.ts | import accumulateStats | WIRED | Line 16: `import { accumulateStats } from '../services/sessionStats.js'` |
| src/mcp/index.ts search_codebase handler | accumulateStats | fire-and-forget call after results | WIRED | Line 156: `accumulateStats({ tokensSent, estimatedWithoutBraincache: estimatedWithout });` — no await, before return |
| src/mcp/index.ts build_context handler | accumulateStats | fire-and-forget call after results | WIRED | Line 227: `accumulateStats({ tokensSent, estimatedWithoutBraincache });` — no await, before return |
| src/workflows/init.ts | src/lib/statusline-script.ts | import STATUSLINE_SCRIPT_CONTENT | WIRED | Line 4: `import { STATUSLINE_SCRIPT_CONTENT } from '../lib/statusline-script.js'` (static import, not dynamic — esbuild compatibility fix) |
| src/scripts/statusline.mjs | ~/.brain-cache/session-stats.json | readFileSync(STATS_PATH) | WIRED | STATS_PATH = join(homedir(), '.brain-cache', 'session-stats.json'); _readStatsFromPath calls readFileSync |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| src/mcp/index.ts search_codebase | tokensSent, estimatedWithout | Computed from runSearch results: `chunks.reduce((sum, c) => sum + c.content.length, 0) / 4` and `tokensSent * 3` | Yes — computed from real chunk content lengths | FLOWING |
| src/mcp/index.ts build_context | tokensSent, estimatedWithoutBraincache | Extracted from `result.metadata` returned by runBuildContext | Yes — metadata comes from real retrieval result | FLOWING |
| src/scripts/statusline.mjs | stats | readFileSync(STATS_PATH) in _readStatsFromPath | Yes — reads real session-stats.json from disk | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| All status line tests pass | `npx vitest run tests/services/sessionStats.test.ts tests/scripts/statusline.test.ts tests/scripts/statusline.integration.test.ts` | 33 passed (3 files) in 375ms | PASS |
| Full test suite passes | `npx vitest run` | 259 passed (18 files) in 999ms | PASS |
| Build succeeds with all wiring | `npm run build` | ESM + DTS build success | PASS |
| accumulateStats wired in both retrieval handlers | grep pattern | Lines 156, 227 in search_codebase and build_context | PASS |
| statusline.mjs module exports renderOutput | File exists with function at line 65 | renderOutput, readStats, formatTokenCount, IDLE_OUTPUT, _readStatsFromPath all present | PASS |
| init.ts imports STATUSLINE_SCRIPT_CONTENT statically | grep pattern | Line 4 confirmed | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| SKILL-03 | 34-01, 34-02 | sessionStats service accumulates token savings from MCP retrieval handlers on stripped codebase | SATISFIED with note | sessionStats.ts wired into search_codebase and build_context; index_repo intentionally excluded (it is an indexing operation, not retrieval — plan explicitly justifies this; ROADMAP success criteria only requires build_context and search_codebase). REQUIREMENTS.md text mentions index_repo but ROADMAP success criteria takes precedence per process rules. |
| SKILL-04 | 34-02 | Status line script and init integration work identically to v2.4 | SATISFIED | init.ts installs statusline.mjs with chmod 755, merges statusLine into settings.json, warns on existing entry, is idempotent. All behaviors match v2.4 spec. |

**Note on SKILL-03 / index_repo:** REQUIREMENTS.md text says "3 MCP retrieval handlers (search_codebase, build_context, index_repo)". The plan and ROADMAP success criteria both intentionally exclude index_repo on the grounds that it is an indexing operation, not a retrieval operation, and does not produce token savings in the same sense. The ROADMAP success criteria (authoritative contract for this phase) says "accumulates stats from build_context and search_codebase handlers" — this is fully satisfied. If strict adherence to the REQUIREMENTS.md text is desired, wiring index_repo would be a one-line addition.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None found | — | — | — | — |

Scanned for: TODO/FIXME/PLACEHOLDER, empty implementations (return null/[]/{}), hardcoded empty data, console.log-only handlers. None found in phase-modified files.

### Human Verification Required

#### 1. Status Line Renders in Claude Code

**Test:** Run `brain-cache init`, then run an MCP tool call (build_context or search_codebase), then observe the Claude Code status line at the bottom of the terminal.
**Expected:** Status line shows `brain-cache  idle` initially, then `brain-cache  ↓XX%  Nk saved` after a retrieval tool call accumulates stats.
**Why human:** Claude Code status line rendering requires a running Claude Code session; cannot be verified programmatically.

#### 2. settings.json Merge Preserves Existing Keys

**Test:** Create `~/.claude/settings.json` with existing keys (e.g., `{"env": {"MY_VAR": "value"}}`), then run `brain-cache init`.
**Expected:** Resulting settings.json contains both the original `env` key and the new `statusLine` key — no data loss.
**Why human:** Requires a real filesystem environment and Claude Code setup; the idempotency logic exists in code but real-world test with an existing settings.json is a manual step.

### Gaps Summary

No gaps. All 4 success criteria are fully satisfied:

1. sessionStats.ts accumulates stats from both retrieval MCP handlers (search_codebase, build_context) with mutex-serialized atomic writes.
2. statusline.mjs correctly renders savings percentage and idle state based on session-stats.json.
3. `brain-cache init` (Steps 9-10 of runInit) installs statusline.mjs with chmod 755 and merges statusLine into settings.json, with idempotency and warn-on-existing.
4. All 33 status line tests pass; full suite of 259 tests is green; build succeeds.

The deliberate exclusion of index_repo from accumulateStats wiring is documented in both plan and ROADMAP success criteria and is not a gap relative to the phase goal.

---

_Verified: 2026-04-04T03:40:00Z_
_Verifier: Claude (gsd-verifier)_
