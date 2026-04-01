# Architecture

**Analysis Date:** 2026-04-01

## Pattern Overview

**Overall:** Workflows-first architecture with service layer

**Key Characteristics:**
- Workflows orchestrate multi-step operations by composing service calls
- Services are stateless, single-responsibility modules (no service depends on another service except `logger`)
- Two entry points: CLI (Commander) and MCP server (stdio transport) -- both invoke the same workflow functions
- All user-facing output goes to stderr; structured data goes to stdout (design rule D-16)
- Local GPU offloading via Ollama handles embeddings/retrieval; only the `ask` command calls the Claude API

## Layers

**CLI Layer:**
- Purpose: Parse commands, validate args, delegate to workflows
- Location: `src/cli/index.ts`
- Contains: Commander program definition with 7 subcommands
- Depends on: Workflows (via dynamic `import()`)
- Used by: End users via `brain-cache` binary

**MCP Layer:**
- Purpose: Expose brain-cache capabilities as MCP tools for Claude
- Location: `src/mcp/index.ts`
- Contains: 4 registered tools (`index_repo`, `search_codebase`, `build_context`, `doctor`)
- Depends on: Workflows (`runIndex`, `runSearch`, `runBuildContext`), Services (`readProfile`, `isOllamaRunning`, etc.)
- Used by: Claude via MCP stdio transport

**Workflow Layer:**
- Purpose: Orchestrate multi-step operations by composing service calls
- Location: `src/workflows/`
- Contains: 7 workflow functions (`runInit`, `runDoctor`, `runIndex`, `runSearch`, `runStatus`, `runBuildContext`, `runAskCodebase`)
- Depends on: Services, Lib
- Used by: CLI layer, MCP layer

**Service Layer:**
- Purpose: Single-responsibility modules for discrete capabilities
- Location: `src/services/`
- Contains: 8 service modules (capability, ollama, crawler, chunker, embedder, lancedb, retriever, tokenCounter, logger)
- Depends on: Lib (config, types), external SDKs (ollama, lancedb, anthropic, tree-sitter, pino)
- Used by: Workflows, MCP layer (for guard checks)

**Lib Layer:**
- Purpose: Shared types, constants, and configuration
- Location: `src/lib/`
- Contains: Zod schemas, TypeScript types, config constants
- Depends on: Nothing (leaf layer)
- Used by: Services, Workflows

## Data Flow

**Indexing Pipeline (`brain-cache index`):**

1. `src/workflows/index.ts` resolves target path
2. `src/services/capability.ts` reads hardware profile from `~/.brain-cache/profile.json`
3. `src/services/ollama.ts` verifies Ollama is running
4. `src/services/lancedb.ts` opens/creates LanceDB at `<project>/.brain-cache/index/`
5. `src/services/crawler.ts` crawls source files (respects `.gitignore`, filters by extension)
6. `src/services/chunker.ts` parses each file with tree-sitter, extracts function/class/method boundaries
7. `src/services/embedder.ts` sends text batches to Ollama for embedding (batches of 32)
8. `src/services/lancedb.ts` inserts chunk rows (text + vector) into LanceDB
9. `src/services/lancedb.ts` writes `index_state.json` metadata

**Search/Retrieval Pipeline (`brain-cache search`):**

1. `src/workflows/search.ts` reads profile + index state
2. `src/services/retriever.ts` classifies query intent (diagnostic vs knowledge) -- determines search strategy (looser thresholds for diagnostic)
3. `src/services/embedder.ts` embeds query text via Ollama
4. `src/services/retriever.ts` performs cosine-distance vector search on LanceDB, filters by distance threshold, deduplicates
5. Results returned as `RetrievedChunk[]`

**Context Assembly Pipeline (`brain-cache context`):**

1. Runs the full search pipeline (steps 1-5 above)
2. `src/services/tokenCounter.ts` assembles context with greedy token-budget fill
3. Estimates token savings by comparing assembled context size vs full source file sizes
4. Returns `ContextResult` with content string + metadata

**Ask Pipeline (`brain-cache ask`):**

1. Runs the full context assembly pipeline
2. `src/workflows/askCodebase.ts` sends ONLY the assembled context (not raw files) to Claude API
3. Claude reasons over the minimal context and returns an answer
4. Reports token reduction percentage

**State Management:**
- Global state: `~/.brain-cache/profile.json` -- hardware capabilities, embedding model choice
- Per-project state: `<project>/.brain-cache/index_state.json` -- index metadata (file count, chunk count, model, timestamp)
- Per-project data: `<project>/.brain-cache/index/` -- LanceDB database with `chunks` table
- No in-memory state between CLI invocations; all state is file-based

## Key Abstractions

**CapabilityProfile:**
- Purpose: Hardware detection result -- GPU vendor, VRAM tier, selected embedding model
- Defined in: `src/lib/types.ts` (Zod schema + TypeScript type)
- Created by: `src/services/capability.ts` `detectCapabilities()`
- Persisted to: `~/.brain-cache/profile.json`
- Pattern: Detect once via `brain-cache init`, read on every subsequent command

**CodeChunk:**
- Purpose: A discrete unit of code extracted from a source file (function, class, method, or whole-file fallback)
- Defined in: `src/lib/types.ts`
- Created by: `src/services/chunker.ts` `chunkFile()`
- Fields: id, filePath, chunkType, scope (parent class), name, content, startLine, endLine

**ChunkRow:**
- Purpose: LanceDB row format -- CodeChunk fields + embedding vector
- Defined in: `src/services/lancedb.ts`
- Uses snake_case field names to match Apache Arrow schema

**RetrievedChunk:**
- Purpose: Search result -- chunk data + similarity score
- Defined in: `src/lib/types.ts`
- Created by: `src/services/retriever.ts` `searchChunks()`

**ContextResult:**
- Purpose: Assembled context with token budget metadata
- Defined in: `src/lib/types.ts`
- Created by: `src/workflows/buildContext.ts`
- Contains: assembled content string, included chunks, reduction metrics

**IndexState:**
- Purpose: Metadata about a project's index (model, dimensions, counts, timestamp)
- Defined in: `src/lib/types.ts`
- Used for: detecting model mismatches (triggers table rebuild), status reporting

## Entry Points

**CLI Binary:**
- Location: `src/cli/index.ts` (built to `dist/cli.js`)
- Triggers: User runs `brain-cache <command>` from terminal
- Responsibilities: Parse args via Commander, dynamic-import the appropriate workflow, execute it
- Commands: `init`, `doctor`, `index`, `search`, `status`, `context`, `ask`

**MCP Server:**
- Location: `src/mcp/index.ts` (built to `dist/mcp.js`)
- Triggers: Claude connects via MCP stdio transport (configured in `.mcp.json`)
- Responsibilities: Register 4 tools, handle tool calls by delegating to workflows/services
- Tools: `index_repo`, `search_codebase`, `build_context`, `doctor`
- Key difference from CLI: MCP `doctor` tool builds a structured JSON health object directly from services rather than calling `runDoctor()` (which prints to stderr and calls `process.exit`)

## Error Handling

**Strategy:** Fail-fast with user-friendly stderr messages; `process.exit(1)` for unrecoverable errors

**Patterns:**
- Guard checks at workflow start: verify profile exists, Ollama is running, index exists
- MCP tools return `{ isError: true, content: [...] }` instead of `process.exit()` -- MCP server must stay alive
- Embedder has cold-start retry logic: one retry after 5s delay for `ECONNRESET`/`ECONNREFUSED` (Ollama model loading)
- Embed calls race against 120s timeout to prevent hangs
- Zod `safeParse` for profile and index state deserialization -- returns `null` on invalid data rather than throwing

## Cross-Cutting Concerns

**Logging:**
- Framework: pino (writes to stderr fd=2)
- Level controlled by `BRAIN_CACHE_LOG` env var (default: `warn`)
- Child loggers per component: `childLogger('capability')`, `childLogger('embedder')`, etc.
- Located in: `src/services/logger.ts`

**Validation:**
- Zod v4 schemas for all persisted data types (`CapabilityProfile`, `CodeChunk`, `IndexState`)
- `safeParse` used everywhere -- never throws on bad input, returns null

**Authentication:**
- Ollama: No auth (local server on `localhost:11434`)
- Claude API: `ANTHROPIC_API_KEY` env var, checked early in `askCodebase` workflow
- No other auth mechanisms

**Output Convention (D-16):**
- All human-readable output goes to `stderr` (progress, errors, status reports)
- Only structured data goes to `stdout` (JSON results from `context` command)
- MCP server uses stdio transport, so all logging must use stderr

## Dependency Graph

```
CLI (src/cli/index.ts)
  └─> Workflows (src/workflows/*.ts)
        ├─> Services (src/services/*.ts)
        │     ├─> capability.ts  ─> lib/types, lib/config, logger
        │     ├─> ollama.ts      ─> logger, ollama SDK
        │     ├─> crawler.ts     ─> logger, fast-glob, ignore
        │     ├─> chunker.ts     ─> logger, lib/types, tree-sitter (5 grammars)
        │     ├─> embedder.ts    ─> logger, lib/config, ollama SDK
        │     ├─> lancedb.ts     ─> logger, lib/types, lib/config, @lancedb/lancedb, apache-arrow
        │     ├─> retriever.ts   ─> logger, lib/types, lib/config, @lancedb/lancedb
        │     ├─> tokenCounter.ts ─> logger, lib/types, @anthropic-ai/tokenizer
        │     └─> logger.ts      ─> pino
        └─> Lib (src/lib/*.ts)
              ├─> config.ts  ─> (no deps)
              └─> types.ts   ─> zod

MCP Server (src/mcp/index.ts)
  ├─> Workflows (runIndex, runSearch, runBuildContext)
  ├─> Services (readProfile, isOllamaRunning, readIndexState, detectCapabilities, etc.)
  └─> @modelcontextprotocol/sdk, zod
```

## Local GPU Offloading vs Cloud

**Runs locally (via Ollama on GPU/CPU):**
- Embedding generation for both indexing and query-time
- All vector search and retrieval
- AST parsing and chunking (tree-sitter, no GPU needed)
- Token counting (Anthropic tokenizer library, local)
- Context assembly and budget enforcement

**Runs in the cloud (Anthropic API):**
- Only `brain-cache ask` command sends data to Claude
- Only the assembled, token-budgeted context is sent -- never raw files
- Model configurable via `BRAIN_CACHE_CLAUDE_MODEL` env var (default: `claude-sonnet-4-20250514`)

**Graceful GPU degradation:**
- VRAM tier `none`: uses `nomic-embed-text` (smaller model, CPU-compatible)
- VRAM tier `standard` (2-7 GiB): uses `nomic-embed-text`
- VRAM tier `large` (8+ GiB): uses `mxbai-embed-large` (higher quality, more VRAM)
- `brain-cache init` warns when no GPU is detected but continues with CPU

---

*Architecture analysis: 2026-04-01*
