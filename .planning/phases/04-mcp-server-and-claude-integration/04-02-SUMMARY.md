---
phase: 04-mcp-server-and-claude-integration
plan: 02
subsystem: workflows
tags: [claude, anthropic-sdk, ask-codebase, context-retrieval, CLD-01, CLD-02]
dependency_graph:
  requires:
    - 04-01 (Anthropic SDK installation, MCP server)
    - 03-03 (runBuildContext workflow)
  provides:
    - runAskCodebase workflow (src/workflows/askCodebase.ts)
  affects:
    - Phase 5 CLI (brain-cache ask command, wired in Phase 5)
tech_stack:
  added:
    - "@anthropic-ai/sdk (Anthropic API client, installed in 04-01)"
  patterns:
    - "TDD workflow: RED (failing tests) -> GREEN (implementation) -> PASS"
    - "Env var guard pattern: process.exit(1) on missing ANTHROPIC_API_KEY"
    - "CLD-02 compliance: contextResult.content only (not chunks) sent to Claude"
    - "vi.hoisted() for mock variables accessible in vi.mock() factory"
    - "vi.clearAllMocks() in afterEach to avoid restoring vi.mock() factories"
key_files:
  created:
    - src/workflows/askCodebase.ts
    - tests/workflows/askCodebase.test.ts
  modified: []
decisions:
  - "BRAIN_CACHE_CLAUDE_MODEL env var for model override, default claude-sonnet-4-20250514"
  - "Use vi.hoisted() instead of top-level const for mock variables in vi.mock() factories"
  - "vi.clearAllMocks() in afterEach (not vi.restoreAllMocks()) to preserve vi.mock() factories"
metrics:
  duration: "4 min"
  completed: "2026-04-01"
  tasks_completed: 2
  files_created: 2
  files_modified: 0
  tests_added: 9
  tests_total_after: 213
requirements:
  - CLD-01
  - CLD-02
---

# Phase 4 Plan 2: Ask-Codebase Workflow Summary

**One-liner:** runAskCodebase workflow sends only ContextResult.content (assembled text) to Claude via Anthropic SDK, with early ANTHROPIC_API_KEY guard and configurable model via env var.

---

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create runAskCodebase workflow (TDD) | 9c5cc7c | src/workflows/askCodebase.ts |
| 2 | Create unit tests for runAskCodebase | 9c5cc7c | tests/workflows/askCodebase.test.ts |

---

## What Was Built

### `src/workflows/askCodebase.ts`

The `runAskCodebase(question, opts?)` workflow:

1. Checks `ANTHROPIC_API_KEY` early — writes clear error to stderr and calls `process.exit(1)` on missing key
2. Calls `runBuildContext(question, buildOpts)` — all local GPU work (embedding, vector search, assembly) happens here
3. Sends ONLY `contextResult.content` (the assembled text string) to Claude via Anthropic SDK — **never sends `contextResult.chunks`** (CLD-02 compliance)
4. Reads `BRAIN_CACHE_CLAUDE_MODEL` env var for model override, falls back to `claude-sonnet-4-20250514`
5. Returns `AskCodebaseResult` with `answer`, `contextMetadata` (tokensSent, estimatedWithoutBraincache, reductionPct), and `model` used

### `tests/workflows/askCodebase.test.ts`

9 unit tests with fully mocked Anthropic SDK and buildContext workflow:

- Exits with code 1 when ANTHROPIC_API_KEY is not set
- Calls runBuildContext with question and path option
- Sends contextResult.content (not chunks) to Anthropic (CLD-02 verification)
- Returns answer string from Claude response
- Uses BRAIN_CACHE_CLAUDE_MODEL env var when set
- Returns contextMetadata with tokensSent and reductionPct
- Handles response with no text block gracefully
- Uses sensible default model when env var not set
- Result includes the model name used

---

## Decisions Made

| Decision | Rationale |
|----------|-----------|
| Default model: `claude-sonnet-4-20250514` | Cost-effective for codebase Q&A; configurable via BRAIN_CACHE_CLAUDE_MODEL |
| `vi.hoisted()` for mock variables | vi.mock() factories are hoisted before variable declarations; vi.hoisted() ensures the variable is available at factory execution time |
| `vi.clearAllMocks()` in afterEach | `vi.restoreAllMocks()` would restore vi.mock() factories to real implementations, breaking subsequent tests |
| CLI wiring deferred to Phase 5 | Per plan spec — runAskCodebase is callable by code only in Phase 4 |

---

## Deviations from Plan

None — plan executed exactly as written, with one non-critical TDD discovery:

**[Rule 1 - Bug] vi.restoreAllMocks() breaks SDK mock in afterEach**
- **Found during:** Task 2 (test debugging)
- **Issue:** `vi.restoreAllMocks()` restores `vi.mock()` factories to real implementations, causing `client.messages` to be undefined in tests after the first test
- **Fix:** Changed to `vi.clearAllMocks()` + explicit `.mockRestore()` for specific spies (stderr, process.exit)
- **Files modified:** tests/workflows/askCodebase.test.ts (line ~97)
- **Commit:** 9c5cc7c

---

## Known Stubs

None — `runAskCodebase` is fully wired. CLI surface (`brain-cache ask <question>`) is intentionally deferred to Phase 5 per the project roadmap (not a stub).

---

## Verification Results

- `npx vitest run tests/workflows/askCodebase.test.ts` — 9/9 PASS
- `npm test` — 213/213 PASS (no regressions)
- `grep 'contextResult.content' src/workflows/askCodebase.ts` — matches (CLD-02 compliant)
- `grep -c 'contextResult.chunks' src/workflows/askCodebase.ts` — returns 0 (chunks never sent to Claude)

## Self-Check: PASSED
