# Architecture

**Analysis Date:** 2026-04-01

## Pattern Overview

**Overall:** Workflows-first layered architecture with strict dependency direction

**Key Characteristics:**
- Three layers: **Workflows** (orchestration) -> **Services** (business logic) -> **Lib** (types/config)
- Two entry points: CLI (Commander) and MCP server (stdio transport) -- both delegate to the same workflow functions
- All heavy computation (embedding, chunking, retrieval) runs locally via Ollama; only the `ask` workflow calls Claude's API
- Barrel re-exports at each layer boundary (`src/services/index.ts`, `src/lib/index.ts`)
- Zero stdout for CLI operations (all user output goes to stderr per D-16 convention); stdout reserved for machine-parseable output (`--raw` flag, MCP transport)

## Layers

**CLI Layer:**
- Purpose: Parse user commands, delegate to workflows, format output
- Location: `src/cli/index.ts`
- Contains: Commander program with 7 subcommands (`init`, `doctor`, `index`, `search`, `status`, `context`, `ask`)
- Depends on: Workflows (via dynamic `import()`)
- Used by: End users via `brain-cache` binary

**MCP Layer:**
- Purpose: Expose brain-cache capabilities as MCP tools for Claude Code integration
- Location: `src/mcp/index.ts`
- Contains: McpServer with 4 registered tools (`index_repo`, `search_codebase`, `build_context`, `doctor`)
- Depends on: Workflows (`runIndex`, `runSearch`, `runBuildContext`), Services (`capability`, `ollama`, `lancedb`), Lib (`logger`)
- Used by: Claude Code via stdio MCP transport (configured in `.mcp.json`)
- Note: MCP tools include pre-flight guards (profile exists, Ollama running) before delegating to workflows

**Workflows Layer:**
- Purpose: Orchestrate multi-step operations by composing services
- Location: `src/workflows/`
- Contains: 7 workflow modules (`init.ts`, `doctor.ts`, `index.ts`, `search.ts`, `status.ts`, `buildContext.ts`, `askCodebase.ts`)
- Depends on: Services, Lib
- Used by: CLI, MCP

**Services Layer:**
- Purpose: Single-responsibility modules providing core capabilities
- Location: `src/services/`
- Contains: 10 service modules (see Key Abstractions below)
- Depends on: Lib (types/config), external packages (ollama, lancedb, tree-sitter, pino, anthropic tokenizer)
- Used by: Workflows, MCP (for direct guards)

**Lib Layer:**
- Purpose: Shared types, schemas, and configuration constants
- Location: `src/lib/`
- Contains: Zod schemas, TypeScript types, config constants
- Depends on: Nothing (leaf layer)
- Used by: Services, Workflows

**Types Layer:**
- Purpose: Global ambient type declarations
- Location: `src/types/globals.d.ts`
- Contains: `__BRAIN_CACHE_VERSION__` build-time constant declaration
- Used by: CLI and MCP entry points

## Data Flow

**Indexing Pipeline (`brain-cache index`):**

1. `runIndex()` in `src/workflows/index.ts` resolves target path
2. Reads capability profile from `~/.brain-cache/profile.json` via `src/services/capability.ts`
3. Verifies Ollama is running via `src/services/ollama.ts`
4. Opens LanceDB at `<project>/.brain-cache/index/` via `src/services/lancedb.ts`
5. Crawls source files (respecting `.gitignore` + hardcoded exclusions) via `src/services/crawler.ts`
6. Reads files in batches of 20 (`FILE_READ_CONCURRENCY`), computes SHA-256 hashes
7. Diffs current hashes against stored manifest (`file-hashes.json`) for incremental indexing
8. Deletes stale chunks from LanceDB for removed/changed files
9. Parses new/changed files into AST chunks (function/class/method boundaries) via `src/services/chunker.ts` (tree-sitter)
10. Filters oversized chunks (>1400 Anthropic tokens, ~2000 BERT tokens) to prevent Ollama context-length errors
11. Embeds chunks in batches of 32 (`DEFAULT_BATCH_SIZE`) via `src/services/embedder.ts` (Ollama embed API with `truncate: true`)
12. Inserts chunk rows (metadata + vector) into LanceDB
13. Creates IVF-PQ vector index if table exceeds 10,000 rows (`VECTOR_INDEX_THRESHOLD`)
14. Writes updated hash manifest and index state to `<project>/.brain-cache/`

**Search/Context Pipeline (`brain-cache context`):**

1. `runBuildContext()` in `src/workflows/buildContext.ts` reads profile and index state
2. Classifies query intent as `diagnostic` or `knowledge` via `src/services/retriever.ts`
3. Embeds the query string using the same model that indexed the codebase (reads model name from `index_state.json`, not profile, to prevent mismatch)
4. Performs cosine-distance vector search on LanceDB chunks table
5. Filters results by distance threshold (0.4 for both intents currently; diagnostic uses wider limit of 20 results vs 10)
6. Deduplicates chunks by ID
7. Assembles context with greedy token-budget fill via `src/services/tokenCounter.ts`
8. Computes token reduction stats (assembled tokens vs. full source file token count)
9. Returns `ContextResult` with content string, chunk metadata, and savings metrics

**Ask Pipeline (`brain-cache ask`):**

1. `runAskCodebase()` in `src/workflows/askCodebase.ts` checks `ANTHROPIC_API_KEY`
2. Calls `runBuildContext()` to build local context (all local GPU work happens here)
3. Sends ONLY the assembled context + question to Claude API via `@anthropic-ai/sdk` (never raw files)
4. Uses system prompt that instructs Claude to stay grounded in provided context
5. Returns answer text with context metadata and token usage

**State Management:**
- **Global config:** `~/.brain-cache/profile.json` -- hardware capability profile (VRAM tier, GPU vendor, embedding model)
- **Per-project index:** `<project>/.brain-cache/index/` -- LanceDB database with `chunks` table (Arrow/Lance format)
- **Per-project metadata:** `<project>/.brain-cache/index_state.json` -- index stats (file count, chunk count, model, dimension, timestamp)
- **Per-project hashes:** `<project>/.brain-cache/file-hashes.json` -- SHA-256 manifest for incremental indexing
- No in-memory caches or singletons; all state is disk-persisted and re-read on each invocation

## Key Abstractions

**CapabilityProfile (Zod schema):**
- Purpose: Represents detected hardware capabilities and selected embedding model
- Defined in: `src/lib/types.ts`
- Persisted to: `~/.brain-cache/profile.json`
- Created by: `src/services/capability.ts` `detectCapabilities()`
- Fields: `version` (literal 1), `detectedAt`, `vramTier` (none/standard/large), `vramGiB`, `gpuVendor` (nvidia/apple/none), `embeddingModel`, `ollamaVersion`, `platform`

**CodeChunk (Zod schema):**
- Purpose: A parsed unit of source code at AST boundaries
- Defined in: `src/lib/types.ts`
- Created by: `src/services/chunker.ts` `chunkFile()`
- Fields: `id` (filePath:startLine), `filePath`, `chunkType` (function/class/method/file), `scope` (parent class name or null), `name`, `content`, `startLine`, `endLine`

**ChunkRow (interface):**
- Purpose: LanceDB storage format for embedded chunks
- Defined in: `src/services/lancedb.ts`
- Fields: snake_case versions of CodeChunk fields + `vector: number[]`
- Arrow schema: Utf8, Int32, FixedSizeList<Float32> columns

**RetrievedChunk (interface):**
- Purpose: Search result with similarity score
- Defined in: `src/lib/types.ts`
- Created by: `src/services/retriever.ts` `searchChunks()`
- Fields: camelCase CodeChunk fields + `similarity: number` (1 - cosine distance, higher is better)

**ContextResult (interface):**
- Purpose: Final output of the context assembly pipeline
- Defined in: `src/lib/types.ts`
- Created by: `src/workflows/buildContext.ts`
- Fields: `content` (assembled text with file headers), `chunks` (RetrievedChunk[]), `metadata` (ContextMetadata)

**ContextMetadata (interface):**
- Purpose: Token savings and task tracking
- Defined in: `src/lib/types.ts`
- Fields: `tokensSent`, `estimatedWithoutBraincache`, `reductionPct`, `localTasksPerformed`, `cloudCallsMade`

**IndexState (Zod schema):**
- Purpose: Tracks index freshness and configuration; used to detect model/dimension mismatches
- Defined in: `src/lib/types.ts`
- Persisted to: `<project>/.brain-cache/index_state.json`
- Fields: `version`, `embeddingModel`, `dimension`, `indexedAt`, `fileCount`, `chunkCount`

**QueryIntent (type):**
- Purpose: Classifies search queries as `diagnostic` (debugging/error-related) or `knowledge` (general understanding)
- Defined in: `src/lib/types.ts`
- Used by: `src/services/retriever.ts` to select search strategy (wider limit + looser threshold for diagnostic)

## Entry Points

**CLI Binary (`src/cli/index.ts` -> `dist/cli.js`):**
- Location: `src/cli/index.ts`
- Triggers: User runs `brain-cache <command>` from terminal
- Responsibilities: Parse CLI arguments via Commander, dynamic-import the appropriate workflow, execute it, format output
- Build: `dist/cli.js` with `#!/usr/bin/env node` shebang, ESM format, code-split
- Commands: `init`, `doctor`, `index [path]`, `search <query>`, `status [path]`, `context <query>`, `ask <question>`

**MCP Server (`src/mcp/index.ts` -> `dist/mcp.js`):**
- Location: `src/mcp/index.ts`
- Triggers: Claude Code starts the MCP server via `.mcp.json` config (`node ./dist/mcp.js`)
- Responsibilities: Register 4 MCP tools with Zod input schemas, connect stdio transport, validate preconditions, delegate to workflows, return JSON
- Build: `dist/mcp.js`, ESM format
- Tools: `index_repo`, `search_codebase`, `build_context`, `doctor`
- Key difference from CLI: MCP `doctor` builds structured JSON directly from services (CLI `doctor` calls `runDoctor()` which prints formatted text to stderr)

## Error Handling

**Strategy:** Throw-and-catch at workflow/entry-point boundaries with user-friendly messages

**Patterns:**
- Guard checks at workflow start: verify profile exists, Ollama is running, index exists -- throw descriptive errors early
- CLI catches errors at top-level `parseAsync().catch()`, writes message to stderr, exits with code 1
- MCP tools wrap workflow calls in try/catch, return `{ isError: true, content: [{ type: 'text', text: message }] }` -- MCP server stays alive
- Embedder cold-start retry: single retry after 5s delay for `ECONNRESET`/`ECONNREFUSED`/`fetch failed`/`socket hang up`
- Embedder context-length fallback: batch failure -> try each text individually -> zero-vector for still-oversized chunks
- Embed calls race against 120s timeout (`EMBED_TIMEOUT_MS`) to prevent indefinite hangs
- Zod `safeParse()` for all disk reads (profile, index state) -- returns null on invalid data, never throws

## Cross-Cutting Concerns

**Logging:**
- Framework: pino (`src/services/logger.ts`)
- Output: Always stderr (fd 2), never stdout
- Level: Controlled by `BRAIN_CACHE_LOG` env var (default: `warn`; valid: `debug`, `info`, `warn`, `error`, `silent`)
- Child loggers per component: `childLogger('capability')`, `childLogger('embedder')`, etc.
- Secret redaction: Configured for `apiKey`, `api_key`, `secret`, `password`, `token`, `authorization`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` and nested variants

**Validation:**
- Zod v4 schemas for all persisted data: `CapabilityProfileSchema`, `CodeChunkSchema`, `IndexStateSchema`
- Zod schemas for MCP tool inputs (inline in `src/mcp/index.ts`)
- `safeParse()` everywhere for disk reads -- returns null on failure, never throws

**Authentication:**
- Ollama: No auth required (local service)
- Claude API: `ANTHROPIC_API_KEY` env var, checked early in `askCodebase` workflow
- Ollama host: `OLLAMA_HOST` env var (default: `http://localhost:11434`)
- Claude model: `BRAIN_CACHE_CLAUDE_MODEL` env var (default: `claude-sonnet-4-20250514`)

**Build-time Injection:**
- `__BRAIN_CACHE_VERSION__` injected by tsup `define` option, reading `version` from `package.json`
- Declared in `src/types/globals.d.ts` for TypeScript, used in `src/cli/index.ts` and `src/mcp/index.ts`

## Dependency Graph

```
CLI (src/cli/index.ts)
  └─> Workflows (dynamic import)
        ├─> init.ts       ─> capability, ollama, embedder
        ├─> doctor.ts     ─> capability, ollama
        ├─> index.ts      ─> capability, ollama, crawler, chunker, embedder, lancedb, tokenCounter
        ├─> search.ts     ─> capability, ollama, lancedb, embedder, retriever
        ├─> status.ts     ─> capability, lancedb
        ├─> buildContext.ts ─> capability, ollama, lancedb, embedder, retriever, tokenCounter
        └─> askCodebase.ts ─> buildContext, logger, @anthropic-ai/sdk

MCP (src/mcp/index.ts)
  ├─> Workflows: runIndex, runSearch, runBuildContext
  ├─> Services: capability (readProfile, detectCapabilities), ollama (isOllamaInstalled/Running, getOllamaVersion), lancedb (readIndexState)
  └─> External: @modelcontextprotocol/sdk, zod

Services (src/services/)
  ├─> capability.ts  ─> lib/types, lib/config, logger
  ├─> ollama.ts      ─> logger, ollama SDK
  ├─> crawler.ts     ─> logger, fast-glob, ignore
  ├─> chunker.ts     ─> logger, lib/types, tree-sitter + 4 language grammars
  ├─> embedder.ts    ─> logger, lib/config, ollama SDK
  ├─> lancedb.ts     ─> logger, lib/types, lib/config, @lancedb/lancedb, apache-arrow
  ├─> retriever.ts   ─> logger, lib/types, lib/config, @lancedb/lancedb (Table type)
  ├─> tokenCounter.ts ─> logger, lib/types, @anthropic-ai/tokenizer
  └─> logger.ts      ─> pino (no other service deps)

Lib (src/lib/)
  ├─> config.ts  ─> node:os, node:path (no external deps)
  └─> types.ts   ─> zod
```

**Rules enforced:**
- `cli/` imports only from `workflows/` (via dynamic import)
- `mcp/` imports from `workflows/` and `services/` (for guard checks)
- `workflows/` imports from `services/` and `lib/` -- one exception: `askCodebase` imports from `buildContext`
- `services/` imports from `lib/` and external packages; services do NOT import from each other (except `logger`)
- `lib/` has no internal dependencies

## Local GPU Offloading vs Cloud

**Runs locally (via Ollama on GPU/CPU):**
- Embedding generation for both indexing and query-time
- All vector search and retrieval (LanceDB, embedded, no server)
- AST parsing and chunking (tree-sitter, CPU only)
- Token counting (Anthropic tokenizer library, CPU only)
- Context assembly and budget enforcement

**Runs in the cloud (Anthropic API):**
- Only `brain-cache ask` command sends data to Claude
- Only the assembled, token-budgeted context is sent -- never raw files
- Model configurable via `BRAIN_CACHE_CLAUDE_MODEL` env var (default: `claude-sonnet-4-20250514`)

**Graceful GPU degradation:**
- VRAM tier `none` (no GPU or <2 GiB): uses `nomic-embed-text` (768-dim, ~500MB VRAM)
- VRAM tier `standard` (2-7 GiB): uses `nomic-embed-text`
- VRAM tier `large` (8+ GiB): uses `mxbai-embed-large` (1024-dim, ~670MB VRAM)
- `brain-cache init` warns when no GPU is detected but proceeds with CPU-only mode

---

*Architecture analysis: 2026-04-01*
