---
phase: 04-mcp-server-and-claude-integration
plan: 01
subsystem: mcp
tags: [mcp, stdio, modelcontextprotocol, anthropic-sdk, tools, health-check]

# Dependency graph
requires:
  - phase: 03-retrieval-and-context-assembly
    provides: runSearch, runBuildContext, ContextResult, RetrievedChunk types
  - phase: 02-storage-and-indexing
    provides: runIndex, readIndexState, LanceDB storage
  - phase: 01-foundation
    provides: capability services, ollama services, logger, types, config
provides:
  - MCP server entry point at src/mcp/index.ts with 4 registered tools
  - index_repo tool for codebase indexing via MCP
  - search_codebase tool for vector search via MCP
  - build_context tool for assembled context retrieval via MCP
  - doctor tool for system health status via MCP
  - .mcp.json for Claude Code project-scope MCP discovery
  - tsup dual-entry build (cli + mcp)
affects:
  - 04-02-ask-codebase (MCP server infrastructure is ready)
  - 05-cli-completion (CLI and MCP surfaces established as parallel)

# Tech tracking
tech-stack:
  added:
    - "@modelcontextprotocol/sdk (MCP server + stdio transport)"
    - "@anthropic-ai/sdk (Anthropic API client, available for ask-codebase)"
  patterns:
    - "MCP tool handlers guard via readProfile + isOllamaRunning before workflow dispatch"
    - "doctor tool directly calls services — avoids runDoctor() which calls process.exit"
    - "resolve(userPath) before readIndexState to guarantee absolute path lookup"
    - "isError:true responses on guard failures instead of process.exit"

key-files:
  created:
    - src/mcp/index.ts
    - .mcp.json
    - tests/mcp/server.test.ts
  modified:
    - tsup.config.ts
    - package.json
    - package-lock.json

key-decisions:
  - "MCP tool handlers re-check readProfile + isOllamaRunning before calling workflows — prevents process.exit in MCP context"
  - "doctor bypasses runDoctor() and calls services directly for structured JSON health response"
  - "tsup dual-config array: CLI gets shebang banner, MCP entry does not — prevents double-shebang SyntaxError"
  - "clean:false on MCP tsup entry so CLI output is not deleted on second build step"

patterns-established:
  - "MCP handler pattern: guard checks → try/catch → JSON.stringify result → isError on failure"
  - "All MCP logging via childLogger('mcp') to stderr — stdout is reserved for stdio JSON-RPC transport"

requirements-completed:
  - MCP-01
  - MCP-02
  - MCP-03
  - MCP-04
  - MCP-05

# Metrics
duration: 8min
completed: 2026-03-31
---

# Phase 4 Plan 1: MCP Server and Tool Registration Summary

**stdio MCP server with 4 tools (index_repo, search_codebase, build_context, doctor) backed by existing workflow layer, discoverable via .mcp.json**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-03-31T20:56:45Z
- **Completed:** 2026-03-31T20:59:50Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments

- MCP server at `src/mcp/index.ts` registers 4 tools using `@modelcontextprotocol/sdk` stdio transport
- All tool handlers return structured `isError:true` responses on guard failures — no `process.exit` in MCP context
- `doctor` tool directly calls services for a structured JSON health object (bypasses `runDoctor()` which prints to stderr/exits)
- Dual tsup config produces both `dist/cli.js` (with shebang) and `dist/mcp.js` (without shebang) without clobbering each other
- 15 unit tests covering guard failures and success paths for all 4 tools — full suite 204 tests passing

## Task Commits

1. **Task 1: Install MCP SDK, update tsup, create MCP server** - `52345c8` (feat)
2. **Task 2: Create comprehensive MCP tool handler tests** - `c6a4777` (test)

## Files Created/Modified

- `src/mcp/index.ts` - MCP server entry with index_repo, search_codebase, build_context, doctor tool registrations
- `tsup.config.ts` - Updated to dual-config array for separate CLI/MCP build entries
- `.mcp.json` - Claude Code project-scope MCP discovery config pointing to dist/mcp.js
- `package.json` - Added @modelcontextprotocol/sdk and @anthropic-ai/sdk dependencies
- `package-lock.json` - Updated lockfile
- `tests/mcp/server.test.ts` - 15 unit tests using mock capture pattern for MCP tool handlers

## Decisions Made

- MCP handlers guard via `readProfile` + `isOllamaRunning` before calling workflow functions — prevents the `process.exit(1)` guards inside workflows from terminating the MCP server process
- `doctor` bypasses `runDoctor()` which calls `process.exit` and outputs to stderr; instead calls `isOllamaInstalled`, `isOllamaRunning`, `getOllamaVersion`, `readIndexState`, and `detectCapabilities` directly
- tsup config split into two array entries: first entry sets `clean: true` with shebang banner for CLI, second sets `clean: false` without banner for MCP (clean:false prevents the second entry from deleting CLI output)
- `resolve(userPath)` called before `readIndexState` in `index_repo` handler to guarantee absolute path, matching `runIndex`'s internal resolution
- npm install used `--legacy-peer-deps` flag consistent with existing project constraint (tree-sitter-rust@0.24.0 peer dep conflict)

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

- npm install initially failed due to pre-existing tree-sitter-rust peer dependency conflict. Resolved with `--legacy-peer-deps` which is already the established pattern for this project (documented in STATE.md).

## User Setup Required

None - no external service configuration required. Claude Code will discover brain-cache MCP server via `.mcp.json` after `npm run build`.

## Next Phase Readiness

- MCP infrastructure complete; ready for Plan 04-02 (ask-codebase workflow using @anthropic-ai/sdk)
- @anthropic-ai/sdk already installed as a dependency
- All 4 MCP tools operational and tested

---
*Phase: 04-mcp-server-and-claude-integration*
*Completed: 2026-03-31*
