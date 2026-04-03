<!-- GSD:project-start source:PROJECT.md -->
## Project

**Braincache**

Braincache is a local AI runtime and tool layer for Claude that uses the developer's local GPU as a cache layer. It offloads low-value AI tasks (embeddings, retrieval, context preprocessing) to local models via Ollama, then sends only minimal, high-quality context to Claude for reasoning. Designed for developers who use Claude Code and want to reduce token usage while improving response quality.

**Core Value:** Reduce Claude token usage and improve response quality by running embeddings, retrieval, and context building locally — Claude only sees what matters.

### Constraints

- **Tech stack**: TypeScript (Node.js), Commander CLI, Ollama, Anthropic SDK, LanceDB
- **Architecture**: Workflows-first structure with strict folder layout (src/workflows/, src/services/, src/tools/, src/cli/, src/lib/)
- **Hardware**: Must gracefully handle machines with no GPU — fallback to CPU or defer to Claude
- **Complexity**: No over-abstraction, no unnecessary complexity, no premature generalization
<!-- GSD:project-end -->

<!-- GSD:stack-start source:research/STACK.md -->
## Technology Stack

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
# Core dependencies
# Runtime utilities
# Dev dependencies
### tsconfig.json baseline
### package.json scripts
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
### Do NOT use `chalk` v5+ if the project uses CJS modules
### Do NOT use LangChain or LlamaIndex
### Do NOT use Vercel AI SDK for Ollama
### Do NOT use `ts-node`
### Do NOT add a Postgres or Redis dependency
## Embedding Model Recommendations (Ollama)
| Model | Dimensions | Context | Best For | VRAM |
|-------|-----------|---------|---------|------|
| `nomic-embed-text` | 768 | 8,192 tokens | General code + text; beats OpenAI ada-002 | ~500MB |
| `mxbai-embed-large` | 1,024 | 512 tokens | High-accuracy retrieval on context-rich queries | ~670MB |
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
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

## Brain-Cache MCP Tools

Use brain-cache tools before reading files or using Grep/Glob for codebase questions.

| Query type | Tool | NOT this |
|-----------|------|---------|
| Locate a function, type, or symbol | `search_codebase` | `build_context` |
| Understand how specific code works across files | `build_context` | file reads |
| Trace a call path across files | `trace_flow` | `build_context` |
| Explain project architecture or structure | `explain_codebase` | `build_context` |
| Diagnose brain-cache failures | `doctor` | -- |
| Reindex the project | `index_repo` | -- |

### search_codebase (locate code)

Call `mcp__brain-cache__search_codebase` to find functions, types, definitions, or implementations by meaning rather than keyword match.

Do NOT use for understanding how code works — use build_context once you have located the symbol.

### build_context (understand specific behavior)

Call `mcp__brain-cache__build_context` with a focused question about how specific code works. It retrieves semantically relevant code, deduplicates results, and fits them to a token budget.

Use for: "How does X work?", "What does this function do?", debugging unfamiliar code paths.

Do NOT use for architecture overviews (use explain_codebase) or call-path tracing (use trace_flow).

### trace_flow (trace call paths)

Call `mcp__brain-cache__trace_flow` to trace how a function call propagates through the codebase. Returns structured hops showing the call chain across files.

Use for: "How does X flow to Y?", "Trace how X calls Y across files", "What happens when X is called?", "Call path from X to Y".

Do NOT use for code understanding queries like "how does X work" or "what does X do" — use build_context instead.

Use trace_flow instead of build_context when the question is about call propagation or execution flow across files.

### explain_codebase (architecture overview)

Call `mcp__brain-cache__explain_codebase` to get a module-grouped architecture overview. No follow-up question needed.

Use for: "Explain the project architecture", "How is this project structured?", "What does this project do?", "Give me an overview of the codebase".

Do NOT use for questions about specific code behavior or how a particular function works — use build_context instead.

Use explain_codebase instead of build_context when the question is about overall structure or getting oriented.

### doctor (diagnose issues)

Call `mcp__brain-cache__doctor` when any brain-cache tool fails or returns unexpected results.

### index_repo (reindex)

Call `mcp__brain-cache__index_repo` only when the user explicitly asks to reindex, or after major code changes. Do not call proactively.

## GSD Workflow Enforcement

<!-- GSD:workflow-start source:GSD defaults -->

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd:quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd:debug` for investigation and bug fixing
- `/gsd:execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->



<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd:profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
