# Codebase Structure

**Analysis Date:** 2026-04-01

## Directory Layout

```
brain-cache/
├── src/
│   ├── cli/
│   │   └── index.ts            # CLI entry point (Commander program)
│   ├── lib/
│   │   ├── config.ts           # Constants and configuration values
│   │   ├── types.ts            # Zod schemas and TypeScript types
│   │   └── index.ts            # Barrel export (empty)
│   ├── mcp/
│   │   └── index.ts            # MCP server entry point (stdio transport)
│   ├── services/
│   │   ├── capability.ts       # GPU/VRAM detection, profile read/write
│   │   ├── chunker.ts          # AST-aware code chunking (tree-sitter)
│   │   ├── crawler.ts          # Source file discovery (fast-glob + .gitignore)
│   │   ├── embedder.ts         # Ollama embedding with retry/timeout
│   │   ├── lancedb.ts          # LanceDB database operations
│   │   ├── logger.ts           # Pino structured logging
│   │   ├── ollama.ts           # Ollama binary detection, version, model pull
│   │   ├── retriever.ts        # Vector search, deduplication, query intent
│   │   ├── tokenCounter.ts     # Anthropic tokenizer wrapper
│   │   └── index.ts            # Barrel export (empty)
│   ├── tools/
│   │   └── index.ts            # Barrel export (empty, reserved for future)
│   └── workflows/
│       ├── askCodebase.ts      # End-to-end: retrieve context + Claude reasoning
│       ├── buildContext.ts     # Token-budgeted context assembly
│       ├── doctor.ts           # System health diagnostics
│       ├── index.ts            # Full indexing pipeline orchestration
│       ├── init.ts             # First-run setup (detect, pull model, write profile)
│       ├── search.ts           # Semantic search over indexed codebase
│       └── status.ts           # Index stats reporting
├── tests/
│   ├── mcp/
│   │   └── server.test.ts      # MCP server tool registration tests
│   ├── services/
│   │   ├── capability.test.ts
│   │   ├── chunker.test.ts
│   │   ├── crawler.test.ts
│   │   ├── embedder.test.ts
│   │   ├── logger.test.ts
│   │   ├── ollama.test.ts
│   │   ├── retriever.test.ts
│   │   └── tokenCounter.test.ts
│   └── workflows/
│       ├── askCodebase.test.ts
│       ├── buildContext.test.ts
│       ├── index.test.ts
│       ├── init.test.ts
│       ├── search.test.ts
│       └── status.test.ts
├── dist/                       # Build output (gitignored)
│   ├── cli.js                  # CLI binary (with shebang)
│   ├── cli.d.ts                # CLI type declarations
│   ├── mcp.js                  # MCP server bundle
│   ├── mcp.d.ts                # MCP type declarations
│   └── chunk-*.js / *.js       # Code-split shared chunks
├── .planning/                  # GSD workflow artifacts (gitignored)
├── .devcontainer/              # Dev container config (gitignored)
├── package.json                # Package manifest, scripts, deps
├── package-lock.json           # Lockfile
├── tsconfig.json               # TypeScript compiler config
├── tsup.config.ts              # Build config (dual entry: cli + mcp)
├── vitest.config.ts            # Test runner config
├── .mcp.json                   # MCP server registration for Claude
├── .nvmrc                      # Node.js version (22)
├── .npmrc                      # npm config (legacy-peer-deps=true)
├── .gitignore                  # Ignores dist/, node_modules/, .brain-cache/, .planning/
├── CLAUDE.md                   # Project instructions for Claude
└── README.md                   # Project documentation
```

## Directory Purposes

**`src/cli/`**
- Purpose: CLI entry point using Commander
- Contains: Single `index.ts` that defines all subcommands
- Key file: `src/cli/index.ts` -- registers `init`, `doctor`, `index`, `search`, `status`, `context`, `ask` commands
- Pattern: Each command uses dynamic `import()` to lazy-load the corresponding workflow

**`src/lib/`**
- Purpose: Shared constants, types, and configuration
- Contains: No logic -- only type definitions and config values
- Key files:
  - `src/lib/config.ts` -- all constants (paths, timeouts, thresholds, defaults)
  - `src/lib/types.ts` -- Zod schemas (`CapabilityProfileSchema`, `CodeChunkSchema`, `IndexStateSchema`) and TypeScript interfaces (`RetrievedChunk`, `ContextResult`, `ContextMetadata`, `SearchOptions`)
- Note: `src/lib/index.ts` is an empty barrel export; imports go directly to `config.js` or `types.js`

**`src/mcp/`**
- Purpose: MCP server that exposes brain-cache as tools for Claude
- Contains: Single `index.ts` with 4 registered tools: `index_repo`, `search_codebase`, `build_context`, `doctor`
- Key file: `src/mcp/index.ts` -- uses `@modelcontextprotocol/sdk` with stdio transport
- Pattern: Each tool wraps a workflow function, adds guards (profile exists, Ollama running), returns structured JSON

**`src/services/`**
- Purpose: Low-level service modules -- each wraps a single external dependency or system concern
- Contains: Stateless functions that perform one job each
- Key files:
  - `src/services/capability.ts` -- GPU detection via `nvidia-smi`/`system_profiler`, profile read/write to `~/.brain-cache/profile.json`
  - `src/services/chunker.ts` -- tree-sitter parsing for TS/TSX/Python/Go/Rust, falls back to whole-file chunks
  - `src/services/crawler.ts` -- `fast-glob` file discovery, respects `.gitignore` via `ignore` package
  - `src/services/embedder.ts` -- `ollama.embed()` with timeout and cold-start retry
  - `src/services/lancedb.ts` -- LanceDB database/table operations, Apache Arrow schema, index state persistence
  - `src/services/logger.ts` -- Pino logger with `BRAIN_CACHE_LOG` env var control
  - `src/services/ollama.ts` -- Ollama binary checks, version detection, model pulling, process spawning
  - `src/services/retriever.ts` -- vector search, chunk deduplication, query intent classification
  - `src/services/tokenCounter.ts` -- Anthropic tokenizer wrapper for token counting and budget enforcement

**`src/tools/`**
- Purpose: Reserved for future MCP tool definitions or tool utilities
- Contains: Empty barrel export only (`src/tools/index.ts`)
- Status: Placeholder -- not currently used by any module

**`src/workflows/`**
- Purpose: High-level orchestration -- each workflow composes multiple services into a complete user-facing operation
- Contains: One file per CLI command / MCP tool
- Key files:
  - `src/workflows/init.ts` -- detect capabilities, install/start Ollama, pull embedding model, write profile
  - `src/workflows/doctor.ts` -- health check: Ollama, VRAM, profile, index freshness
  - `src/workflows/index.ts` -- full indexing pipeline: crawl -> chunk -> embed -> store -> write state
  - `src/workflows/search.ts` -- embed query -> vector search -> deduplicate -> return ranked chunks
  - `src/workflows/buildContext.ts` -- search + token-budget assembly into a context block
  - `src/workflows/askCodebase.ts` -- buildContext + send to Claude API for reasoning
  - `src/workflows/status.ts` -- read and display index stats
- Pattern: Workflows import from `services/` and `lib/`, never from each other (except `askCodebase` -> `buildContext`)

**`tests/`**
- Purpose: Unit tests mirroring the `src/` structure
- Contains: `.test.ts` files organized by layer (services, workflows, mcp)
- Pattern: Test file at `tests/{layer}/{module}.test.ts` corresponds to `src/{layer}/{module}.ts`

## Key File Locations

**Entry Points:**
- `src/cli/index.ts`: CLI binary entry -- built to `dist/cli.js` with shebang
- `src/mcp/index.ts`: MCP server entry -- built to `dist/mcp.js` (no shebang)

**Configuration:**
- `src/lib/config.ts`: Runtime constants (paths, timeouts, thresholds)
- `tsconfig.json`: TypeScript config (ES2022, Node16 module resolution, strict)
- `tsup.config.ts`: Build config (two entries: cli + mcp, ESM format, node20 target)
- `vitest.config.ts`: Test config (node environment, globals enabled)
- `.mcp.json`: Registers `brain-cache` MCP server (`node ./dist/mcp.js`)
- `.nvmrc`: Pins Node.js 22
- `.npmrc`: Sets `legacy-peer-deps=true`

**Type System:**
- `src/lib/types.ts`: All shared types and Zod schemas

**Core Logic:**
- `src/workflows/index.ts`: The main indexing pipeline (most complex workflow)
- `src/services/lancedb.ts`: Database layer -- schema definition, CRUD, state persistence
- `src/services/chunker.ts`: AST parsing with tree-sitter for multiple languages
- `src/services/retriever.ts`: Search and ranking logic

**Testing:**
- `tests/services/*.test.ts`: Service-level unit tests
- `tests/workflows/*.test.ts`: Workflow-level tests
- `tests/mcp/server.test.ts`: MCP tool integration test

## Naming Conventions

**Files:**
- `camelCase.ts` for all source files: `askCodebase.ts`, `tokenCounter.ts`, `buildContext.ts`
- `camelCase.test.ts` for test files: `askCodebase.test.ts`

**Directories:**
- `lowercase` plural for layer directories: `services/`, `workflows/`, `tools/`
- `lowercase` singular for specific concerns: `cli/`, `lib/`, `mcp/`

**Exports:**
- Named exports only (no default exports)
- Functions use `camelCase`: `runInit`, `runDoctor`, `runSearch`, `embedBatchWithRetry`
- Types use `PascalCase`: `CapabilityProfile`, `CodeChunk`, `RetrievedChunk`
- Constants use `UPPER_SNAKE_CASE`: `DEFAULT_BATCH_SIZE`, `EMBED_TIMEOUT_MS`

## Where to Add New Code

**New CLI Command:**
1. Create workflow at `src/workflows/{commandName}.ts`
2. Add command registration in `src/cli/index.ts` using dynamic `import()`
3. Add test at `tests/workflows/{commandName}.test.ts`

**New Service (wrapping an external dependency):**
1. Create service at `src/services/{serviceName}.ts`
2. Export named functions (stateless preferred)
3. Use `childLogger('{serviceName}')` for structured logging
4. Add test at `tests/services/{serviceName}.test.ts`

**New MCP Tool:**
1. Add `server.registerTool()` block in `src/mcp/index.ts`
2. Follow existing pattern: guard checks (profile, Ollama), try/catch, return `{ content: [{ type: 'text', text: JSON.stringify(result) }] }`
3. Add test in `tests/mcp/server.test.ts`

**New Shared Type or Schema:**
- Add to `src/lib/types.ts` (Zod schema + inferred TypeScript type)

**New Constant or Config Value:**
- Add to `src/lib/config.ts`

**New Utility Function:**
- If it wraps an external library: `src/services/{name}.ts`
- If it is a pure helper with no dependencies: `src/lib/{name}.ts` (and update barrel export)
- There is no dedicated `utils/` directory -- use `src/lib/` for pure helpers

## Special Directories

**`dist/`**
- Purpose: Build output from `tsup`
- Generated: Yes (via `npm run build`)
- Committed: No (gitignored)
- Contents: `cli.js` (with shebang, code-split), `mcp.js` (single bundle), shared chunks, `.d.ts` files
- Note: `cli.js` uses dynamic imports so workflow code is code-split into separate `chunk-*.js` and named `*.js` files

**`.brain-cache/` (project-level)**
- Purpose: Per-project data directory created by `brain-cache index`
- Generated: Yes (at runtime)
- Committed: No (gitignored)
- Contains: LanceDB database files, `index_state.json`

**`~/.brain-cache/` (global)**
- Purpose: Global configuration directory
- Generated: Yes (by `brain-cache init`)
- Committed: N/A (user home directory)
- Contains: `profile.json` (capability profile), `config.json`

**`.planning/`**
- Purpose: GSD workflow planning artifacts
- Generated: Yes (by GSD commands)
- Committed: No (gitignored)

**`.devcontainer/`**
- Purpose: Dev container configuration for Claude Code sandbox
- Generated: No
- Committed: No (gitignored)
- Contains: `devcontainer.json`, `Dockerfile`, `init-firewall.sh`

## Build Output Structure

The `tsup.config.ts` defines two entry points:

1. **`cli`** entry (`src/cli/index.ts` -> `dist/cli.js`):
   - Has `#!/usr/bin/env node` shebang banner
   - Code-split: workflow code lazy-loaded via dynamic `import()`
   - Registered as `bin.brain-cache` in `package.json`

2. **`mcp`** entry (`src/mcp/index.ts` -> `dist/mcp.js`):
   - No shebang (invoked via `node ./dist/mcp.js`)
   - Single larger bundle (~33KB) since MCP server imports all tools eagerly
   - Referenced in `.mcp.json` for Claude MCP registration

Both targets: ESM format, node20 target, `.d.ts` type declarations generated.

## Dependency Flow

```
cli/index.ts ──> workflows/* ──> services/* ──> lib/{config,types}
                                              ──> external packages (ollama, lancedb, etc.)

mcp/index.ts ──> workflows/* ──> services/* ──> lib/{config,types}
              ──> services/*                 ──> external packages
```

Rules:
- `cli/` imports only from `workflows/` (via dynamic import)
- `mcp/` imports from `workflows/` and `services/` (for guard checks)
- `workflows/` imports from `services/` and `lib/`
- `services/` imports from `lib/` and external packages
- `lib/` imports only from external packages (zod)
- No circular dependencies between layers

---

*Structure analysis: 2026-04-01*
