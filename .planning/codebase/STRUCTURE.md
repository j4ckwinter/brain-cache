# Codebase Structure

**Analysis Date:** 2026-04-01

## Directory Layout

```
brain-cache/
├── src/
│   ├── cli/
│   │   └── index.ts          # Commander CLI entry point (7 subcommands)
│   ├── mcp/
│   │   └── index.ts          # MCP server entry point (4 tools, stdio transport)
│   ├── workflows/
│   │   ├── index.ts           # Index workflow (crawl -> chunk -> embed -> store)
│   │   ├── init.ts            # Hardware detection + Ollama setup
│   │   ├── doctor.ts          # System health report
│   │   ├── search.ts          # Vector search workflow
│   │   ├── buildContext.ts    # Token-budgeted context assembly
│   │   ├── askCodebase.ts     # Context + Claude API question answering
│   │   └── status.ts          # Index stats report
│   ├── services/
│   │   ├── index.ts           # Barrel re-exports for all services
│   │   ├── capability.ts      # GPU/VRAM detection, profile read/write
│   │   ├── chunker.ts         # Tree-sitter AST parsing -> CodeChunks
│   │   ├── crawler.ts         # File discovery (fast-glob + .gitignore)
│   │   ├── embedder.ts        # Ollama embed API with retry/fallback
│   │   ├── lancedb.ts         # LanceDB connection, table CRUD, index state
│   │   ├── retriever.ts       # Intent classification, vector search, dedup
│   │   ├── tokenCounter.ts    # Anthropic tokenizer, context assembly
│   │   ├── logger.ts          # Pino logger with secret redaction
│   │   └── ollama.ts          # Ollama binary/server management
│   ├── lib/
│   │   ├── index.ts           # Barrel re-exports for types + config
│   │   ├── config.ts          # Constants (paths, thresholds, defaults)
│   │   └── types.ts           # Zod schemas + TypeScript interfaces
│   ├── tools/
│   │   └── index.ts           # Empty barrel (reserved for future tool modules)
│   └── types/
│       └── globals.d.ts       # Build-time __BRAIN_CACHE_VERSION__ declaration
├── tests/
│   ├── mcp/
│   │   └── server.test.ts     # MCP server tool registration tests
│   ├── services/
│   │   ├── capability.test.ts
│   │   ├── chunker.test.ts
│   │   ├── crawler.test.ts
│   │   ├── embedder.test.ts
│   │   ├── lancedb.test.ts
│   │   ├── logger.test.ts
│   │   ├── ollama.test.ts
│   │   ├── retriever.test.ts
│   │   └── tokenCounter.test.ts
│   └── workflows/
│       ├── index.test.ts
│       ├── init.test.ts
│       ├── askCodebase.test.ts
│       ├── buildContext.test.ts
│       ├── search.test.ts
│       └── status.test.ts
├── dist/                      # Build output (tsup, gitignored)
│   ├── cli.js                 # CLI binary (ESM, shebang)
│   ├── mcp.js                 # MCP server (ESM)
│   └── *.d.ts                 # Type declarations
├── .brain-cache/              # Per-project index data (gitignored)
│   └── index/                 # LanceDB database files
├── .planning/                 # GSD workflow planning artifacts
├── package.json
├── tsconfig.json
├── tsup.config.ts             # Two build entries: cli + mcp
├── vitest.config.ts
├── .mcp.json                  # MCP server config for Claude Code
├── .gitignore
├── .nvmrc                     # Node.js version pin (22)
├── .npmrc                     # npm config (legacy-peer-deps=true)
├── CLAUDE.md                  # Project instructions for Claude
└── README.md
```

## Directory Purposes

**`src/cli/`:**
- Purpose: CLI entry point using Commander
- Contains: Single `index.ts` with all 7 command definitions
- Key file: `src/cli/index.ts`
- Pattern: Each command uses dynamic `import()` to lazy-load the corresponding workflow module

**`src/mcp/`:**
- Purpose: MCP (Model Context Protocol) server for Claude Code integration
- Contains: Single `index.ts` with 4 registered tools and stdio transport setup
- Key file: `src/mcp/index.ts`
- Pattern: Each tool wraps a workflow function with pre-flight guards (profile, Ollama) and structured JSON return

**`src/workflows/`:**
- Purpose: Multi-step orchestration functions that compose services into complete operations
- Contains: One file per workflow, each exporting a single `run*` function
- Key files:
  - `src/workflows/index.ts` -- largest and most complex: full indexing pipeline with incremental support
  - `src/workflows/buildContext.ts` -- context assembly with token budgeting
  - `src/workflows/askCodebase.ts` -- the only workflow that calls the Claude API

**`src/services/`:**
- Purpose: Single-responsibility modules, each wrapping one external dependency or system concern
- Contains: 10 service files + barrel index
- Key files:
  - `src/services/chunker.ts` -- tree-sitter AST parsing for TypeScript, Python, Go, Rust
  - `src/services/lancedb.ts` -- vector database operations, Arrow schema, state persistence
  - `src/services/retriever.ts` -- query intent classification, vector search, deduplication
  - `src/services/embedder.ts` -- Ollama embedding with cold-start retry and context-length fallback
  - `src/services/capability.ts` -- GPU/VRAM detection (NVIDIA via nvidia-smi, Apple Silicon via system_profiler)
  - `src/services/ollama.ts` -- Ollama binary detection, server management, model pulling
  - `src/services/logger.ts` -- Pino logger to stderr with secret redaction
  - `src/services/tokenCounter.ts` -- Anthropic tokenizer wrapper + greedy context assembly
  - `src/services/crawler.ts` -- fast-glob file discovery with .gitignore support

**`src/lib/`:**
- Purpose: Shared types, Zod schemas, and configuration constants (no business logic)
- Contains: `types.ts` (all schemas and interfaces), `config.ts` (all constants), `index.ts` (barrel)
- Key files:
  - `src/lib/types.ts` -- `CapabilityProfileSchema`, `CodeChunkSchema`, `IndexStateSchema`, plus interfaces for `RetrievedChunk`, `ContextResult`, `ContextMetadata`, `SearchOptions`, `QueryIntent`
  - `src/lib/config.ts` -- paths (`GLOBAL_CONFIG_DIR`, `PROJECT_DATA_DIR`), thresholds (`DEFAULT_DISTANCE_THRESHOLD`, `VECTOR_INDEX_THRESHOLD`), limits (`DEFAULT_BATCH_SIZE`, `EMBED_MAX_TOKENS`, `FILE_READ_CONCURRENCY`)

**`src/tools/`:**
- Purpose: Reserved for future standalone tool modules
- Contains: Empty barrel export (`src/tools/index.ts`)
- Status: Intentionally empty (marked DEBT-04)

**`src/types/`:**
- Purpose: Ambient TypeScript declarations for build-time constants
- Contains: `globals.d.ts` declaring `__BRAIN_CACHE_VERSION__`

**`tests/`:**
- Purpose: Vitest test suites mirroring `src/` layer structure
- Contains: Test files organized into `services/`, `workflows/`, `mcp/` subdirectories
- Pattern: `tests/{layer}/{module}.test.ts` corresponds to `src/{layer}/{module}.ts`

## Key File Locations

**Entry Points:**
- `src/cli/index.ts`: CLI binary entry (Commander program, 7 subcommands)
- `src/mcp/index.ts`: MCP server entry (stdio transport, 4 tools)

**Configuration:**
- `src/lib/config.ts`: Runtime constants (paths, thresholds, batch sizes, timeouts)
- `tsup.config.ts`: Build configuration (two entries: cli + mcp, ESM, node20 target, version injection)
- `tsconfig.json`: TypeScript config (ES2022 target, Node16 module resolution, strict mode)
- `vitest.config.ts`: Test runner config
- `.mcp.json`: MCP server registration for Claude Code (`node ./dist/mcp.js`)

**Core Logic:**
- `src/workflows/index.ts`: Full indexing pipeline (~300 lines, most complex module)
- `src/workflows/buildContext.ts`: Token-budgeted context assembly
- `src/services/chunker.ts`: Tree-sitter AST parsing for 4 languages (~230 lines)
- `src/services/lancedb.ts`: LanceDB operations and Arrow schema (~250 lines)
- `src/services/retriever.ts`: Query intent classification and vector search
- `src/services/embedder.ts`: Ollama embedding with retry and fallback

**Type Definitions:**
- `src/lib/types.ts`: All Zod schemas and TypeScript interfaces (~74 lines)
- `src/services/lancedb.ts`: `ChunkRow` interface (LanceDB row shape)

**Testing:**
- `tests/services/*.test.ts`: Unit tests for each service (9 files)
- `tests/workflows/*.test.ts`: Workflow tests (6 files)
- `tests/mcp/server.test.ts`: MCP tool registration tests

## Naming Conventions

**Files:**
- `camelCase.ts` for all source files: `buildContext.ts`, `tokenCounter.ts`, `askCodebase.ts`
- `camelCase.test.ts` for test files, matching the source file name: `buildContext.test.ts`
- `index.ts` for barrel exports and entry points

**Directories:**
- Lowercase, single word: `services/`, `workflows/`, `lib/`, `cli/`, `mcp/`, `tools/`, `types/`

**Exports:**
- Workflows export a single `run*` function: `runInit`, `runIndex`, `runSearch`, `runBuildContext`, `runAskCodebase`, `runDoctor`, `runStatus`
- Services export named functions and types; no default exports anywhere in the codebase
- Barrel files (`index.ts`) use explicit named re-exports, never `export *`

**Variables/Functions:**
- Functions: `camelCase` (`chunkFile`, `embedBatchWithRetry`, `classifyQueryIntent`)
- Constants: `UPPER_SNAKE_CASE` (`DEFAULT_BATCH_SIZE`, `EMBED_TIMEOUT_MS`, `SOURCE_EXTENSIONS`)
- Types/Interfaces: `PascalCase` (`CapabilityProfile`, `CodeChunk`, `RetrievedChunk`)
- Zod schemas: `PascalCase` + `Schema` suffix (`CapabilityProfileSchema`, `IndexStateSchema`)
- LanceDB columns: `snake_case` (`file_path`, `chunk_type`, `start_line`)

## Where to Add New Code

**New CLI Command (e.g., `brain-cache diff`):**
1. Create workflow: `src/workflows/diff.ts` -- export a `runDiff()` function
2. Add command in `src/cli/index.ts` using dynamic import pattern:
   ```typescript
   program.command('diff').action(async () => {
     const { runDiff } = await import('../workflows/diff.js');
     await runDiff();
   });
   ```
3. Add tests: `tests/workflows/diff.test.ts`

**New MCP Tool:**
1. Add `server.registerTool(...)` block in `src/mcp/index.ts`
2. Include pre-flight guards: check `readProfile()` and `isOllamaRunning()` before calling workflow
3. Wrap workflow call in try/catch, return `{ isError: true, ... }` on failure
4. Add tests in `tests/mcp/server.test.ts`

**New Service (e.g., caching layer):**
1. Create: `src/services/cache.ts`
2. Use `childLogger('cache')` for structured logging
3. Export named functions (stateless preferred)
4. Add re-export to barrel: `src/services/index.ts`
5. Add tests: `tests/services/cache.test.ts`

**New Shared Type or Schema:**
1. Add Zod schema + inferred TypeScript type to `src/lib/types.ts`
2. Add re-export in `src/lib/index.ts`

**New Config Constant:**
1. Add to `src/lib/config.ts`
2. Add re-export in `src/lib/index.ts`

**Utilities/Helpers:**
- Service-specific: Add as unexported function within the service file
- Shared across services: Add to an existing service or create a new one in `src/services/`
- Pure type/config helpers: Add to `src/lib/`
- There is no `utils/` directory -- use `src/lib/` for pure helpers with no external deps

## Special Directories

**`.brain-cache/` (per-project, at project root):**
- Purpose: LanceDB index data and metadata
- Generated: Yes (by `brain-cache index`)
- Committed: No (gitignored)
- Contents: `index/` (LanceDB Lance files), `index_state.json` (stats), `file-hashes.json` (SHA-256 manifest)

**`~/.brain-cache/` (global, user home):**
- Purpose: Hardware capability profile
- Generated: Yes (by `brain-cache init`)
- Committed: N/A (user home directory)
- Contents: `profile.json` (CapabilityProfile), `config.json` (reserved)

**`dist/`:**
- Purpose: Build output from tsup
- Generated: Yes (by `npm run build`)
- Committed: No (gitignored)
- Contents: `cli.js` (with shebang), `mcp.js`, code-split chunks, `.d.ts` declarations

**`.planning/`:**
- Purpose: GSD workflow planning artifacts and codebase analysis docs
- Generated: By GSD commands
- Committed: Varies (some tracked, some gitignored)

**`.devcontainer/`:**
- Purpose: Dev container configuration
- Generated: No (checked in)
- Contents: Container definition files

## Build Output

The `tsup.config.ts` defines two separate build entries:

1. **CLI entry** (`src/cli/index.ts` -> `dist/cli.js`):
   - Has `#!/usr/bin/env node` shebang via `banner` option
   - `clean: true` -- clears dist/ before building
   - Code-split due to dynamic `import()` in command handlers
   - Registered as `bin.brain-cache` in `package.json`

2. **MCP entry** (`src/mcp/index.ts` -> `dist/mcp.js`):
   - No shebang (invoked via `node ./dist/mcp.js` in `.mcp.json`)
   - `clean: false` -- preserves CLI output from first build
   - Eager imports (no code splitting)

Both targets: ESM format, node20 target, `.d.ts` type declarations, `__BRAIN_CACHE_VERSION__` injected from `package.json`.

---

*Structure analysis: 2026-04-01*
