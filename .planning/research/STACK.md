# Stack Research

**Domain:** Local AI Runtime / Code Intelligence (Braincache)
**Researched:** 2026-03-31
**Confidence:** HIGH (core stack), MEDIUM (supporting libraries)

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Node.js | 22.x LTS | Runtime | LTS with native TypeScript strip-types stable in 22.18+; avoids tsx/ts-node in production |
| TypeScript | 5.x | Language | Required for type-safe MCP tool schemas, LanceDB types, Zod integration |
| `@lancedb/lancedb` | 0.27.1 | Vector storage | Embedded (no server), disk-backed, TypeScript-native, only embedded vector DB with TS library + local disk |
| `ollama` | 0.6.3 | Local LLM/embedding client | Official Ollama JS library; supports embeddings, streaming, full HTTP API parity |
| `@modelcontextprotocol/sdk` | 1.29.0 | MCP server | Official MCP TypeScript SDK; 37k+ downstream projects, stdio + Streamable HTTP transports |
| `@anthropic-ai/sdk` | 0.80.0 | Claude API client | Official SDK; streaming, token counting beta API, automatic retries |
| `commander` | 14.0.3 | CLI framework | 500M+ downloads/week, zero overhead, strong TypeScript types, best for tools with discrete subcommands |
| `zod` | 4.x | Schema validation | 14x faster parsing than v3, required for MCP tool input validation; v4 now stable |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `tsx` | 4.21.0 | Dev-time TypeScript runner | `npm run dev` / watch mode only — replaces ts-node, esbuild-backed, ESM-aware |
| `tsup` | latest | Build/bundle | Produces CJS + ESM output for the CLI binary and MCP server entry; zero-config |
| `pino` | latest | Structured logging | 5x faster than Winston, JSON by default, low overhead — critical for a runtime that runs in background |
| `@anthropic-ai/tokenizer` | latest | Local token counting | Count tokens without API round-trip; used for context budget tracking in context builder |
| `vitest` | latest | Testing | Native TypeScript + ESM, 10-20x faster than Jest, no Babel config needed |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| `tsx` | Run `.ts` files directly in dev | Use `tsx watch src/index.ts` for development loop |
| `tsup` | Compile to distributable | Outputs `dist/` with ESM + CJS + `.d.ts`; used in `npm run build` |
| Node.js 22.18+ native strip-types | Run TypeScript in production without build step | Viable for CLI entry point in Node 22.18+; still use tsup for npm publish |
| `@types/node` | Node.js type definitions | Required for `fs`, `path`, `child_process` types |
| ESLint + `@typescript-eslint` | Linting | Standard TS linting; pair with Prettier for formatting |

## Installation

```bash
# Core dependencies
npm install @lancedb/lancedb ollama @modelcontextprotocol/sdk @anthropic-ai/sdk commander zod

# Runtime utilities
npm install pino @anthropic-ai/tokenizer

# Dev dependencies
npm install -D typescript tsx tsup vitest @types/node @typescript-eslint/eslint-plugin @typescript-eslint/parser eslint prettier
```

### tsconfig.json baseline

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

### package.json scripts

```json
{
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsup src/index.ts src/mcp/server.ts --format cjs,esm --dts",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  }
}
```

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Vector DB | `@lancedb/lancedb` | ChromaDB | Chroma requires a separate Python server; no embedded TS library; operational overhead violates "no external servers" constraint |
| Vector DB | `@lancedb/lancedb` | hnswlib-node | In-memory only (no persistence without manual serialization); no hybrid search; not a database |
| Vector DB | `@lancedb/lancedb` | pgvector | Requires PostgreSQL server; massive overhead for a local developer tool |
| Local models | `ollama` npm | Direct HTTP `fetch` | Official library handles streaming, error handling, connection pooling; no reason to hand-roll |
| CLI | `commander` | `oclif` | Oclif adds 70-100ms startup overhead — unacceptable for a dev tool called frequently; plugin architecture is out of scope |
| CLI | `commander` | `yargs` | TypeScript async command typing is painful in yargs; Commander 14 has cleaner types |
| Logging | `pino` | `winston` | Winston is 5x slower, not optimized for background service; pino's JSON default fits structured telemetry |
| Testing | `vitest` | `jest` | Jest requires Babel or ts-jest for TypeScript; vitest works natively with zero config |
| Validation | `zod` v4 | `zod` v3 | v4 is stable (released 2025), 14x faster parsing, smaller bundle; use v4 |
| Token counting | `@anthropic-ai/tokenizer` | `tiktoken` | tiktoken is for OpenAI tokenizers; Anthropic has its own tokenizer and a `messages.countTokens` API |
| Build | `tsup` | `esbuild` directly | tsup wraps esbuild with good defaults for dual CJS/ESM output and `.d.ts` generation |
| Runtime | `tsx` (dev) / `tsup` (prod) | `ts-node` | ts-node has broken ESM support in Node 20+; tsx is the maintained successor |

## What NOT to Use

### Do NOT use `vectordb` (the old LanceDB package)
The `vectordb` npm package is the deprecated predecessor to `@lancedb/lancedb`. It uses a different API and is no longer maintained. Always use `@lancedb/lancedb`.

### Do NOT use `chalk` v5+ if the project uses CJS modules
Chalk 5.x is ESM-only. If the build outputs CJS (which tsup does by default for CLI binaries), `require('chalk')` will throw. Either keep the project fully ESM or use `chalk` v4.x. Given the MCP server must support stdio transport (which is CommonJS-friendly), consider using `picocolors` instead — it's tiny, CJS+ESM compatible, and has no ESM gotchas.

### Do NOT use LangChain or LlamaIndex
These frameworks add enormous abstraction over exactly what Braincache is doing manually. They fight against the "no over-abstraction" constraint, bring heavyweight dependency trees, and hide the embedding/retrieval logic that Braincache needs to control precisely for token optimization.

### Do NOT use Vercel AI SDK for Ollama
The `ai` SDK (Vercel) and its Ollama community provider are designed for web streaming use cases. The official `ollama` npm package speaks directly to the Ollama HTTP API, has better TypeScript types for embeddings, and matches the Ollama documentation 1:1.

### Do NOT use `ts-node`
Broken ESM support in Node 20+. Use `tsx` for development and `tsup` for production builds.

### Do NOT add a Postgres or Redis dependency
This is a local developer tool. Any dependency requiring an external server violates the core design constraint. LanceDB's embedded disk storage covers all persistence needs.

## Embedding Model Recommendations (Ollama)

These are the models to recommend to users for `ollama pull`:

| Model | Dimensions | Context | Best For | VRAM |
|-------|-----------|---------|---------|------|
| `nomic-embed-text` | 768 | 8,192 tokens | General code + text; beats OpenAI ada-002 | ~500MB |
| `mxbai-embed-large` | 1,024 | 512 tokens | High-accuracy retrieval on context-rich queries | ~670MB |

**Default recommendation:** `nomic-embed-text` — larger context window (8k tokens vs 512) is critical for code files. Fall back to CPU-only for machines without GPU.

## Sources

- [@lancedb/lancedb npm](https://www.npmjs.com/package/@lancedb/lancedb) — v0.27.1 confirmed, published ~March 2026
- [LanceDB GitHub](https://github.com/lancedb/lancedb) — embedded TS library, disk-backed, no external server
- [ollama npm](https://www.npmjs.com/package/ollama) — v0.6.3 official JS library
- [Ollama embeddings docs](https://docs.ollama.com/capabilities/embeddings) — embed API confirmed
- [@modelcontextprotocol/sdk npm](https://www.npmjs.com/package/@modelcontextprotocol/sdk) — v1.29.0, 37k+ dependents
- [@anthropic-ai/sdk GitHub](https://github.com/anthropics/anthropic-sdk-typescript) — v0.80.0
- [Anthropic token counting API](https://docs.anthropic.com/en/api/messages-count-tokens) — `messages.countTokens` in beta
- [commander npm](https://www.npmjs.com/package/commander) — v14.0.3, 123k+ dependents
- [tsx GitHub](https://github.com/privatenumber/tsx) — v4.21.0, esbuild-backed Node.js TS runner
- [Node.js TypeScript docs](https://nodejs.org/api/typescript.html) — native strip-types stable in 22.18+
- [Zod v4 release](https://zod.dev/v4) — stable, 14x faster parsing
- [Vitest vs Jest comparison](https://betterstack.com/community/guides/scaling-nodejs/vitest-vs-jest/) — 10-20x faster, native ESM
- [Pino vs Winston](https://betterstack.com/community/guides/scaling-nodejs/pino-vs-winston/) — 5x faster, JSON default
- [Ollama embedding models](https://ollama.com/blog/embedding-models) — nomic-embed-text, mxbai-embed-large
- [LanceDB vs ChromaDB](https://zilliz.com/comparison/chroma-vs-lancedb) — embedded comparison
- [Chalk ESM issue](https://github.com/chalk/chalk/issues/281) — CJS incompatibility in v5+
