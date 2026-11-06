# Brain-cache

Brain-cache is a local context engine for Claude Code. It indexes source and documentation with Ollama embeddings and LanceDB, then exposes search and context assembly through MCP. Only the `ask` CLI workflow sends retrieved context to the Anthropic API.

## Development

Use Node.js >= 22.12.0 and install dependencies with `npm ci`.

- `npm run dev -- <command>` runs the CLI from TypeScript via tsx.
- `npm run build` bundles ESM CLI and MCP entries into `dist/` and copies the parser WASM assets.
- `npm run typecheck` checks source and test types.
- `npm test` runs the ordinary unit and integration suite without external services.
- `npm run test:distribution` builds and installs the package in temporary prefixes and tests CLI/MCP startup and bundled grammars. It requires registry access, but no Ollama service or Anthropic key.

## Architecture

- `src/cli/index.ts`: Commander CLI; delegates to workflows.
- `src/mcp/main.ts` and `src/mcp/server.ts`: stdio MCP entry point and tool registration.
- `src/workflows/`: initialization, indexing, retrieval, context assembly, and admin operations.
- `src/services/`: crawling, AST/doc chunking, embeddings, LanceDB, retrieval, token estimates, and session stats.
- `src/lib/`: shared types, configuration, validation, formatting, and generated setup content.
- `tests/`: behavior tests organized by subsystem, plus pipeline and distribution checks.

Project indexes live in `.brain-cache/`; new indexes use immutable generation directories selected by `active.json`, with legacy layouts readable until the next successful refresh. Readers resolve a snapshot once and pass its directory to storage operations. Index writers hold the lifecycle lock and publish only after all writes succeed. Old generations are retained until `clean`; the capability profile, configuration, and cumulative stats live in `~/.brain-cache/`.

`brain-cache init` writes `.mcp.json` using `process.execPath` and the installed package’s absolute `dist/mcp.js` path. There is no `mcp` CLI subcommand. It preserves an existing project skill file; merge packaged skill updates manually after backing up project customizations.

## Implementation rules

- Keep workflow orchestration separate from services; follow existing patterns and avoid unnecessary abstractions.
- Use TypeScript and ESM imports with `.js` extensions for local modules. Production runs the built JavaScript.
- Keep MCP stdout reserved for the protocol. Send diagnostics and logs to stderr.
- Keep indexing, search, and context assembly local. Handle CPU-only machines and preserve keyword fallback when Ollama is unavailable and an index exists.
- Treat token budgets and savings as estimates, not exact API usage or measured billing savings.
- Keep parser and grammar WASM versions compatible and run distribution checks when changing packaging or parser assets.
- Do not add LangChain, LlamaIndex, Vercel AI SDK, Postgres, or Redis dependencies. Use `@lancedb/lancedb`, not the old `vectordb` package; use tsx for development, not ts-node.

## Brain-Cache MCP Tools

Use brain-cache tools before reading files or using Grep/Glob for codebase questions.

| Query type | Tool | NOT this |
|-----------|------|---------|
| Locate a function, type, or symbol | `search_codebase` | `build_context` |
| Understand how specific code works across files | `build_context` | file reads |
| Diagnose brain-cache failures | `doctor` | -- |
| Reindex the project | `index_repo` | -- |

### search_codebase (locate code)

Call `mcp__brain-cache__search_codebase` to find functions, types, definitions, or implementations by meaning rather than keyword match.

Do NOT use for understanding how code works — use build_context once you have located the symbol.

### build_context (understand specific behavior)

Call `mcp__brain-cache__build_context` with a focused question about how specific code works. It retrieves semantically relevant code, deduplicates results, and fits them to a token budget.

Use for: "How does X work?", "What does this function do?", debugging unfamiliar code paths.

### doctor (diagnose issues)

Call `mcp__brain-cache__doctor` when any brain-cache tool fails or returns unexpected results.

### index_repo (reindex)

Call `mcp__brain-cache__index_repo` only when the user explicitly asks to reindex, or after major code changes. Do not call proactively.

### Hooks (enforcement)

`brain-cache init` installs PreToolUse hooks that fire when Claude uses `Grep`, `Glob`, `Read`, or `Agent`. Each hook injects a reminder to check brain-cache first. Hooks are advisory — they do not block execution.
