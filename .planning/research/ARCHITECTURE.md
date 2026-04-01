# Architecture Research

**Domain:** Local AI Runtime / Code Intelligence (Braincache)
**Researched:** 2026-03-31
**Confidence:** HIGH (MCP SDK, LanceDB, Ollama API docs verified; RAG patterns verified via multiple sources)

---

## Standard Architecture

### System Overview

```
  Claude Code (MCP Client)
         |
         | JSON-RPC over stdio
         v
  ┌─────────────────────────────────────────────────────────────┐
  │                    MCP Server Layer                          │
  │  tools: index_repo | search_codebase | build_context | doctor│
  └──────────────────────┬──────────────────────────────────────┘
                         |
                         | dispatch to workflow
                         v
  ┌─────────────────────────────────────────────────────────────┐
  │                   Workflow Layer                             │
  │  IndexWorkflow | SearchWorkflow | ContextWorkflow           │
  │  (orchestrate service calls, own business logic)            │
  └──┬──────────────────┬────────────────────┬─────────────────┘
     |                  |                    |
     v                  v                    v
  ┌────────┐    ┌──────────────┐    ┌────────────────┐
  │Indexer │    │EmbedService  │    │ContextBuilder  │
  │Service │    │(Ollama HTTP) │    │Service         │
  └───┬────┘    └──────┬───────┘    └───────┬────────┘
      |                |                    |
      v                v                    v
  ┌────────────────────────────────────────────────────────────┐
  │                  LanceDB (embedded, on-disk)                │
  │  tables: code_chunks, file_metadata, index_state           │
  └────────────────────────────────────────────────────────────┘
      |
      v (capability-gated path)
  ┌─────────────────────┐
  │ CapabilityDetector  │  → GPU/VRAM check → Ollama or skip
  └─────────────────────┘

  (ask-codebase path only)
  ContextBuilder output
         |
         v
  ┌─────────────────────┐
  │  Anthropic SDK      │  → Claude API (compressed context)
  └─────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Notes |
|-----------|---------------|-------|
| MCP Server | Receives JSON-RPC tool calls from Claude Code over stdio; dispatches to workflows | Thin layer — no business logic |
| Workflow Layer | Orchestrates multi-step operations (index, search, build_context, ask); owns sequencing | The only place that knows "what order" |
| IndexerService | File walking, AST parsing, chunking, deduplication, writes to LanceDB | Depends on EmbedService |
| EmbedService | Calls Ollama `/api/embed` HTTP endpoint; returns float vectors | Stateless; swappable model |
| ContextBuilder | Retrieves top-K chunks, deduplicates, scores relevance, trims to token budget | Pure transformation — no I/O |
| LanceDB | Embedded vector store; cosine similarity search; no external server | In-process library, writes to `~/.braincache/` |
| CapabilityDetector | Detects GPU presence, VRAM, Ollama reachability; returns capability profile | Called once at startup and on `doctor` |
| CLI Layer | Commander.js commands (init, index, doctor, status); calls workflows directly | Thin adapter; same workflows as MCP tools |
| Anthropic SDK | Sends compressed context to Claude for `ask-codebase` flow only | Optional path — not used for search/index |

---

## Recommended Project Structure

```
src/
  workflows/          # Business logic lives here — one file per workflow
    index.workflow.ts
    search.workflow.ts
    context.workflow.ts
    ask.workflow.ts

  services/           # Reusable, stateless service functions
    embed.service.ts       # Ollama embedding calls
    indexer.service.ts     # File walking + chunking + AST parsing
    lancedb.service.ts     # LanceDB read/write operations
    context-builder.service.ts   # Context assembly + compression
    capability.service.ts  # GPU/VRAM/Ollama health checks

  tools/              # MCP tool definitions (schema + handler wiring)
    index-repo.tool.ts
    search-codebase.tool.ts
    build-context.tool.ts
    doctor.tool.ts

  cli/                # Commander.js commands (thin adapters over workflows)
    commands/
      init.command.ts
      index.command.ts
      doctor.command.ts
      status.command.ts

  lib/                # Shared utilities with no business logic
    chunker.ts         # AST-aware code chunking (tree-sitter)
    tokenizer.ts       # Token counting for budget enforcement
    logger.ts          # Structured logging
    config.ts          # Hardcoded defaults, path resolution

  mcp-server.ts       # MCP server entry point (stdio transport)
  index.ts            # CLI entry point
```

**Dependency rule:** `cli/` → `workflows/` → `services/` → `lib/`. Nothing flows upward. MCP `tools/` also only call into `workflows/`.

---

## Architectural Patterns

### Pattern 1: Workflows-First Dispatch

Both the CLI and MCP server are thin adapters. They parse input, call a workflow function, and return output. No business logic lives in either.

```typescript
// tools/search-codebase.tool.ts
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === "search_codebase") {
    const result = await searchWorkflow(request.params.arguments);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
});

// cli/commands/search.command.ts
program.command("search <query>")
  .action(async (query) => {
    const result = await searchWorkflow({ query });
    console.log(result);
  });
```

### Pattern 2: Capability-Gated Execution

CapabilityDetector runs at startup and produces a profile. Workflows check the profile before calling services that require GPU/Ollama. No silent failures.

```typescript
// services/capability.service.ts
interface CapabilityProfile {
  ollamaReachable: boolean;
  gpuAvailable: boolean;
  vramMB: number | null;
  recommendedModel: string;
  fallback: "cpu" | "skip";
}
```

If Ollama is unreachable: `doctor` reports the gap, indexing is deferred, and search falls back to keyword-only (no vector). The system degrades gracefully rather than crashing.

### Pattern 3: Dual-Pipeline Architecture

**Indexing pipeline** (offline, triggered by `index_repo`):
```
file walk → filter (gitignore) → chunk (AST-aware) → embed (Ollama) → store (LanceDB)
```

**Query pipeline** (realtime, triggered by `search_codebase` / `build_context`):
```
query → embed (Ollama) → similarity search (LanceDB) → rank + deduplicate → trim to token budget → return
```

These pipelines share `EmbedService` and `LanceDB` but are otherwise independent. Build indexing first; query pipeline depends on its output.

### Pattern 4: Context Budget Enforcement

ContextBuilder enforces a token ceiling before any content reaches Claude. The budget is hardcoded (no user config). Chunks are prioritized by similarity score; low-score chunks are dropped until the budget fits.

```typescript
// services/context-builder.service.ts
const MAX_CONTEXT_TOKENS = 8_000; // hardcoded, never a parameter

function buildContext(chunks: RankedChunk[]): string {
  const selected: RankedChunk[] = [];
  let tokens = 0;
  for (const chunk of chunks) {
    const chunkTokens = countTokens(chunk.content);
    if (tokens + chunkTokens > MAX_CONTEXT_TOKENS) break;
    selected.push(chunk);
    tokens += chunkTokens;
  }
  return formatContext(selected);
}
```

### Pattern 5: MCP Server via stdio Transport

Claude Code spawns Braincache as a child process. Communication is JSON-RPC over stdin/stdout. The server process starts, registers tools, then waits. Startup time matters — initialize lazily.

```typescript
// mcp-server.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new McpServer({ name: "braincache", version: "1.0.0" });
// register tools...
const transport = new StdioServerTransport();
await server.connect(transport);
```

---

## Data Flow

### Full Query Flow: search_codebase tool call

```
1. Claude Code sends JSON-RPC: tools/call { name: "search_codebase", args: { query } }
2. MCP Server receives on stdio → dispatches to searchWorkflow(args)
3. searchWorkflow:
   a. EmbedService.embed(query) → POST /api/embed to Ollama → float[] (1024-dim)
   b. LanceDB.similaritySearch(vector, topK=10) → RankedChunk[]
   c. ContextBuilder.build(chunks) → deduplicate → trim to token budget → string
4. searchWorkflow returns { context, sources, tokenCount, savedTokens }
5. MCP Server encodes as JSON-RPC response → sends on stdout
6. Claude Code receives context → uses in next LLM call
```

### Indexing Flow: index_repo tool call or `braincache index`

```
1. CLI or MCP tool receives repo path
2. indexWorkflow:
   a. IndexerService.walk(path) → file list (respects .gitignore)
   b. For each file: IndexerService.parse(file) → AST → semantic chunks
   c. EmbedService.batchEmbed(chunks) → vector[] (batched for throughput)
   d. LanceDB.upsert(chunks + vectors + metadata)
3. Reports: files indexed, chunks stored, time elapsed, model used
```

### Capability Detection Flow: startup / doctor

```
1. CapabilityDetector.detect():
   a. Ping Ollama at http://localhost:11434/api/tags
   b. If reachable: check available models, select embed model
   c. Query system for GPU presence (nvidia-smi or Ollama /api/ps)
   d. Return CapabilityProfile
2. Store profile in process memory (not disk)
3. Workflows read profile before calling Ollama
4. doctor command surfaces profile as human-readable output
```

---

## Anti-Patterns

### Anti-Pattern 1: Business Logic in MCP Tool Handlers
**What:** Embedding, retrieval, or context assembly code inside `tools/` files.
**Why bad:** CLI commands cannot reuse the logic; testing requires MCP infrastructure; code duplicates.
**Instead:** Tool handlers call workflow functions. Workflows own all logic.

### Anti-Pattern 2: Services Calling Each Other
**What:** EmbedService calling IndexerService, or ContextBuilder calling LanceDB directly from a tool.
**Why bad:** Creates implicit ordering requirements and circular dependencies.
**Instead:** Only workflows orchestrate service calls. Services are leaf nodes — they call `lib/` utilities only.

### Anti-Pattern 3: Embedding at Query Time Without Index
**What:** Embedding every query result on the fly without a pre-built index.
**Why bad:** 10-100x slower per query; makes interactive use unusable.
**Instead:** Index once, query against stored vectors. Separate pipelines, separate commands.

### Anti-Pattern 4: Naive Line-Based Chunking
**What:** Splitting files every N lines or N characters.
**Why bad:** Chunks split across function boundaries; embeddings encode partial syntax; retrieval degrades significantly.
**Instead:** AST-aware chunking with tree-sitter. Split at function/class/method boundaries. Store parent scope in metadata.

### Anti-Pattern 5: Sending Full File Contents to Claude
**What:** Passing entire files as context when only a few functions are relevant.
**Why bad:** Negates the entire value proposition; wastes tokens; degrades Claude response quality.
**Instead:** ContextBuilder always enforces a token budget. No chunk bypass allowed.

### Anti-Pattern 6: Embedding Model Mismatch
**What:** Indexing with one model, querying with a different one.
**Why bad:** Vector spaces are model-specific; cosine similarity scores become meaningless.
**Instead:** Store the model name in LanceDB `index_state` table. Detect mismatches at query time and prompt re-index.

---

## Integration Points

### Ollama HTTP API
- **Endpoint:** `POST http://localhost:11434/api/embed`
- **Request:** `{ model: string, input: string | string[] }`
- **Response:** `{ embeddings: number[][] }` (L2-normalized)
- **Recommended model:** `nomic-embed-text` (768-dim, fast, widely available)
- **Batch support:** Pass `input` as array; Ollama processes in one call
- **Health check:** `GET http://localhost:11434/api/tags` — 200 = reachable

### LanceDB (embedded, TypeScript)
- **Import:** `import * as lancedb from "@lancedb/lancedb"`
- **No server process:** Opens database directory directly
- **Tables needed:**
  - `code_chunks` — `{ id, file_path, content, vector, language, chunk_type, line_start, line_end, scope_chain, embed_model }`
  - `index_state` — `{ repo_path, indexed_at, embed_model, chunk_count, file_count }`
- **Query pattern:** `table.vectorSearch(queryVector).limit(10).toArray()`
- **Storage path:** `~/.braincache/db/` (configurable via `BRAINCACHE_DB_PATH`)

### MCP SDK (`@modelcontextprotocol/sdk`)
- **Transport:** `StdioServerTransport` — Claude Code spawns process, uses stdin/stdout
- **Tool schema:** Zod-based input validation per tool
- **Response format:** `{ content: [{ type: "text", text: string }] }`
- **Peer dependency:** `zod` required for schema definitions

### Anthropic SDK (ask-codebase path only)
- **Used for:** `ask` workflow — sending compressed context + question to Claude
- **Not used for:** index, search, build_context — those stay fully local
- **Auth:** `ANTHROPIC_API_KEY` env var
- **Model:** `claude-sonnet-4-5` or hardcoded latest; never configurable by user

---

## Build Order (Phase Dependencies)

Build in this order to respect dependencies. No component can be tested until its dependencies exist.

```
Phase 1: Foundation
  lib/config.ts
  lib/logger.ts
  lib/tokenizer.ts
  services/capability.service.ts
  → Unblocks: everything else

Phase 2: Storage Layer
  services/lancedb.service.ts  (schema, connect, upsert, search)
  → Unblocks: IndexerService, ContextBuilder

Phase 3: Embedding Pipeline
  lib/chunker.ts               (AST-aware, tree-sitter)
  services/embed.service.ts    (Ollama HTTP)
  services/indexer.service.ts  (walk + chunk + embed + store)
  → Unblocks: IndexWorkflow

Phase 4: Retrieval Pipeline
  services/context-builder.service.ts  (rank, deduplicate, trim)
  → Unblocks: SearchWorkflow, ContextWorkflow

Phase 5: Workflows
  workflows/index.workflow.ts
  workflows/search.workflow.ts
  workflows/context.workflow.ts
  workflows/ask.workflow.ts    (requires Anthropic SDK, build last)
  → Unblocks: CLI + MCP tools

Phase 6: Interfaces (CLI + MCP)
  cli/commands/*.ts
  tools/*.ts + mcp-server.ts
  → Deliverable: runnable product
```

---

## Sources

- [MCP TypeScript SDK — GitHub](https://github.com/modelcontextprotocol/typescript-sdk) — transport, tool registration, stdio pattern
- [Ollama Embeddings API](https://docs.ollama.com/capabilities/embeddings) — `/api/embed` request/response format, batch support
- [LanceDB Documentation](https://lancedb.github.io/lancedb/) — embedded usage, TypeScript SDK, zero-server pattern
- [Building RAG on Codebases — LanceDB Blog](https://lancedb.com/blog/building-rag-on-codebases-part-1/) — AST chunking, semantic search pipeline
- [Semantic Code Indexing with AST and Tree-sitter](https://medium.com/@email2dineshkuppan/semantic-code-indexing-with-ast-and-tree-sitter-for-ai-agents-part-1-of-3-eb5237ba687a) — chunking strategy, scope chain metadata
- [RAG Architecture Patterns — Calmops](https://calmops.com/architecture/rag-architecture-retrieval-augmented-generation/) — indexing vs. query pipeline separation
- [Context Compression Techniques — SitePoint](https://www.sitepoint.com/optimizing-token-usage-context-compression-techniques/) — token budget enforcement, deduplication approaches
- [Node.js Layered Architecture — LogRocket](https://blog.logrocket.com/node-js-project-architecture-best-practices/) — service/workflow separation pattern
- [Ollama GPU and Hardware Support — DeepWiki](https://deepwiki.com/ollama/ollama/6-gpu-and-hardware-support) — GPU detection, VRAM fallback behavior
