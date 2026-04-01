# Phase 4: MCP Server and Claude Integration - Research

**Researched:** 2026-03-31
**Domain:** @modelcontextprotocol/sdk stdio transport, @anthropic-ai/sdk messages API, MCP tool schema patterns, Claude Code MCP discovery
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
All implementation choices are at Claude's discretion — discuss phase was skipped per user setting. Use ROADMAP phase goal, success criteria, and codebase conventions to guide decisions.

### Claude's Discretion
All implementation choices.

### Deferred Ideas (OUT OF SCOPE)
None — discuss phase skipped.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| MCP-01 | Braincache exposes an MCP server via stdio transport discoverable by Claude Code | McpServer + StdioServerTransport pattern; .mcp.json project-scope config |
| MCP-02 | `index_repo` tool accepts a path and indexes the codebase, returning status and file count | server.registerTool() wrapping runIndex(); return { content: [{ type: 'text', text: JSON.stringify(...) }] } |
| MCP-03 | `search_codebase` tool accepts a query string and returns top-N relevant chunks with scores | server.registerTool() wrapping runSearch(); same return pattern |
| MCP-04 | `build_context` tool accepts a query and optional token budget, returns assembled context with metadata | server.registerTool() wrapping runBuildContext(); same return pattern |
| MCP-05 | `doctor` tool returns system health: Ollama status, index freshness, model loaded, VRAM available | New runDoctorMcp() returning structured object; existing runDoctor() is CLI-print only |
| CLD-01 | `ask-codebase` workflow accepts a question, retrieves context locally, sends minimal context to Claude, returns reasoning answer | runBuildContext() → Anthropic.messages.create(); new workflow file |
| CLD-02 | Claude receives only the assembled context (not raw chunks), preserving token efficiency | Use ContextResult.content (assembled text), not ContextResult.chunks |
</phase_requirements>

## Summary

Phase 4 wires the completed retrieval pipeline (Phases 1-3) into two consumer surfaces: an MCP server that Claude Code can call natively via stdio, and an `ask-codebase` workflow that sends assembled context to Claude via the Anthropic SDK.

The MCP surface requires a new entry point (`src/mcp/index.ts`) that creates an `McpServer`, registers four tools wrapping existing workflows, and connects to `StdioServerTransport`. Tools must return `{ content: [{ type: 'text', text: '...' }] }` — Zod validation happens via the `inputSchema` object passed to `server.registerTool()`. Errors should be caught in tool handlers and returned as `{ isError: true, content: [...] }` rather than thrown exceptions.

The Claude integration requires a new `runAskCodebase` workflow in `src/workflows/askCodebase.ts` that calls `runBuildContext()` to get assembled context and then calls `anthropic.messages.create()` with only `ContextResult.content` in the user message. The `@anthropic-ai/sdk` package is not yet installed; it must be added.

**Primary recommendation:** Add `src/mcp/index.ts` as a new tsup entry point alongside `src/cli/index.ts`. Register four MCP tools wrapping existing workflows. Add `src/workflows/askCodebase.ts` calling Anthropic SDK. Update `.mcp.json` for project-scope Claude Code discovery.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@modelcontextprotocol/sdk` | 1.29.0 | MCP server + stdio transport | Official SDK; `McpServer` + `StdioServerTransport` is the canonical pattern per MCP docs |
| `@anthropic-ai/sdk` | 0.81.0 | Claude API client | Official SDK; messages.create() is the only correct interface |
| `zod` | 4.3.6 (already installed) | Tool input schema validation | Already in project; MCP SDK's `registerTool` accepts zod schemas as `inputSchema` plain object |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `pino` (already installed) | ^9.0.0 | Stderr logging in MCP server | MCP server cannot write to stdout; all logging must go to stderr via pino |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `McpServer.registerTool()` | Low-level `Server` class | Low-level `Server` requires manually implementing `ListToolsRequestSchema` and `CallToolRequestSchema` handlers; `McpServer` handles all of that automatically |
| Separate MCP entry point | Combining MCP + CLI in one process | Combining breaks stdio transport: CLI commands write progress to stderr correctly, but the process structure is cleaner and safer to keep them separate |

**Installation:**
```bash
npm install @modelcontextprotocol/sdk @anthropic-ai/sdk
```

**Version verification:** Confirmed against npm registry 2026-03-31:
- `@modelcontextprotocol/sdk` — 1.29.0 (current)
- `@anthropic-ai/sdk` — 0.81.0 (current; CLAUDE.md lists 0.80.0 as reference, 0.81.0 is current)

---

## Architecture Patterns

### Recommended Project Structure (additions only)
```
src/
├── mcp/
│   └── index.ts         # MCP server entry point: McpServer + tool registrations
├── workflows/
│   ├── askCodebase.ts   # NEW: runAskCodebase() — retrieve + send to Claude
│   └── (existing files unchanged)
```

**tsup entry update** — add `mcp: 'src/mcp/index.ts'` to the entry object in `tsup.config.ts`:
```typescript
entry: { cli: 'src/cli/index.ts', mcp: 'src/mcp/index.ts' }
```
This produces `dist/mcp.js` alongside `dist/cli.js`.

**.mcp.json** (project root, checked into git) — project-scope Claude Code discovery:
```json
{
  "mcpServers": {
    "brain-cache": {
      "command": "node",
      "args": ["./dist/mcp.js"]
    }
  }
}
```

### Pattern 1: McpServer with StdioServerTransport
**What:** Create server, register tools, connect transport — all in a single async main()
**When to use:** Every stdio MCP server
**Example:**
```typescript
// Source: modelcontextprotocol.io/quickstart/server (TypeScript tab)
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "brain-cache", version: "0.1.0" });

server.registerTool(
  "tool_name",
  {
    description: "What this tool does",
    inputSchema: {
      path: z.string().describe("Absolute path to index"),
    },
  },
  async ({ path }) => {
    // handler logic
    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
    };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Do NOT write to stdout — use process.stderr or pino(destination(2))
}

main().catch((error) => {
  process.stderr.write(`Fatal: ${error}\n`);
  process.exit(1);
});
```

### Pattern 2: Tool Error Handling — isError, not throw
**What:** Return `{ isError: true, content: [...] }` so MCP clients receive actionable errors rather than unhandled exceptions that kill the server process.
**When to use:** Any failure in a tool handler (profile missing, Ollama down, index not found, etc.)
**Example:**
```typescript
// Source: @modelcontextprotocol/sdk docs, confirmed with server.md
async ({ path }) => {
  try {
    const result = await runIndex(path);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  } catch (err) {
    return {
      isError: true,
      content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
    };
  }
}
```

**Critical:** Existing workflows call `process.exit(1)` on fatal errors (no profile, Ollama not running). The MCP tool handlers CANNOT let `process.exit()` be called — it would kill the MCP server process. Tool handlers must catch these conditions and return `isError` responses instead.

This means the MCP tool handlers cannot simply call `runIndex()` / `runSearch()` / `runBuildContext()` directly. Two options:
1. Wrap the workflow calls in try/catch and intercept the thrown mock from process.exit (workflows call process.exit, not throw)
2. Extract the workflow core logic into helper functions that return errors instead of exiting, used by both CLI and MCP

**Recommendation:** The MCP handlers should call the workflow functions but mock/intercept process.exit at the handler boundary. Since process.exit actually exits the process (not throws), the correct approach is to check preconditions before calling the workflow. The MCP handlers should perform the same guard checks (readProfile, isOllamaRunning) themselves and return `isError` if guards fail, then call the shared core logic. This requires refactoring the precondition checks out of the workflow bodies, or duplicating the guard logic in MCP handlers. Given project complexity constraints, duplicating the guard checks in MCP tool handlers is simpler.

### Pattern 3: Zod Input Validation with registerTool
**What:** The `inputSchema` in `registerTool` is a plain object where each key maps to a Zod schema (not a `z.object()`). The SDK validates and parses the input before calling the handler.
**When to use:** All tool registrations.
**Example:**
```typescript
// Source: modelcontextprotocol.io/quickstart/server TypeScript example
server.registerTool(
  "search_codebase",
  {
    description: "Search indexed codebase with a natural language query",
    inputSchema: {
      query: z.string().describe("Natural language query string"),
      limit: z.number().int().min(1).max(50).optional().describe("Max results (default 10)"),
      path: z.string().optional().describe("Project root directory"),
    },
  },
  async ({ query, limit, path }) => { /* validated args */ }
);
```
Invalid inputs are rejected before the handler runs — Zod errors surface as MCP protocol-level errors automatically.

### Pattern 4: runAskCodebase Workflow
**What:** Retrieve assembled context locally via `runBuildContext()`, then send only the `content` string to Claude.
**When to use:** CLD-01/CLD-02 implementation.
**Example:**
```typescript
// Source: platform.claude.com/docs/en/api/messages + project patterns
import Anthropic from "@anthropic-ai/sdk";
import { runBuildContext } from "./buildContext.js";

export async function runAskCodebase(question: string, opts?: { path?: string; maxTokens?: number }): Promise<string> {
  // 1. Build context locally (no Claude call here)
  const contextResult = await runBuildContext(question, opts);

  // 2. Send only assembled context to Claude — not raw chunks (CLD-02)
  const client = new Anthropic(); // reads ANTHROPIC_API_KEY from env
  const response = await client.messages.create({
    model: "claude-opus-4-5",
    max_tokens: 2048,
    messages: [
      {
        role: "user",
        content: `${contextResult.content}\n\nQuestion: ${question}`,
      },
    ],
  });

  // 3. Extract text response
  const textBlock = response.content.find((b) => b.type === "text");
  return textBlock?.text ?? "";
}
```

### Pattern 5: doctor Tool — Structured Return, Not Print
**What:** The existing `runDoctor()` only writes to stderr (CLI display). MCP's `doctor` tool needs a structured health object returned as JSON.
**When to use:** MCP-05 implementation.

The `doctor` MCP tool must call the capability/Ollama services directly (not `runDoctor()`), because `runDoctor()` calls `process.exit(1)` if no profile is found and only writes human-readable text to stderr.

Structured return shape for MCP `doctor`:
```typescript
interface DoctorResult {
  ollamaStatus: 'running' | 'not_running' | 'not_installed';
  ollamaVersion: string | null;
  indexFreshness: {
    indexed: boolean;
    indexedAt: string | null;
    fileCount: number | null;
    chunkCount: number | null;
  };
  modelLoaded: boolean;       // true if embeddingModel is in ollama list
  vramAvailable: number | null; // GiB
  embeddingModel: string | null;
  vramTier: string | null;
}
```

### Anti-Patterns to Avoid
- **Writing to stdout in MCP server:** Any `process.stdout.write()` or `console.log()` in the MCP server corrupts the JSON-RPC transport silently. All output must go to stderr (already enforced by pino + `destination(2)`).
- **Calling process.exit() in tool handlers:** Kills the entire MCP server process. Guards must surface as `isError` returns.
- **Passing raw chunks to Claude:** CLD-02 explicitly requires only `ContextResult.content` (the assembled text string) reaches Claude — not `ContextResult.chunks`.
- **Using the shebang banner on the MCP entry point:** tsup adds `#!/usr/bin/env node` via `banner.js` — this is correct for `dist/cli.js`. The MCP entry should also have a shebang so it can be run directly via `node dist/mcp.js` or `./dist/mcp.js`. Keep the existing tsup banner config — it applies to all entries.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JSON-RPC 2.0 wire protocol | Custom stdio message framing | `@modelcontextprotocol/sdk` StdioServerTransport | Protocol has edge cases: partial reads, framing, concurrent requests, capability negotiation |
| Tool input validation | Manual typeof checks | Zod schemas in `registerTool` inputSchema | Zod validates before handler runs; errors auto-propagate as MCP errors |
| MCP capability negotiation | Custom handshake | `McpServer.connect()` | SDK handles initialize/initialized exchange automatically |
| Token extraction from response | Response parsing | `response.content.find(b => b.type === 'text')?.text` | Anthropic SDK returns typed content blocks; type guard is trivial |

**Key insight:** The MCP SDK handles all protocol plumbing. The project's job is registering tools and returning `{ content: [...] }` objects.

---

## Common Pitfalls

### Pitfall 1: process.exit() Kills MCP Server
**What goes wrong:** `runIndex()`, `runSearch()`, `runBuildContext()` all call `process.exit(1)` on guard failures (no profile, Ollama not running, no index). In a CLI context this is correct. In MCP tool handlers, it terminates the entire server process — Claude Code loses the connection permanently.
**Why it happens:** Workflows are designed as terminal CLI handlers. The MCP layer is a different consumer.
**How to avoid:** MCP tool handlers must check preconditions (profile exists, Ollama running, index exists) themselves before calling workflows, returning `isError` responses if guards fail. Do not let workflow `process.exit()` calls execute inside tool handlers.
**Warning signs:** Claude Code shows "MCP server disconnected" immediately after invoking a tool when Ollama is down.

### Pitfall 2: stdout Corruption Breaks All Tools
**What goes wrong:** Any `console.log()`, `process.stdout.write()`, or accidental import of a module that logs to stdout corrupts the JSON-RPC framing. All tool calls start failing with parse errors.
**Why it happens:** MCP stdio uses stdout as the transport channel — any extra bytes break message framing.
**How to avoid:** Audit every import in `src/mcp/index.ts` for stdout writes. The existing pino logger is safe (writes to fd 2). Double-check that workflow progress messages use `process.stderr.write()` not `process.stdout.write()`.
**Warning signs:** Tools fail immediately with "Unexpected token" or "Invalid JSON" errors in Claude Code's MCP inspector.

### Pitfall 3: Missing ANTHROPIC_API_KEY at Runtime
**What goes wrong:** `runAskCodebase()` creates an `Anthropic()` client which reads `ANTHROPIC_API_KEY` from env. If the key is not set when the MCP server or CLI command is invoked, the SDK throws immediately.
**Why it happens:** Users may not set the env var in the shell where Claude Code is running.
**How to avoid:** The `ask-codebase` workflow should check for `ANTHROPIC_API_KEY` early and surface a clear error message (via stderr + `isError` in MCP context) rather than letting the SDK throw an opaque error.
**Warning signs:** `AuthenticationError: 401 Unauthorized` from the Anthropic SDK.

### Pitfall 4: Model Name Drift
**What goes wrong:** Hardcoding a Claude model name (e.g., `"claude-opus-4-5"`) that gets deprecated causes `ask-codebase` to fail silently or with an opaque 404.
**Why it happens:** Anthropic deprecates model names on a rolling basis.
**How to avoid:** Make the model name configurable via env var `BRAIN_CACHE_CLAUDE_MODEL` with a sensible default. Document the fallback in `runAskCodebase`.

### Pitfall 5: inputSchema Zod v4 Compatibility
**What goes wrong:** MCP SDK 1.29 states it has been updated to work with Zod v4 (imported from `zod/v4` internally). However, the `inputSchema` field in `registerTool` accepts a plain object of Zod schemas, not a `z.object()`. If you accidentally pass `z.object({ ... })` instead of `{ ... }`, behavior may be unexpected.
**Why it happens:** The API shape changed between MCP SDK versions. The current pattern is a plain key-schema object.
**How to avoid:** Use the plain object pattern: `inputSchema: { query: z.string() }` not `inputSchema: z.object({ query: z.string() })`.

---

## Code Examples

### MCP Server Entry Point Shell
```typescript
// src/mcp/index.ts
// Source: modelcontextprotocol.io/quickstart/server TypeScript tab
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { childLogger } from "../services/logger.js";

const log = childLogger("mcp");

const server = new McpServer({
  name: "brain-cache",
  version: "0.1.0",
});

// Tool registrations go here...

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log.info("brain-cache MCP server running on stdio");
}

main().catch((error) => {
  process.stderr.write(`Fatal: ${String(error)}\n`);
  process.exit(1);
});
```

### Tool Registration with Guard Checks
```typescript
// Pattern for tools that wrap workflows with process.exit guards
server.registerTool(
  "index_repo",
  {
    description: "Index a codebase: parse, chunk, embed, and store in LanceDB",
    inputSchema: {
      path: z.string().describe("Absolute or relative path to the directory to index"),
    },
  },
  async ({ path }) => {
    // Guard: check profile
    const profile = await readProfile();
    if (!profile) {
      return {
        isError: true,
        content: [{ type: "text", text: "No profile found. Run 'brain-cache init' first." }],
      };
    }
    // Guard: check Ollama
    const running = await isOllamaRunning();
    if (!running) {
      return {
        isError: true,
        content: [{ type: "text", text: "Ollama is not running. Start it with 'ollama serve'." }],
      };
    }
    try {
      await runIndex(path);
      return {
        content: [{ type: "text", text: JSON.stringify({ status: "ok", path }) }],
      };
    } catch (err) {
      return {
        isError: true,
        content: [{ type: "text", text: `Indexing failed: ${err instanceof Error ? err.message : String(err)}` }],
      };
    }
  }
);
```

### Anthropic Messages Call (ask-codebase)
```typescript
// Source: platform.claude.com/docs/en/api/messages
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic(); // ANTHROPIC_API_KEY from env

const response = await client.messages.create({
  model: process.env.BRAIN_CACHE_CLAUDE_MODEL ?? "claude-opus-4-5",
  max_tokens: 2048,
  messages: [
    {
      role: "user",
      content: `${contextResult.content}\n\nQuestion: ${question}`,
    },
  ],
});

const textBlock = response.content.find((b) => b.type === "text");
const answer = textBlock?.text ?? "(no text response)";
```

### Claude Code .mcp.json Registration
```json
{
  "mcpServers": {
    "brain-cache": {
      "command": "node",
      "args": ["./dist/mcp.js"]
    }
  }
}
```
Place at project root; commit to git for project-scope sharing. Claude Code prompts for approval on first use of project-scoped servers.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Low-level `Server` class with manual request handlers | `McpServer` high-level class with `registerTool()` | MCP SDK ~1.5 | Eliminates `ListToolsRequestSchema` and `CallToolRequestSchema` boilerplate |
| SSE transport | Stdio for local, HTTP for remote | MCP SDK 1.x | SSE is deprecated; stdio is the standard for local CLI tools |
| `z.object()` as inputSchema | Plain key-value object of Zod schemas | MCP SDK current | `registerTool` accepts the shape object directly, not a Zod object schema |
| `@anthropic-ai/sdk` 0.80.x | 0.81.0 | March 2026 | Minor release; no breaking changes expected |

**Deprecated/outdated:**
- SSE transport (`StdioServerTransport` is the correct choice for local processes)
- `server.setRequestHandler()` low-level API (replaced by `server.registerTool()`, `server.registerResource()`, etc.)

---

## Open Questions

1. **runIndex() return value for MCP-02**
   - What we know: `runIndex()` currently returns `Promise<void>` and writes progress to stderr.
   - What's unclear: MCP-02 requires `index_repo` to return "status and file count". The file/chunk counts are written to stderr but not returned.
   - Recommendation: `runIndex()` should be updated to return `{ fileCount: number; chunkCount: number }` (or the MCP tool handler should read the index state from disk after `runIndex()` completes to get these values). The cleaner approach is updating `runIndex()` to return the counts.

2. **doctor tool VRAM vs "model loaded" semantics**
   - What we know: MCP-05 requires "model loaded state". Ollama doesn't have a discrete "loaded" API — a model is loaded when it's been used recently.
   - What's unclear: The best proxy for "model loaded" is checking whether the embedding model appears in `ollama.list()`.
   - Recommendation: Use `ollama.list()` to check if the embedding model is present locally. "Loaded" in this context means "available/pulled", not "currently in VRAM". Document this distinction in the tool description.

3. **ask-codebase in MCP vs CLI only**
   - What we know: CLD-01 says the workflow should exist. Phase 4 success criteria (#4) says the workflow sends context to Claude.
   - What's unclear: Should `ask-codebase` be exposed as an MCP tool or only as a CLI command?
   - Recommendation: Implement as a CLI command first (`brain-cache ask <question>`), not as an MCP tool. Claude Code uses `build_context` to get context and does its own reasoning — a nested Claude call from within MCP is unusual and adds ANTHROPIC_API_KEY complexity to the MCP server. Expose `ask-codebase` CLI only in Phase 4.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | MCP server runtime | Yes | v20.20.2 | — |
| npm | Package install | Yes | 10.8.2 | — |
| `@modelcontextprotocol/sdk` | MCP-01 through MCP-05 | Not installed | 1.29.0 (npm) | — (must install) |
| `@anthropic-ai/sdk` | CLD-01, CLD-02 | Not installed | 0.81.0 (npm) | — (must install) |
| Ollama | Runtime (tests mock it) | Not found | — | Tests use vi.mock; no runtime fallback |
| ANTHROPIC_API_KEY | CLD-01 ask-codebase | Not set | — | Workflow returns error; unit tests mock SDK |

**Missing dependencies with no fallback:**
- `@modelcontextprotocol/sdk` — must be installed before any MCP work
- `@anthropic-ai/sdk` — must be installed before ask-codebase work

**Missing dependencies with fallback (test-time):**
- Ollama — all tests mock `isOllamaRunning` and `embedBatchWithRetry`
- ANTHROPIC_API_KEY — `ask-codebase` tests mock `@anthropic-ai/sdk`

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 2.x |
| Config file | `vitest.config.ts` (exists at project root) |
| Quick run command | `npm test -- --run tests/mcp` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| MCP-01 | StdioServerTransport connects without error | unit | `npm test -- --run tests/mcp/server.test.ts` | No — Wave 0 |
| MCP-02 | `index_repo` tool returns JSON with status/fileCount | unit | `npm test -- --run tests/mcp/tools.test.ts` | No — Wave 0 |
| MCP-03 | `search_codebase` tool returns chunks array with scores | unit | `npm test -- --run tests/mcp/tools.test.ts` | No — Wave 0 |
| MCP-04 | `build_context` tool returns ContextResult metadata | unit | `npm test -- --run tests/mcp/tools.test.ts` | No — Wave 0 |
| MCP-05 | `doctor` tool returns structured health object | unit | `npm test -- --run tests/mcp/tools.test.ts` | No — Wave 0 |
| CLD-01 | `runAskCodebase` calls Anthropic SDK with assembled context | unit | `npm test -- --run tests/workflows/askCodebase.test.ts` | No — Wave 0 |
| CLD-02 | Anthropic receives `content` string, not raw `chunks` array | unit | `npm test -- --run tests/workflows/askCodebase.test.ts` | No — Wave 0 |

### Sampling Rate
- **Per task commit:** `npm test -- --run tests/mcp tests/workflows/askCodebase.test.ts`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/mcp/server.test.ts` — MCP server init, tool registration, transport connect
- [ ] `tests/mcp/tools.test.ts` — all four tool handlers with mocked workflow dependencies
- [ ] `tests/workflows/askCodebase.test.ts` — runAskCodebase with mocked Anthropic SDK and buildContext

*(Existing test infrastructure: vitest.config.ts, vi.mock pattern for services — no framework changes needed. New test files only.)*

---

## Project Constraints (from CLAUDE.md)

The following CLAUDE.md directives apply to this phase:

| Directive | Impact on Phase 4 |
|-----------|-------------------|
| stderr-only logging | MCP server must not write to stdout. pino with `destination(2)` is already the pattern. |
| `zod` v4 (not v3) | `inputSchema` in `registerTool` must use `zod` v4 schemas (already installed as `^4.3.6`) |
| No LangChain/LlamaIndex | Not applicable — Anthropic SDK is the only LLM client |
| No Postgres/Redis | Not applicable |
| `@anthropic-ai/sdk` for Claude | Use official SDK; no hand-rolled fetch to Anthropic API |
| `@modelcontextprotocol/sdk` 1.29.0 | Use this version; do not use older Server class patterns |
| No over-abstraction | Tool handlers are thin adapters over existing workflows — no new service layers |
| Business logic in workflows, not CLI | Same applies to MCP: tool handlers call workflows, not service functions directly |
| `tsup` for build | Add MCP entry to existing tsup config — do not add a separate build script |
| Dynamic import() for lazy loading | Not applicable to MCP server (MCP entry loads all tools at startup, not lazily) |

---

## Sources

### Primary (HIGH confidence)
- [modelcontextprotocol.io/quickstart/server](https://modelcontextprotocol.io/quickstart/server) — Full TypeScript MCP server example with `McpServer`, `StdioServerTransport`, `registerTool`, and content return format
- [code.claude.com/docs/en/mcp](https://code.claude.com/docs/en/mcp) — Claude Code MCP configuration: `.mcp.json` project scope, `claude mcp add` CLI, scope semantics
- [platform.claude.com/docs/en/api/messages](https://platform.claude.com/docs/en/api/messages) — Anthropic messages.create() TypeScript example, response.content structure

### Secondary (MEDIUM confidence)
- npm registry (@modelcontextprotocol/sdk 1.29.0, @anthropic-ai/sdk 0.81.0) — current versions verified 2026-03-31
- modelcontextprotocol/typescript-sdk docs/server.md — `server.registerTool()` API shape with `inputSchema` plain object, `isError` return pattern

### Tertiary (LOW confidence)
- WebSearch results for MCP SDK 1.29 zod schema patterns — corroborated by official docs above; no standalone trust

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — versions verified against npm registry; MCP SDK and Anthropic SDK are the only correct choices per CLAUDE.md
- Architecture: HIGH — MCP server pattern verified against official quickstart docs; .mcp.json format verified against Claude Code docs
- Pitfalls: HIGH — process.exit() pitfall is directly observable in existing workflow code; stdout corruption is documented in MCP official docs

**Research date:** 2026-03-31
**Valid until:** 2026-04-28 (30 days — MCP SDK is stable; Anthropic SDK minor versions may shift)
