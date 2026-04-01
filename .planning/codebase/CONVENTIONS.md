# Coding Conventions

**Analysis Date:** 2026-04-01

## Naming Patterns

**Files:**
- Use camelCase for all source files: `tokenCounter.ts`, `askCodebase.ts`, `buildContext.ts`
- Use camelCase for test files matching source: `tokenCounter.test.ts`, `askCodebase.test.ts`
- Use `index.ts` as barrel/entry point per directory: `src/cli/index.ts`, `src/mcp/index.ts`, `src/services/index.ts`

**Functions:**
- Use camelCase for all functions: `embedBatch`, `crawlSourceFiles`, `classifyQueryIntent`
- Prefix workflow orchestrators with `run`: `runInit`, `runIndex`, `runSearch`, `runBuildContext`, `runAskCodebase`, `runDoctor`, `runStatus`
- Prefix detection functions with `detect` or `is`: `detectNvidiaVRAM`, `isOllamaInstalled`, `isOllamaRunning`
- Use descriptive verb-noun patterns: `pullModelIfMissing`, `openOrCreateChunkTable`, `writeIndexState`

**Variables:**
- Use camelCase for all variables: `queryVector`, `allChunks`, `totalRawTokens`
- Use UPPER_SNAKE_CASE for module-level constants: `DEFAULT_BATCH_SIZE`, `EMBED_TIMEOUT_MS`, `DIAGNOSTIC_KEYWORDS`
- Prefix mock variables with `mock` in tests: `mockReadProfile`, `mockIsOllamaRunning`

**Types:**
- Use PascalCase for all types and interfaces: `CapabilityProfile`, `CodeChunk`, `RetrievedChunk`, `SearchOptions`
- Use PascalCase with `Schema` suffix for Zod schemas: `CapabilityProfileSchema`, `CodeChunkSchema`, `IndexStateSchema`
- Derive TypeScript types from Zod schemas with `z.infer`: `export type CodeChunk = z.infer<typeof CodeChunkSchema>;`
- Use string literal union types for enums: `type VRAMTier = 'none' | 'standard' | 'large'`
- Use `interface` for object shapes with no Zod schema: `SearchOptions`, `ContextMetadata`, `ContextResult`

## Code Style

**Formatting:**
- No project-level Prettier or ESLint configuration detected
- 2-space indentation throughout all source and test files
- Single quotes for string literals
- Trailing commas in multi-line structures
- Semicolons required at end of statements
- Aligned property values in object literals using whitespace (seen in `src/lib/types.ts`, `src/services/lancedb.ts`):
  ```typescript
  id:         z.string(),
  filePath:   z.string(),
  chunkType:  z.enum(['function', 'class', 'method', 'file']),
  ```

**Linting:**
- No ESLint config at project root
- TypeScript strict mode enabled in `tsconfig.json` (`"strict": true`)

## Import Organization

**Order:**
1. Node.js built-in modules with `node:` prefix: `import { readFile } from 'node:fs/promises';`
2. External npm packages: `import ollama from 'ollama';`
3. Internal project imports using relative paths with `.js` extension: `import { childLogger } from './logger.js';`
4. Type-only imports use `import type`: `import type { CodeChunk, IndexState } from '../lib/types.js';`

**Critical rules:**
- Always use the `node:` prefix for Node.js builtins: `node:path`, `node:os`, `node:fs/promises`, `node:child_process`, `node:util`
- Always use `.js` extension on relative imports (required by Node16 module resolution): `'./logger.js'`, `'../lib/config.js'`
- Separate runtime imports from type-only imports

**Path Aliases:**
- None configured. All imports use relative paths.

## Module System

**ESM only:**
- `"type": "module"` in `package.json`
- `"module": "Node16"` and `"moduleResolution": "Node16"` in `tsconfig.json`
- `format: ['esm']` in `tsup.config.ts`
- tree-sitter packages loaded via CJS bridge pattern using `createRequire`:
  ```typescript
  const _require = createRequire(import.meta.url);
  const Parser = _require('tree-sitter');
  ```

## Export Patterns

**Named exports only:**
- All source modules use named exports exclusively: `export function`, `export async function`, `export const`, `export type`
- No default exports anywhere in project source code
- The `ollama` npm package is the only default import: `import ollama from 'ollama';`

**Barrel files:**
- `src/lib/index.ts`, `src/services/index.ts`, `src/tools/index.ts` exist as empty barrel files (`export {};`)
- They are not used for re-exports; consumers import directly from specific files

## Error Handling

**Patterns:**
- Use try/catch with swallowed errors returning fallback values for optional operations:
  ```typescript
  try {
    const raw = await readFile(statePath, 'utf-8');
    const parsed = IndexStateSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
  ```
- Use Zod `safeParse` for validation, returning `null` on failure (not throwing)
- Workflow functions call `process.exit(1)` for fatal precondition failures (missing profile, Ollama not running, no index)
- MCP tool handlers return `{ isError: true, content: [...] }` instead of throwing -- never call `process.exit()`
- The `embedBatchWithRetry` function implements a single cold-start retry for transient connection errors (ECONNRESET, ECONNREFUSED)
- Error messages are written to stderr via `process.stderr.write()` before calling `process.exit(1)`
- Bare `catch` blocks (no error variable) are used when error details are not needed

## Output Conventions (D-16 Rule)

**All CLI output goes to stderr:**
- Every workflow function writes progress and status to `process.stderr.write()`
- stdout is reserved exclusively for machine-readable output (JSON) -- only the `context` CLI command writes to stdout
- The `ask` command writes the answer to stderr
- MCP server tools return JSON via the MCP protocol, not stdout/stderr

## Logging

**Framework:** pino (structured JSON logging to stderr)

**Configuration:**
- Logger defined in `src/services/logger.ts`
- Log level controlled by `BRAIN_CACHE_LOG` environment variable
- Valid levels: `debug`, `info`, `warn`, `error`, `silent`
- Default level: `warn` (when env var is unset or invalid)
- Output target: stderr (fd 2) via `pino.destination(2)`

**Patterns:**
- Create child loggers per component using `childLogger(componentName)`:
  ```typescript
  import { childLogger } from './logger.js';
  const log = childLogger('embedder');
  ```
- Use structured logging with context objects:
  ```typescript
  log.debug({ model, batchSize: texts.length }, 'Embedding batch');
  log.info({ model, dim }, 'Created new chunks table');
  log.warn({ model }, 'Ollama cold-start suspected, retrying in 5s');
  ```
- The first argument is always a context object, the second is the message string
- Use `log.debug` for internal operations, `log.info` for significant lifecycle events, `log.warn` for recoverable issues

## TypeScript Usage

**Strict mode:**
- Full strict mode enabled: `"strict": true`
- Target: ES2022

**Type inference over annotation:**
- Return types are explicitly annotated on exported functions: `Promise<boolean>`, `Promise<number | null>`, `Promise<CapabilityProfile>`
- Local variables rely on type inference
- Use `as const` for literal type assertions in test mock objects: `version: 1 as const`, `vramTier: 'large' as const`

**Zod-first type definitions:**
- Define Zod schema first, then derive the TypeScript type:
  ```typescript
  export const CapabilityProfileSchema = z.object({ ... });
  export type CapabilityProfile = z.infer<typeof CapabilityProfileSchema>;
  ```
- Used for all data that crosses serialization boundaries (profile JSON, index state JSON, code chunks)
- Plain interfaces used for internal-only types: `SearchOptions`, `BuildContextOptions`, `AskCodebaseOptions`

**Generics:**
- Minimal use of generics. The codebase favors concrete types.

**`any` usage:**
- tree-sitter AST node parameters typed as `any` in `src/services/chunker.ts` (the tree-sitter library lacks TypeScript types)
- LanceDB query result rows cast with `(r: any)` in `src/services/retriever.ts`
- Mock objects in tests typed as `any` when LanceDB types are complex

## Function Design

**Size:** Functions are focused and typically under 50 lines. Workflow orchestrators (`runInit`, `runIndex`) are the longest at ~90 lines due to sequential steps.

**Parameters:**
- Use options objects for functions with 2+ optional parameters:
  ```typescript
  export async function runSearch(query: string, opts?: SearchRunOptions): Promise<RetrievedChunk[]>
  ```
- Use positional parameters for functions with 1-2 required parameters:
  ```typescript
  export async function embedBatch(model: string, texts: string[], timeoutMs?: number): Promise<number[][]>
  ```

**Return Values:**
- Use `null` for "not found" semantics: `readProfile(): Promise<CapabilityProfile | null>`
- Use `boolean` for success/failure checks: `isOllamaInstalled(): Promise<boolean>`
- Workflows that produce output return void and write to stderr
- Workflows that produce data return typed results: `runSearch -> RetrievedChunk[]`, `runBuildContext -> ContextResult`

## Code Organization Within Files

**Service files follow this structure:**
1. Imports (node builtins, npm packages, internal modules)
2. Module-level constants and child logger
3. Helper/utility functions (private, not exported)
4. Exported functions in order of dependency

**Workflow files follow this structure:**
1. Imports
2. Interface definitions for options/results (if any)
3. Single exported `run*` function with numbered step comments:
   ```typescript
   // Step 1: Resolve path
   // Step 2: Read profile
   // Step 3: Check Ollama is running
   ```

## Documentation

**JSDoc comments:**
- All exported functions have JSDoc `/** ... */` documentation
- JSDoc describes what the function does, not implementation details
- `@param` tags used when parameter names are not self-documenting
- Internal helper functions have single-line `//` comments explaining purpose

**Inline comments:**
- Numbered step comments in workflow functions for traceability
- Design decision references using codes: `// per D-16`, `// per D-08`, `// CLD-02`
- Inline threshold explanations for magic numbers:
  ```typescript
  export const DEFAULT_DISTANCE_THRESHOLD = 0.3; // cosine distance; 0.3 = 0.7 similarity
  ```

---

*Convention analysis: 2026-04-01*
