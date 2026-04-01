# Technology Stack

**Analysis Date:** 2026-04-01

## Languages

**Primary:**
- TypeScript 5.x (`typescript: ^5.0.0`) - All source code in `src/`

**Secondary:**
- None - Pure TypeScript project

## Runtime

**Environment:**
- Node.js 20+ (tsup target: `node20`; no `.nvmrc` or `.node-version` present)
- ESM-only (`"type": "module"` in `package.json`)

**Package Manager:**
- npm (no yarn.lock or pnpm-lock.yaml present)
- Lockfile: package-lock.json expected but not verified in repo

## Frameworks

**Core:**
- Commander 14.0.3 (`commander: 14.0.3`) - CLI framework, pinned exact version
- `@modelcontextprotocol/sdk` ^1.29.0 - MCP server for tool exposure to Claude

**Testing:**
- Vitest ^2.0.0 - Test runner, native ESM + TypeScript support

**Build/Dev:**
- tsup ^8.0.0 - Build/bundle tool producing ESM output
- tsx 4.21.0 - Dev-time TypeScript runner (pinned exact)

## Key Dependencies

**Critical (runtime core):**
- `ollama` ^0.6.3 - Official Ollama JS client for local embedding via GPU
- `@lancedb/lancedb` ^0.27.1 - Embedded vector database, disk-backed, no external server
- `apache-arrow` ^18.1.0 - Arrow schema definitions for LanceDB table creation
- `@anthropic-ai/sdk` ^0.81.0 - Claude API client for the `ask` command
- `@anthropic-ai/tokenizer` ^0.0.4 - Local token counting without API round-trip
- `zod` ^4.3.6 - Schema validation (v4, 14x faster than v3)

**Code Parsing:**
- `tree-sitter` ^0.25.0 - AST parser for chunking source files
- `tree-sitter-typescript` ^0.23.2 - TypeScript/TSX/JS/JSX grammar
- `tree-sitter-python` ^0.25.0 - Python grammar
- `tree-sitter-go` ^0.25.0 - Go grammar
- `tree-sitter-rust` ^0.24.0 - Rust grammar

**Infrastructure:**
- `pino` ^9.0.0 - Structured JSON logging to stderr
- `fast-glob` ^3.3.3 - File system crawling for source file discovery
- `ignore` ^7.0.5 - `.gitignore` pattern matching

**Dev Dependencies:**
- `@types/node` ^22.0.0 - Node.js type definitions
- `pino-pretty` ^11.0.0 - Dev-time log formatting
- `tsup` ^8.0.0 - Build tool
- `tsx` 4.21.0 - Dev TypeScript runner
- `typescript` ^5.0.0 - Compiler
- `vitest` ^2.0.0 - Test framework

## Configuration

**TypeScript (`tsconfig.json`):**
- Target: ES2022
- Module system: Node16 (module + moduleResolution)
- Strict mode: enabled
- Source maps: enabled
- Declaration files: enabled with declaration maps
- Root: `src/`, Output: `dist/`
- Excludes: `node_modules`, `dist`, `tests`

**Build (`tsup.config.ts`):**
- Two entry points built separately:
  1. `src/cli/index.ts` -> `dist/cli.js` (ESM, with `#!/usr/bin/env node` shebang, dts, clean)
  2. `src/mcp/index.ts` -> `dist/mcp.js` (ESM, dts, no clean)
- Target: node20
- Format: ESM only

**Environment Variables:**
- `ANTHROPIC_API_KEY` - Required for `ask` command (Claude API)
- `BRAIN_CACHE_CLAUDE_MODEL` - Optional Claude model override (default: `claude-sonnet-4-20250514`)
- `BRAIN_CACHE_LOG` - Log level control: `debug`, `info`, `warn`, `error`, `silent` (default: `warn`)

**npm Scripts (`package.json`):**
```bash
npm run dev          # tsx src/cli/index.ts (dev mode)
npm run build        # tsup (production build)
npm run link         # npm link (local CLI install)
npm test             # vitest run (single run)
npm run test:watch   # vitest (watch mode)
```

**Binary:**
- `brain-cache` CLI exposed via `"bin"` field pointing to `./dist/cli.js`

## Platform Requirements

**Development:**
- Node.js 20+
- Ollama installed and running locally (for embedding operations)
- GPU optional - gracefully degrades to CPU via Ollama

**Production/User Machine:**
- Node.js 20+
- Ollama binary installed (`ollama serve` running)
- Embedding model pulled (handled by `brain-cache init`)
- ANTHROPIC_API_KEY set (only for `ask` command)

**Supported Platforms:**
- macOS (Apple Silicon detection via `system_profiler`)
- Linux (NVIDIA GPU detection via `nvidia-smi`)
- Windows (partial - `where` used for binary detection)

## Notable Technology Decisions

1. **tree-sitter loaded via `createRequire`** - tree-sitter packages are CJS-only, loaded through `createRequire(import.meta.url)` in `src/services/chunker.ts` to work in ESM context
2. **Pinned Commander version** - `commander: 14.0.3` is exact (not caret) for CLI stability
3. **Pino logs to stderr** - All logging goes to fd 2 via `pino.destination(2)` in `src/services/logger.ts`, keeping stdout clean for MCP stdio transport
4. **No database server** - LanceDB is embedded, stores data at `<projectRoot>/.brain-cache/index/`
5. **No LangChain/LlamaIndex** - Direct SDK usage for all integrations per project constraints

---

*Stack analysis: 2026-04-01*
