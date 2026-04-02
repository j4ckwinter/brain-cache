# Coding Conventions

**Analysis Date:** 2026-04-01

## Naming Patterns

**Files:**
- Use camelCase for all source files: `buildContext.ts`, `tokenCounter.ts`, `askCodebase.ts`
- Use camelCase for test files matching source: `buildContext.test.ts`, `tokenCounter.test.ts`
- Barrel files are always `index.ts`

**Functions:**
- Use camelCase: `embedBatch`, `classifyQueryIntent`, `crawlSourceFiles`
- Prefix workflow entry points with `run`: `runInit`, `runIndex`, `runSearch`, `runBuildContext`, `runStatus`, `runDoctor`
- Prefix detection/check functions with `is`/`detect`/`get`: `isOllamaRunning`, `detectNvidiaVRAM`, `getOllamaHost`
- Internal helpers use camelCase without prefix: `hashContent`, `extractName`, `walkNodes`

**Variables:**
- Use camelCase for variables: `queryVector`, `rootDir`, `rowCount`
- Use UPPER_SNAKE_CASE for module-level constants: `EMBED_TIMEOUT_MS`, `DEFAULT_BATCH_SIZE`, `SOURCE_EXTENSIONS`
- Use UPPER_SNAKE_CASE for exported constant collections: `LANGUAGE_MAP`, `CHUNK_NODE_TYPES`, `RETRIEVAL_STRATEGIES`

**Types:**
- Use PascalCase for interfaces and type aliases: `CapabilityProfile`, `RetrievedChunk`, `CodeChunk`
- Zod schemas use PascalCase with `Schema` suffix: `CapabilityProfileSchema`, `CodeChunkSchema`, `IndexStateSchema`
- Types are derived from Zod schemas via `z.infer`: `type CodeChunk = z.infer<typeof CodeChunkSchema>`
- Union literal types use lowercase strings: `'none' | 'standard' | 'large'`, `'diagnostic' | 'knowledge'`
- Use `interface` for object shapes without Zod schema: `SearchOptions`, `ContextMetadata`, `BuildContextOptions`

## Code Style

**Formatting:**
- No Prettier or ESLint config files. Formatting is manually maintained.
- Indentation: 2 spaces
- Semicolons: always present
- Quotes: single quotes for imports and strings
- Trailing commas: used in multi-line arrays and objects
- Aligned property values in Zod schemas and object literals using whitespace:
  ```typescript
  id:         z.string(),
  filePath:   z.string(),
  chunkType:  z.enum(['function', 'class', 'method', 'file']),
  ```

**TypeScript Strictness:**
- `strict: true` in `tsconfig.json`
- `forceConsistentCasingInFileNames: true`
- Target: ES2022, Module: Node16, ModuleResolution: Node16
- All source code uses ESM (`"type": "module"` in `package.json`)

## Import Organization

**Order:**
1. Node.js built-in modules with `node:` prefix: `import { readFile } from 'node:fs/promises'`
2. Third-party packages: `import ollama from 'ollama'`, `import { z } from 'zod'`
3. Local imports with `.js` extension: `import { childLogger } from './logger.js'`
4. Type-only imports use `import type`: `import type { Table } from '@lancedb/lancedb'`

**Critical rules:**
- Always use `node:` prefix for Node.js built-ins: `node:path`, `node:fs/promises`, `node:child_process`
- Always use `.js` extension on local imports (required by Node16 module resolution): `'../lib/config.js'`
- Type-only imports use `import type` keyword
- No path aliases -- all imports are relative

## Error Handling

**1. Return null for missing/invalid data (services):**
Services that read optional state return `null` rather than throwing:
```typescript
// src/services/capability.ts
export async function readProfile(): Promise<CapabilityProfile | null> {
  try {
    const raw = await readFile(PROFILE_PATH, 'utf-8');
    const result = CapabilityProfileSchema.safeParse(JSON.parse(raw));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
```

**2. Throw with actionable messages (workflows):**
Workflows validate preconditions and throw descriptive errors with fix instructions:
```typescript
// src/workflows/buildContext.ts
if (profile === null) {
  throw new Error("No profile found. Run 'brain-cache init' first.");
}
if (!running) {
  throw new Error("Ollama is not running. Start it with 'ollama serve' or run 'brain-cache init'.");
}
```

**3. Return isError objects (MCP tools):**
MCP tool handlers return structured error responses instead of throwing:
```typescript
// src/mcp/index.ts
if (!profile) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: "No capability profile found. Run 'brain-cache init' first." }],
  };
}
```

**4. Silent catch for non-critical operations:**
Empty catch blocks used only when failure is expected and non-critical:
```typescript
// src/services/ollama.ts
try {
  await execFileAsync(cmd, ['ollama']);
  return true;
} catch {
  return false;
}
```

**5. Retry with backoff for transient failures:**
Connection errors to Ollama get a single retry with delay (cold-start pattern):
```typescript
// src/services/embedder.ts
if (attempt === 0 && isConnectionError(err)) {
  log.warn({ model }, 'Ollama cold-start suspected, retrying in 5s');
  await new Promise<void>((r) => setTimeout(r, COLD_START_RETRY_DELAY_MS));
  return embedBatchWithRetry(model, texts, dimension, 1);
}
```

**6. Context-length fallback:**
Batch embedding failures from oversized input fall back to individual embedding per text:
```typescript
// src/services/embedder.ts
if (isContextLengthError(err)) {
  // Fall back to one-at-a-time embedding; replace still-too-large chunks with zero vectors
}
```

**7. Zod safeParse for external data validation:**
Use `safeParse` (not `parse`) when reading data from disk -- never crash on corrupted files:
```typescript
const result = CapabilityProfileSchema.safeParse(JSON.parse(raw));
return result.success ? result.data : null;
```

## Logging

**Framework:** pino (structured JSON to stderr)

**Setup pattern -- every service file creates a child logger:**
```typescript
// Top of each service file
import { childLogger } from './logger.js';
const log = childLogger('embedder');

// Structured logging: context object first, message string second
log.debug({ model, batchSize: texts.length }, 'Embedding batch');
log.warn({ model }, 'Ollama cold-start suspected, retrying in 5s');
log.info({ rootDir, fileCount: result.length }, 'Crawl complete');
```

**Log level control:**
- Default: `warn` (minimal output)
- Set via `BRAIN_CACHE_LOG` env var: `debug`, `info`, `warn`, `error`, `silent`
- Secret redaction configured for: `apiKey`, `api_key`, `secret`, `password`, `token`, `authorization`

**User-facing output:**
- All user-facing output goes to `process.stderr.write()` (not console.log, not logger)
- stdout is reserved exclusively for machine-readable data (JSON via `--raw` flag)
- Progress messages use `\r` for in-place updates: `\rbrain-cache: embedding 15/42 chunks (36%)`
- This is called the "D-16 rule" in comments throughout the codebase

## Comments

**When to Comment:**
- JSDoc on all exported functions with `@param` tags for non-obvious parameters
- Inline comments for non-obvious logic, especially workarounds
- Reference design decision IDs: `// per D-16`, `// per D-07`, `// per D-08`
- Reference debt/perf tracking IDs: `// PERF-02`, `// DEBT-06`, `// DEBT-04`
- Explain "why" not "what"

**JSDoc pattern:**
```typescript
/**
 * Brief description of what the function does.
 * Additional context about behavior edge cases.
 *
 * @param model   - Ollama model name (e.g. 'nomic-embed-text')
 * @param texts   - Array of text strings to embed in one batch
 */
export async function embedBatch(model: string, texts: string[]): Promise<number[][]> {
```

**Workaround comments include removal criteria:**
```typescript
// CJS require workaround for tree-sitter packages.
// ...
// This workaround can be removed when:
//   - tree-sitter ships an ESM entry point (tracked in tree-sitter >= 0.24.0), OR
//   - the project migrates to web-tree-sitter (WASM-based)
```

## Function Design

**Size:** Functions are generally short (under 50 lines). Workflow orchestrators (`runIndex` at ~300 lines) are the exception, broken into clearly numbered steps with comments.

**Parameters:**
- Use options objects for functions with 2+ optional parameters: `opts: { maxTokens?: number; limit?: number; path?: string }`
- Use default values from config constants: `timeoutMs: number = EMBED_TIMEOUT_MS`
- Use explicit types, never `any` in source (only in test mocks)

**Return Values:**
- Async functions have explicitly annotated return types: `Promise<boolean>`, `Promise<number | null>`
- Use `null` (not `undefined`) for "not found" semantics
- Workflows that produce data return typed results: `runSearch -> RetrievedChunk[]`, `runBuildContext -> ContextResult`
- Workflows that only produce output return `void` and write to stderr

## Module Design

**Exports:**
- Named exports only -- no default exports in source code
- Exception: `ollama` and `pino` are imported as default (third-party convention)

**Barrel Files:**
- `src/services/index.ts` -- re-exports all service APIs with explicit named re-exports
- `src/lib/index.ts` -- re-exports all types and config constants
- `src/tools/index.ts` -- intentionally empty placeholder (documented with `DEBT-04` comment)
- Barrel files use explicit `export { foo } from './bar.js'`, not `export * from`

**Module boundaries:**
- `src/lib/` -- pure data: types, schemas, config constants (no I/O, no side effects)
- `src/services/` -- single-responsibility modules with I/O (each gets a child logger)
- `src/workflows/` -- orchestrators that compose services (contain `process.stderr.write` for user output)
- `src/mcp/` -- MCP server registration (imports from services and workflows)
- `src/cli/` -- Commander CLI registration (lazy-imports workflows via dynamic `import()`)

**CLI lazy imports pattern (reduces startup time):**
```typescript
// src/cli/index.ts
program.command("init").action(async () => {
  const { runInit } = await import("../workflows/init.js");
  await runInit();
});
```

## Data Conventions

**Casing boundaries:**
- TypeScript types/interfaces use camelCase properties: `filePath`, `chunkType`, `startLine`
- LanceDB/Arrow schema uses snake_case columns: `file_path`, `chunk_type`, `start_line`
- Conversion happens at the service boundary (`src/services/retriever.ts` maps snake_case to camelCase)

**Schema validation:**
- All persisted data has a Zod schema in `src/lib/types.ts`
- Schemas are defined alongside their types: `export const FooSchema = z.object({...}); export type Foo = z.infer<typeof FooSchema>;`
- MCP tool input schemas use Zod directly (not JSON Schema)

**Configuration constants:**
- All magic numbers live in `src/lib/config.ts`
- Constants are exported individually (not as a config object)
- Numeric separators used for readability: `10_000`, `120_000`

## Workflow Step Pattern

Workflow files follow a numbered-step pattern with comments:
```typescript
export async function runBuildContext(query: string, opts?: BuildContextOptions): Promise<ContextResult> {
  // 1. Read profile
  const profile = await readProfile();
  if (profile === null) { throw new Error("..."); }

  // 2. Check Ollama
  const running = await isOllamaRunning();
  if (!running) { throw new Error("..."); }

  // 3. Resolve project root and read index state
  // ...
}
```

## Build-Time Injection

Version string injected at build time via `tsup.config.ts` and `vitest.config.ts`:
```typescript
// src/types/globals.d.ts
declare const __BRAIN_CACHE_VERSION__: string;

// src/cli/index.ts
const version = __BRAIN_CACHE_VERSION__;
```

---

*Convention analysis: 2026-04-01*
