---
phase: 04-mcp-server-and-claude-integration
verified: 2026-04-01T04:14:11Z
status: passed
score: 11/11 must-haves verified
re_verification: false
---

# Phase 4: MCP Server and Claude Integration Verification Report

**Phase Goal:** Claude Code can discover and call Braincache tools natively via MCP stdio, and the ask-codebase workflow sends minimal assembled context to Claude for reasoning
**Verified:** 2026-04-01T04:14:11Z
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths (Plan 04-01)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | MCP server starts on stdio transport without crashing | VERIFIED | `StdioServerTransport` wired in `main()`, `dist/mcp.js` builds and contains no shebang (correct for node invocation) |
| 2 | index_repo tool returns JSON with status and file/chunk count after indexing | VERIFIED | Handler calls `runIndex` then `readIndexState(resolve(path))`, returns `{status, path, fileCount, chunkCount}`. Test asserts `fileCount === 5` (number, not null) |
| 3 | search_codebase tool returns JSON array of chunks with similarity scores | VERIFIED | Handler calls `runSearch(query, {limit, path})`, returns `JSON.stringify(chunks)`. Test asserts parsed array has similarity field |
| 4 | build_context tool returns assembled context with metadata (tokensSent, reductionPct) | VERIFIED | Handler calls `runBuildContext(query, {maxTokens, path})`, returns `JSON.stringify(result)` containing full `ContextResult` |
| 5 | doctor tool returns structured health object with ollamaStatus, indexFreshness, modelLoaded, vramAvailable | VERIFIED | Bypasses `runDoctor()`, calls services directly — returns `{ollamaStatus, ollamaVersion, indexFreshness, modelLoaded, embeddingModel, vramAvailable, vramTier}` |
| 6 | Invalid tool inputs are rejected with Zod validation error before handler logic | VERIFIED | All inputs use Zod schemas (`z.string()`, `z.number().int().min(1).max(50)`, `.optional()`) via MCP SDK's `inputSchema` |
| 7 | Tool errors return isError:true responses, never crash the server process | VERIFIED | All 4 tools have guard checks returning `{isError:true, content:[...]}` on failure, plus try/catch blocks. `grep -c 'isError' src/mcp/index.ts` = 10 |

### Observable Truths (Plan 04-02)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 8 | runAskCodebase accepts a question, retrieves context locally via runBuildContext, sends only assembled content to Claude, and returns Claude's text answer | VERIFIED | Line 45: `runBuildContext(question, buildOpts)`, line 62: `contextResult.content` in prompt, returns `AskCodebaseResult.answer` |
| 9 | Claude receives ContextResult.content (assembled text string), NOT ContextResult.chunks array | VERIFIED | `grep -c 'contextResult.chunks' src/workflows/askCodebase.ts` = 0. Only `contextResult.content` used in message |
| 10 | Missing ANTHROPIC_API_KEY produces a clear error message, not an opaque SDK exception | VERIFIED | Early guard at line 32-38 writes to stderr: "ANTHROPIC_API_KEY environment variable is not set" with instructions |
| 11 | Claude model name is configurable via BRAIN_CACHE_CLAUDE_MODEL env var with sensible default | VERIFIED | Line 52: `process.env.BRAIN_CACHE_CLAUDE_MODEL ?? DEFAULT_CLAUDE_MODEL` where default is `claude-sonnet-4-20250514` |

**Score:** 11/11 truths verified

---

### Required Artifacts

| Artifact | Min Lines | Actual | Status | Details |
|----------|-----------|--------|--------|---------|
| `src/mcp/index.ts` | 120 | 274 | VERIFIED | 4 `registerTool` calls, `StdioServerTransport`, `McpServer`, `isError` guards throughout |
| `.mcp.json` | — | 8 | VERIFIED | Valid JSON, contains `"brain-cache"` key pointing to `"./dist/mcp.js"` |
| `tsup.config.ts` | — | 23 | VERIFIED | Dual-config array: CLI entry with shebang banner, MCP entry without; `clean:false` on MCP |
| `tests/mcp/server.test.ts` | 80 | 380 | VERIFIED | 15 tests using mock-capture pattern, covers all 4 tools |
| `src/workflows/askCodebase.ts` | 40 | 89 | VERIFIED | Exports `runAskCodebase`, `AskCodebaseOptions`, `AskCodebaseResult` |
| `tests/workflows/askCodebase.test.ts` | 60 | 220+ | VERIFIED | 9 tests with mocked Anthropic SDK |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/mcp/index.ts` | `src/workflows/index.js` | `import runIndex` | WIRED | Line 13: `import { runIndex } from '../workflows/index.js'`; called in `index_repo` handler |
| `src/mcp/index.ts` | `src/workflows/search.js` | `import runSearch` | WIRED | Line 14: `import { runSearch } from '../workflows/search.js'`; called in `search_codebase` handler |
| `src/mcp/index.ts` | `src/workflows/buildContext.js` | `import runBuildContext` | WIRED | Line 15: `import { runBuildContext } from '../workflows/buildContext.js'`; called in `build_context` handler |
| `src/mcp/index.ts` | `src/services/capability.js` | `import readProfile, detectCapabilities` | WIRED | Lines 6-7; both called in tool handlers |
| `tsup.config.ts` | `src/mcp/index.ts` | entry object | WIRED | `entry: { mcp: 'src/mcp/index.ts' }` on line 14 |
| `src/workflows/askCodebase.ts` | `src/workflows/buildContext.js` | `import runBuildContext` | WIRED | Line 2: `import { runBuildContext } from './buildContext.js'`; called at line 45 |
| `src/workflows/askCodebase.ts` | `@anthropic-ai/sdk` | `import Anthropic` | WIRED | Line 1: `import Anthropic from '@anthropic-ai/sdk'`; instantiated at line 55 and `messages.create` called at line 56 |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|--------------|--------|--------------------|--------|
| `src/mcp/index.ts` (index_repo) | `indexState` | `readIndexState(resolvedPath)` | Yes — reads `.brain-cache/index_state.json` from disk | FLOWING |
| `src/mcp/index.ts` (search_codebase) | `chunks` | `runSearch(query, opts)` | Yes — calls LanceDB vector search | FLOWING |
| `src/mcp/index.ts` (build_context) | `result` | `runBuildContext(query, opts)` | Yes — full retrieval + assembly pipeline | FLOWING |
| `src/mcp/index.ts` (doctor) | `health` | Multiple service calls | Yes — live capability detection + index state | FLOWING |
| `src/workflows/askCodebase.ts` | `contextResult.content` | `runBuildContext(question, buildOpts)` | Yes — local retrieval pipeline | FLOWING |
| `src/workflows/askCodebase.ts` | `answer` | `client.messages.create(...)` | Yes — Anthropic API response | FLOWING |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| MCP server builds to dist/mcp.js | `ls /workspace/dist/mcp.js` | File exists | PASS |
| CLI builds to dist/cli.js (no regression) | `ls /workspace/dist/cli.js` | File exists | PASS |
| dist/cli.js has shebang | `grep -c '#!/usr/bin/env node' dist/cli.js` | 1 | PASS |
| dist/mcp.js has no shebang | `grep -c '#!/usr/bin/env node' dist/mcp.js` | 0 | PASS |
| .mcp.json is valid JSON with brain-cache key | `node -e "JSON.parse(...)"` | VALID | PASS |
| All 213 tests pass | `npm test` | 213/213 | PASS |
| MCP tool tests (15) pass | `npx vitest run tests/mcp/server.test.ts` | 15/15 | PASS |
| ask-codebase tests (9) pass | `npx vitest run tests/workflows/askCodebase.test.ts` | 9/9 | PASS |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| MCP-01 | 04-01 | MCP server via stdio transport discoverable by Claude Code | SATISFIED | `StdioServerTransport` in `src/mcp/index.ts`; `.mcp.json` at project root points to `dist/mcp.js` |
| MCP-02 | 04-01 | `index_repo` tool indexes codebase, returns status and file count | SATISFIED | Tool registered, returns `{status, fileCount, chunkCount}` JSON; test asserts `fileCount === 5` |
| MCP-03 | 04-01 | `search_codebase` tool returns top-N chunks with scores | SATISFIED | Tool registered, returns `JSON.stringify(chunks)` with similarity scores |
| MCP-04 | 04-01 | `build_context` tool returns assembled context with metadata | SATISFIED | Tool registered, returns full `ContextResult` including `metadata.tokensSent`, `reductionPct` |
| MCP-05 | 04-01 | `doctor` tool returns system health: Ollama status, index freshness, model loaded, VRAM | SATISFIED | Tool registered, returns structured `health` object with all 4 required fields |
| CLD-01 | 04-02 | ask-codebase workflow accepts question, retrieves context locally, sends minimal context to Claude, returns answer | SATISFIED | `runAskCodebase` exported; calls `runBuildContext` locally, sends to Anthropic SDK, returns `AskCodebaseResult` |
| CLD-02 | 04-02 | Claude receives only assembled context (not raw chunks) | SATISFIED | `contextResult.content` used in prompt; `contextResult.chunks` never referenced in `askCodebase.ts` |

All 7 requirements SATISFIED. No orphaned requirements.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | — | — | No anti-patterns found |

No TODOs, FIXMEs, placeholder returns, hardcoded empty data, or console.log calls found in any Phase 4 production files.

---

### Human Verification Required

None. All observable behaviors are verifiable programmatically:
- MCP server stdio connection verified via build artifact existence and test suite
- Tool input validation verified via Zod schema definitions in source
- CLD-02 compliance verified via source grep (zero references to chunks in Claude prompt)
- Full test suite passes with 213/213 tests

---

### Gaps Summary

No gaps found. All 11 must-have truths are verified, all 6 artifacts exist and are substantive, all 7 key links are wired, all 7 requirements are satisfied, and the full test suite passes with no regressions.

---

_Verified: 2026-04-01T04:14:11Z_
_Verifier: Claude (gsd-verifier)_
