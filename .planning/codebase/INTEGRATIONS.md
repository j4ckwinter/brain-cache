# External Integrations

**Analysis Date:** 2026-04-01

## APIs & External Services

### Ollama (Local LLM Runtime)

**Purpose:** Run embedding models locally on the developer's GPU/CPU to generate vector embeddings for code chunks.

**SDK/Client:** `ollama` npm package (^0.6.3) - official JS library
**Connection:** HTTP to `http://localhost:11434` (default Ollama port), overridable via `OLLAMA_HOST` env var
**Auth:** None (local service)

**Service management (`src/services/ollama.ts`):**
- `isOllamaInstalled()` - Checks binary presence via `which`/`where`
- `isOllamaRunning()` - Pings Ollama host URL (respects `OLLAMA_HOST`)
- `startOllama()` - Spawns `ollama serve` as detached process, polls for readiness (500ms intervals, 10 attempts max). Refuses to spawn if `OLLAMA_HOST` points to a remote address. Cleans up spawned process on SIGINT/SIGTERM or timeout.
- `pullModelIfMissing(model)` - Streams model download with progress reporting if not already present
- `getOllamaVersion()` - Runs `ollama --version`
- `modelMatches(listedName, profileModel)` - Compares model names by base name (strips `:tag` suffix)

**Embedding (`src/services/embedder.ts`):**
- `embedBatch(model, texts)` - Calls `ollama.embed({ model, input: texts, truncate: true })` with 120s timeout (`EMBED_TIMEOUT_MS`)
- `embedBatchWithRetry(model, texts, dimension)` - Wraps embedBatch with:
  - Single cold-start retry (5s delay) for ECONNRESET/ECONNREFUSED/fetch-failed errors
  - Context-length fallback: if batch exceeds model context, falls back to individual embedding per text; texts that still exceed limit get zero vectors
- Batch size: 32 texts per call (configured in `src/lib/config.ts` as `DEFAULT_BATCH_SIZE`)

**Supported embedding models (configured in `src/lib/config.ts`):**
| Model | Dimensions | VRAM Tier | Max Tokens |
|-------|-----------|-----------|------------|
| `nomic-embed-text` | 768 | `none` or `standard` (< 8 GiB) | ~1400 Anthropic tokens |
| `mxbai-embed-large` | 1024 | `large` (8+ GiB) | ~1400 Anthropic tokens |

Model selection is automatic based on detected VRAM via `src/services/capability.ts:selectEmbeddingModel()`.

### Anthropic Claude API

**Purpose:** Send assembled, token-budgeted context to Claude for reasoning (the `ask` command only).

**SDK/Client:** `@anthropic-ai/sdk` (^0.81.0) - official TypeScript SDK
**Auth:** `ANTHROPIC_API_KEY` environment variable (required only for `ask` command)

**Usage (`src/workflows/askCodebase.ts`):**
```typescript
const client = new Anthropic();  // reads ANTHROPIC_API_KEY from env
const response = await client.messages.create({
  model,        // default: 'claude-sonnet-4-20250514'
  max_tokens,   // default: 4096
  system: SYSTEM_PROMPT,
  messages: [{ role: 'user', content: `<context>\n\nQuestion: ${question}` }],
});
```

**Key design:** Claude receives ONLY the assembled context block (post-retrieval, post-dedup, post-token-budget), never raw chunks or full files. This is the core token reduction strategy.

**Configuration:**
- `ANTHROPIC_API_KEY` - Required env var, checked early with clear error message
- `BRAIN_CACHE_CLAUDE_MODEL` - Optional env var to override model (default: `claude-sonnet-4-20250514`)

### Anthropic Tokenizer

**Purpose:** Count tokens locally without API round-trip for context budget tracking.

**SDK/Client:** `@anthropic-ai/tokenizer` (^0.0.4)
**Auth:** None (local computation)

**Usage (`src/services/tokenCounter.ts`):**
- `countChunkTokens(text)` - Wraps `countTokens()` from the tokenizer package
- `assembleContext(chunks, { maxTokens })` - Greedy fill algorithm that adds chunks until token budget is reached
- `formatChunk(chunk)` - Formats a chunk as `// File: path (lines N-M)\n<content>`
- Used in `src/workflows/buildContext.ts` to compute reduction percentage vs sending whole files

## Data Storage

### LanceDB (Embedded Vector Database)

**Purpose:** Store and query vector embeddings of code chunks with cosine similarity search.

**Client:** `@lancedb/lancedb` (^0.27.1) + `apache-arrow` (^18.1.0) for schema definitions
**Storage location:** `<projectRoot>/.brain-cache/index/` (disk-backed, no server)
**Auth:** None (local embedded database)

**Schema (`src/services/lancedb.ts`):**
```
Table: chunks
Columns:
  id         - Utf8 (format: "filepath:startRow")
  file_path  - Utf8
  chunk_type - Utf8 (function|class|method|file)
  scope      - Utf8 nullable (parent class/impl name)
  name       - Utf8 nullable (function/class name)
  content    - Utf8 (source code text)
  start_line - Int32
  end_line   - Int32
  vector     - FixedSizeList<Float32>[dim] (768 or 1024)
```

**Key operations (`src/services/lancedb.ts`):**
- `openDatabase(projectRoot)` - Opens/creates LanceDB connection at `.brain-cache/index/`
- `openOrCreateChunkTable(db, projectRoot, model, dim)` - Creates table with Arrow schema; drops and recreates if embedding model/dimension changes
- `insertChunks(table, rows)` - Batch insert chunk rows
- `createVectorIndexIfNeeded(table, embeddingModel)` - Creates IVF-PQ index when row count >= 10,000 (`VECTOR_INDEX_THRESHOLD`); numPartitions=256, numSubVectors=dim/8
- `deleteChunksByFilePath(table, filePath)` - Removes all chunks for a given file (incremental re-indexing)
- `readFileHashes(projectRoot)` / `writeFileHashes(projectRoot, hashes)` - SHA256 hash manifest for incremental indexing at `<projectRoot>/.brain-cache/file-hashes.json`

**Search (`src/services/retriever.ts`):**
```typescript
table.query().nearestTo(queryVector).distanceType('cosine').limit(opts.limit).toArray()
```
- Intent-based retrieval strategies via `classifyQueryIntent(query)`:
  - `knowledge`: limit=10, distance threshold=0.4 (0.6 similarity)
  - `diagnostic`: limit=20, distance threshold=0.4 (0.6 similarity)
- Diagnostic detection uses keyword matching with bigram boosting and exclusion patterns
- Results sorted by similarity descending after filtering
- Deduplication via `deduplicateChunks()` using chunk ID set

**Index state (`<projectRoot>/.brain-cache/index_state.json`):**
- Validated with Zod schema (`IndexStateSchema` in `src/lib/types.ts`)
- Tracks: version, embeddingModel, dimension, indexedAt, fileCount, chunkCount

### File Storage

- Local filesystem only
- Project data stored in `<projectRoot>/.brain-cache/` (per-project)
- Global config stored in `~/.brain-cache/` (profile, config)

### Caching

- None (LanceDB is the persistence layer; no Redis/memcached)
- Incremental indexing via file hash comparison (`file-hashes.json`) avoids re-embedding unchanged files

## Authentication & Identity

**Auth Provider:** None (local tool)
- Anthropic API key read from environment variable
- No user accounts or authentication system

## Monitoring & Observability

**Logging:**
- Pino ^9.0.0 with structured JSON output to stderr (`src/services/logger.ts`)
- Per-component child loggers via `childLogger('component-name')`
- Components: `ollama`, `lancedb`, `embedder`, `capability`, `retriever`, `tokenCounter`, `chunker`, `crawler`, `mcp`, `ask-codebase`
- Level controlled by `BRAIN_CACHE_LOG` env var (default: `warn`)
- Sensitive field redaction: apiKey, secret, password, token, authorization, ANTHROPIC_API_KEY, OPENAI_API_KEY
- Dev formatting via `pino-pretty` (devDependency)

**Error Tracking:** None (no Sentry/etc.)

**Metrics:** Token reduction percentage reported to stderr after each `context`/`ask` operation

## MCP Protocol Integration

**Purpose:** Expose brain-cache capabilities as MCP tools that Claude Code can call directly.

**SDK:** `@modelcontextprotocol/sdk` (^1.29.0)
**Transport:** Stdio (`StdioServerTransport` in `src/mcp/index.ts`)
**Entry point:** `dist/mcp.js` (built from `src/mcp/index.ts`)

**Registered tools:**

| Tool | Description | Input Schema |
|------|-------------|-------------|
| `index_repo` | Index a codebase (parse, chunk, embed, store) | `{ path: string, force?: boolean }` |
| `search_codebase` | Semantic search with natural language query | `{ query: string, limit?: number, path?: string }` |
| `build_context` | Build token-budgeted context block | `{ query: string, maxTokens?: number, path?: string }` |
| `doctor` | System health check (Ollama, index, VRAM) | `{ path?: string }` |

**Pattern:** Each tool validates prerequisites (profile exists, Ollama running) before executing. Errors return `isError: true` with descriptive messages. Input schemas use Zod for validation. The `build_context` tool appends a second text content block prompting Claude to display token savings.

## Tree-sitter (Code Parsing)

**Purpose:** Parse source code into AST for function/class/method boundary chunking.

**Packages:**
- `tree-sitter` ^0.25.0 - Core parser
- `tree-sitter-typescript` ^0.23.2 - TS/TSX/JS/JSX grammar
- `tree-sitter-python` ^0.25.0 - Python grammar
- `tree-sitter-go` ^0.25.0 - Go grammar
- `tree-sitter-rust` ^0.24.0 - Rust grammar

**Usage (`src/services/chunker.ts`):**
- Loaded via `createRequire` (CJS packages in ESM context)
- Supported extensions: `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.py`, `.pyi`, `.go`, `.rs`
- Extracts: functions, classes, methods (language-specific node types defined in `CHUNK_NODE_TYPES`)
- Arrow functions filtered structurally: only extracts arrow functions that are `variable_declarator > lexical_declaration > program|export_statement` (top-level or exported const arrows)
- Fallback: if language is supported but no AST nodes are extracted, emits a single `file`-type chunk with full content

## File Crawling

**Purpose:** Discover source files for indexing.

**Packages:**
- `fast-glob` ^3.3.3 - File discovery
- `ignore` ^7.0.5 - `.gitignore` pattern matching

**Usage (`src/services/crawler.ts`):**
- Crawls from project root with `fast-glob`
- Respects `.gitignore` patterns
- Always excludes: `node_modules`, `.git`, `dist`, `build`, `.next`, `__pycache__`, `*.egg-info`, lock files (`package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `Cargo.lock`), `*.min.js`
- Filters to supported source extensions only (same set as chunker)

## GPU/Hardware Detection

**Purpose:** Detect available VRAM to select optimal embedding model.

**Implementation (`src/services/capability.ts`):**
- NVIDIA: `nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits` (3s timeout)
- Apple Silicon: `system_profiler SPHardwareDataType -json` (checks `chip_type` contains "Apple M"; Intel Macs explicitly excluded)
- Fallback: `none` tier (uses `nomic-embed-text` which runs on CPU)

**VRAM Tiers:**
| Tier | VRAM | Embedding Model |
|------|------|----------------|
| `none` | < 2 GiB or no GPU | `nomic-embed-text` (768d) |
| `standard` | 2-7 GiB | `nomic-embed-text` (768d) |
| `large` | 8+ GiB | `mxbai-embed-large` (1024d) |

**Profile storage:** `~/.brain-cache/profile.json` (validated with `CapabilityProfileSchema` in `src/lib/types.ts`)
**Profile fields:** version, detectedAt, vramTier, vramGiB, gpuVendor (nvidia|apple|none), embeddingModel, ollamaVersion, platform

## Environment Configuration

**Required env vars:**
- `ANTHROPIC_API_KEY` - Only for `brain-cache ask` command

**Optional env vars:**
- `BRAIN_CACHE_CLAUDE_MODEL` - Override Claude model (default: `claude-sonnet-4-20250514`)
- `BRAIN_CACHE_LOG` - Log level: `debug`, `info`, `warn`, `error`, `silent` (default: `warn`)
- `OLLAMA_HOST` - Override Ollama server URL (default: `http://localhost:11434`)

**Config files (per-user):**
- `~/.brain-cache/profile.json` - Hardware capability profile
- `~/.brain-cache/config.json` - Global config (path defined in `src/lib/config.ts` but not yet used)

**Config files (per-project):**
- `<projectRoot>/.brain-cache/index_state.json` - Index metadata
- `<projectRoot>/.brain-cache/file-hashes.json` - SHA256 hash manifest for incremental indexing
- `<projectRoot>/.brain-cache/index/` - LanceDB data directory

## Webhooks & Callbacks

**Incoming:** None
**Outgoing:** None

## CI/CD & Deployment

**Hosting:** Local developer machine (not a hosted service)
**CI Pipeline:** Not detected (no `.github/` directory)
**Distribution:** npm package with `brain-cache` binary via `"bin"` field; `brain-cache-0.1.0.tgz` tarball present in repo root

---

*Integration audit: 2026-04-01*
