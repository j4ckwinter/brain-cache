# Phase 2: Storage and Indexing - Research

**Researched:** 2026-03-31
**Domain:** LanceDB embedded vector storage, tree-sitter AST chunking, Ollama batch embeddings, file crawling
**Confidence:** HIGH

## Summary

Phase 2 builds the full indexing pipeline: crawl source files, chunk them at AST function/class/method boundaries, batch-embed via Ollama, and store in LanceDB with metadata. Four technical systems must integrate: (1) a file crawler that respects `.gitignore` and a hardcoded exclusion list, (2) a tree-sitter AST parser covering TypeScript, JavaScript, Python, Go, and Rust, (3) a batched Ollama embed caller with 120-second timeout and cold-start retry, and (4) a LanceDB service that creates/opens an index table with a fixed schema keyed on embedding model name and dimension.

The critical architectural risk is **tree-sitter's native addon incompatibility with ESM (`"type": "module"`) projects**. The `tree-sitter` npm package is a CJS native addon. The project is `"type": "module"`. The standard fix is `createRequire` from `node:module` to load the grammar packages inside a `.ts` file that wraps them before re-exporting a clean ESM API. This must be handled in Wave 0/setup before any chunking logic is written.

The second critical risk is **LanceDB schema lock-in**: the `vector` column's `FixedSizeList` dimension is baked into the Arrow schema at table creation time. If the embedding model changes (e.g., from `nomic-embed-text` at 768 dimensions to `mxbai-embed-large` at 1024 dimensions), the table must be dropped and recreated. An `index_state` metadata record stored alongside the table must record the model name and dimension so the indexer can detect mismatches at startup and fail fast with a clear error rather than silently storing wrong-dimension vectors.

**Primary recommendation:** Use `tree-sitter` + per-language grammar packages, wrap in a CJS-shim file, `fast-glob` + `ignore` for file crawling, Ollama `embed()` with `AbortController` timeout, and LanceDB with Apache Arrow explicit schema. Do not use `supermemory/code-chunk` — it is a higher-level wrapper that adds opacity; roll a thin chunker directly on the tree-sitter API.

## Project Constraints (from CLAUDE.md)

All CLAUDE.md directives apply. Key constraints relevant to Phase 2:

- **Tech stack lock**: TypeScript (Node.js), `@lancedb/lancedb`, `ollama` npm package. No LangChain, no LlamaIndex, no ChromaDB.
- **No over-abstraction**: Thin service layer. Workflows call services; no deep factory hierarchies.
- **Folder layout**: `src/workflows/`, `src/services/`, `src/tools/`, `src/cli/`, `src/lib/`
- **stderr-only logging**: All pino logging and `process.stderr.write` calls. No `console.log`.
- **Graceful GPU degradation**: Must work on CPU-only machines (slower, but not broken).
- **Do NOT use `vectordb`** (old LanceDB package). Use `@lancedb/lancedb` only.
- **Do NOT use `ts-node`**. Dev: `tsx`. Prod: `tsup`.
- **Zod v4** (not v3) for all schema validation.
- **`execFile` with `promisify`** for any child process calls — not `exec`.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
None — discuss phase was skipped. All implementation choices are at Claude's discretion.

### Claude's Discretion
All implementation choices are at Claude's discretion — discuss phase was skipped per user setting. Use ROADMAP phase goal, success criteria, and codebase conventions to guide decisions.

### Deferred Ideas (OUT OF SCOPE)
None — discuss phase skipped.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| IDX-01 | User can index a codebase with `braincache index [path]` and have all source files parsed, chunked, and embedded | `runIndex` workflow + CLI command wired to Commander — same pattern as `runInit` and `runDoctor` |
| IDX-02 | Indexer respects `.gitignore` and skips binary files, `node_modules`, build artifacts, and lock files | `ignore` package + `fast-glob` with hardcoded exclusion list applied before crawl begins |
| IDX-03 | Code is chunked at function/class/method boundaries using AST-aware parsing (tree-sitter) | `tree-sitter` + language grammar packages; CJS/ESM shim via `createRequire`; node types documented below |
| IDX-04 | Embeddings are generated locally via Ollama and stored in LanceDB with file path, chunk type, and scope metadata | `ollama.embed()` with AbortController 120s timeout; LanceDB with Apache Arrow explicit schema |
| IDX-05 | Indexing works with zero configuration — sensible defaults for chunk size, embedding model, similarity threshold | Read profile from `~/.brain-cache/profile.json` (written by Phase 1 `init`); all defaults from profile + constants |
</phase_requirements>

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@lancedb/lancedb` | 0.27.1 | Embedded vector DB | Disk-backed, TypeScript-native, no server — required by CLAUDE.md |
| `apache-arrow` | 21.1.0 | Arrow schema types | Peer dep of LanceDB for explicit schema definition; FixedSizeList vector columns |
| `tree-sitter` | 0.25.0 | AST parser core | Powers syntax parsing across all target languages |
| `tree-sitter-typescript` | 0.23.2 | TS/JS grammar | Covers both TypeScript and JavaScript via `.typescript`/`.tsx` exports |
| `tree-sitter-python` | 0.25.0 | Python grammar | Python AST nodes for function/class extraction |
| `tree-sitter-go` | 0.25.0 | Go grammar | Go function/method declaration nodes |
| `tree-sitter-rust` | 0.24.0 | Rust grammar | Rust function/impl block nodes |
| `fast-glob` | 3.3.3 | File crawling | Fast, TypeScript-typed, streams large dirs; supports ignore option |
| `ignore` | 7.0.5 | `.gitignore` parsing | Used by ESLint, Prettier; 500+ unit tests; correct gitignore semantics |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `ollama` | 0.6.3 | Batch embed API | Already installed; `embed({ model, input: string[] })` for batch |

No new runtime utilities needed beyond the above. `pino`, `zod`, `commander` already installed.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `tree-sitter` (native) | `@ast-grep/napi` | ast-grep is typed but adds complexity; tree-sitter is the canonical option |
| `tree-sitter` (native) | `web-tree-sitter` (WASM) | WASM version avoids native addon ESM issue but is 3-5x slower and requires loading .wasm file at runtime |
| `fast-glob` + `ignore` | `globby` | globby bundles gitignore reading but is ESM-only; fast-glob + ignore gives more control |
| Manual arrow schema | Inferred schema from data | Inferred schema lets LanceDB pick float dimensions; explicit schema guarantees Float32 and correct FixedSizeList dimension |

**Installation:**
```bash
npm install @lancedb/lancedb apache-arrow tree-sitter tree-sitter-typescript tree-sitter-python tree-sitter-go tree-sitter-rust fast-glob ignore
```

**Version verification (confirmed 2026-03-31):**
- `@lancedb/lancedb`: 0.27.1
- `apache-arrow`: 21.1.0 (within LanceDB peer dep range `>=15.0.0 <=18.1.0` — verify compatibility on install)
- `tree-sitter`: 0.25.0
- `tree-sitter-typescript`: 0.23.2
- `tree-sitter-python`, `tree-sitter-go`: 0.25.0
- `tree-sitter-rust`: 0.24.0
- `fast-glob`: 3.3.3
- `ignore`: 7.0.5

> **apache-arrow version alert:** LanceDB 0.27.1 declares peer dep `apache-arrow >= 15.0.0 <= 18.1.0`. The current npm-latest of `apache-arrow` is 21.1.0, which is outside the declared range. This may work in practice but could produce peer dep warnings. Check if LanceDB ships its own bundled arrow types before installing separately — the `@lancedb/lancedb` package may re-export what is needed without a separate apache-arrow install.

---

## Architecture Patterns

### Recommended Project Structure
```
src/
├── services/
│   ├── lancedb.ts        # connect, openOrCreateTable, insert, index_state helpers
│   ├── chunker.ts        # tree-sitter parsing, node extraction, CodeChunk type
│   ├── embedder.ts       # Ollama batch embed with timeout + cold-start retry
│   └── crawler.ts        # file walker: gitignore + hardcoded exclusions + binary skip
├── workflows/
│   └── index.ts          # runIndex(path): orchestrates crawl -> chunk -> embed -> store
├── lib/
│   └── types.ts          # CodeChunk, IndexState zod schemas + TS types (extend existing)
└── cli/
    └── index.ts          # Add `braincache index [path]` command (dynamic import)
tests/
├── services/
│   ├── chunker.test.ts
│   ├── crawler.test.ts
│   └── embedder.test.ts
└── workflows/
    └── index.test.ts
```

### Pattern 1: LanceDB Table Creation with Explicit Arrow Schema

**What:** Use Apache Arrow's `Schema`, `Field`, `FixedSizeList`, and `Float32` to create a table with a schema that bakes in the embedding dimension. Store table in `.brain-cache/` next to the indexed codebase.

**When to use:** At indexer startup. Open table if it exists and `index_state` model+dimension matches profile. Drop and recreate if mismatch. Create new if absent.

**Example:**
```typescript
// Source: https://docs.lancedb.com/tables/schema (verified 2026-03-31)
import * as lancedb from '@lancedb/lancedb';
import * as arrow from 'apache-arrow';

const CHUNK_SCHEMA = (dim: number) => new arrow.Schema([
  new arrow.Field('id',         new arrow.Utf8(),    false),
  new arrow.Field('file_path',  new arrow.Utf8(),    false),
  new arrow.Field('chunk_type', new arrow.Utf8(),    false), // 'function'|'class'|'method'|'file'
  new arrow.Field('scope',      new arrow.Utf8(),    true),  // enclosing class/module name or null
  new arrow.Field('name',       new arrow.Utf8(),    true),  // function/class name if known
  new arrow.Field('content',    new arrow.Utf8(),    false),
  new arrow.Field('start_line', new arrow.Int32(),   false),
  new arrow.Field('end_line',   new arrow.Int32(),   false),
  new arrow.Field('vector',
    new arrow.FixedSizeList(dim, new arrow.Field('item', new arrow.Float32(), true)),
    false),
]);

async function openOrCreateChunkTable(db: lancedb.Connection, model: string, dim: number) {
  const tableNames = await db.tableNames();
  if (tableNames.includes('chunks')) {
    const table = await db.openTable('chunks');
    // Validate index_state — see Pattern 2
    return table;
  }
  const emptyData = lancedb.makeArrowTable([], { schema: CHUNK_SCHEMA(dim) });
  return db.createTable('chunks', emptyData, { mode: 'overwrite' });
}
```

### Pattern 2: Index State Tracking

**What:** A separate `index_state` table (or a JSON sidecar file at `.brain-cache/index_state.json`) stores the embedding model name, dimension, last indexed timestamp, and file count. Checked at startup before opening the chunks table.

**When to use:** Every `runIndex` invocation reads this before touching the chunks table. If model or dimension changed since last index, table is dropped and recreated.

**Example:**
```typescript
// index_state.json schema (Zod)
const IndexStateSchema = z.object({
  version:        z.literal(1),
  embeddingModel: z.string(),
  dimension:      z.number().int(),
  indexedAt:      z.string().datetime(),
  fileCount:      z.number().int(),
  chunkCount:     z.number().int(),
});
```

### Pattern 3: Tree-Sitter CJS/ESM Shim

**What:** `tree-sitter` and language grammars are CJS native addons. The project uses `"type": "module"`. Load via `createRequire` inside a `.ts` wrapper service, re-export a clean ESM API.

**When to use:** All calls to tree-sitter go through `src/services/chunker.ts` which handles the ESM bridge internally. No other file touches tree-sitter directly.

**Example:**
```typescript
// Source: Node.js docs + tree-sitter GitHub (verified pattern)
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const Parser = require('tree-sitter') as typeof import('tree-sitter');
const { typescript: TSLanguage } = require('tree-sitter-typescript') as {
  typescript: object; tsx: object;
};
```

### Pattern 4: Batch Embedding with Timeout

**What:** Collect all chunks for a file (or up to 32-64 chunks), call `ollama.embed({ model, input: texts[] })` once per batch. Wrap with `AbortController` for 120s timeout.

**When to use:** In `embedder.ts`. Never call `ollama.embed()` once per chunk.

**Example:**
```typescript
// Source: https://github.com/ollama/ollama-js (verified 2026-03-31)
import ollama from 'ollama';

const EMBED_TIMEOUT_MS = 120_000;
const BATCH_SIZE = 32;

async function embedBatch(model: string, texts: string[]): Promise<number[][]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EMBED_TIMEOUT_MS);
  try {
    const response = await ollama.embed({ model, input: texts });
    return response.embeddings;
  } finally {
    clearTimeout(timer);
  }
}
```

> Note: The `ollama` npm SDK's `embed()` method accepts a custom `fetch` in the constructor but does not expose a direct `signal` parameter. The timeout/abort must be applied via a custom fetch wrapper passed to the `Ollama` constructor, or by using a race with `Promise.race([embedCall, timeoutReject])`.

### Pattern 5: Cold-Start Retry

**What:** Ollama model warm-up from disk takes 13–46 seconds. The first embed call may get `ECONNRESET` or a timeout. Implement one retry with 5-second delay after detecting a connection error.

```typescript
async function embedBatchWithRetry(
  model: string,
  texts: string[],
  attempt = 0
): Promise<number[][]> {
  try {
    return await embedBatch(model, texts);
  } catch (err) {
    if (attempt === 0 && isConnectionError(err)) {
      log.warn({ model }, 'Ollama cold-start suspected, retrying in 5s');
      await new Promise(r => setTimeout(r, 5000));
      return embedBatchWithRetry(model, texts, 1);
    }
    throw err;
  }
}
```

### Pattern 6: File Crawler with Exclusions

**What:** Use `fast-glob` to walk directories, apply hardcoded exclusion list before any crawl begins, then apply `.gitignore` patterns from the root of the target directory.

```typescript
// Source: fast-glob docs + ignore package (verified 2026-03-31)
import fg from 'fast-glob';
import { readFile } from 'node:fs/promises';
import Ignore from 'ignore';

// These are hardcoded — no user config required (IDX-02, IDX-05)
const ALWAYS_EXCLUDE_GLOBS = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/build/**',
  '**/.next/**',
  '**/__pycache__/**',
  '**/*.egg-info/**',
  '**/package-lock.json',
  '**/yarn.lock',
  '**/pnpm-lock.yaml',
  '**/Cargo.lock',
  '**/*.min.js',
];

const SOURCE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.mts', '.cts',
  '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.pyi',
  '.go',
  '.rs',
]);

async function crawlSourceFiles(rootDir: string): Promise<string[]> {
  const ig = Ignore();
  try {
    const gitignoreContent = await readFile(`${rootDir}/.gitignore`, 'utf-8');
    ig.add(gitignoreContent);
  } catch { /* no .gitignore — skip */ }

  const files = await fg('**/*', {
    cwd: rootDir,
    absolute: true,
    ignore: ALWAYS_EXCLUDE_GLOBS,
    onlyFiles: true,
  });

  return files.filter(f => {
    const ext = f.slice(f.lastIndexOf('.'));
    if (!SOURCE_EXTENSIONS.has(ext)) return false;
    // Check gitignore relative to root
    const rel = f.slice(rootDir.length + 1);
    return !ig.ignores(rel);
  });
}
```

### AST Node Types by Language

Node type strings for extracting function/class/method boundaries (verified from tree-sitter grammar repos):

| Language | Node Types to Extract |
|----------|-----------------------|
| TypeScript / TSX | `function_declaration`, `function_expression`, `arrow_function`, `generator_function_declaration`, `class_declaration`, `abstract_class_declaration`, `method_definition` |
| JavaScript / JSX | `function_declaration`, `function_expression`, `arrow_function`, `generator_function_declaration`, `class_declaration`, `method_definition` |
| Python | `function_definition`, `async_function_definition`, `class_definition` |
| Go | `function_declaration`, `method_declaration`, `func_literal` |
| Rust | `function_item`, `impl_item`, `closure_expression` |

**Fallback for unrecognized files:** If tree-sitter can't extract any semantic boundaries (e.g., a .ts file that is only type declarations), emit a single `file`-type chunk covering the full file content.

### Anti-Patterns to Avoid
- **Per-chunk embedding calls:** Calling `ollama.embed()` once per chunk turns 1-minute indexing into 15 minutes. Always batch 32–64 chunks per request.
- **Inferred LanceDB schema from data:** LanceDB will pick wrong Float types if schema is inferred. Always pass explicit Arrow schema with `FixedSizeList<Float32>`.
- **Crawling before excluding:** Passing `node_modules` to fast-glob before filtering wastes 10x time. Pass exclusion globs directly to `fast-glob`'s `ignore` option.
- **Direct `import` of `tree-sitter`:** Will fail with `ERR_REQUIRE_ESM` in reverse (the module is CJS, but the project is ESM and the native addon requires specific loading). Use `createRequire`.
- **Storing full file content as one chunk:** Produces poor embeddings. The embedder is optimized for semantic units, not files.
- **Hardcoding `nomic-embed-text` dimensions:** The dimension (768 vs 1024) must come from the capability profile, not a constant. mxbai-embed-large is 1024d.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| .gitignore pattern matching | Custom glob filter | `ignore` npm package | Gitignore has 20+ edge cases (negation, double-star, path anchoring) |
| File walking | Recursive `fs.readdir` | `fast-glob` | Handles symlinks, depth limits, ignore patterns, streaming |
| AST parsing per language | Hand-write regex/line-split chunker | `tree-sitter` + grammar packages | Regex cannot handle nested functions, async arrow functions, decorators, multiline types |
| Arrow schema creation | Plain JS objects as schema | `apache-arrow` `Schema` + `Field` | LanceDB requires typed Arrow schema for FixedSizeList vector columns |
| Binary file detection | Read first N bytes manually | Extension allowlist (SOURCE_EXTENSIONS above) | Simpler, sufficient — only parse known source extensions |

**Key insight:** The tree-sitter investment is non-negotiable. Line-split chunking produces embeddings for code halves, truncated function bodies, and isolated closing braces — all of which pollute the vector index with near-zero-quality chunks that degrade retrieval quality across Phase 3.

---

## Common Pitfalls

### Pitfall 1: LanceDB Schema Dimension Mismatch After Model Change
**What goes wrong:** `nomic-embed-text` produces 768-dim vectors; `mxbai-embed-large` produces 1024-dim. If a user runs `braincache init` on a new machine with more VRAM, their embedding model changes. The next `braincache index` call will try to insert 1024-dim vectors into a 768-dim table — LanceDB will silently accept wrong-sized batches or throw a cryptic Arrow error.
**Why it happens:** LanceDB bakes `FixedSizeList(768, ...)` into the Arrow schema at table creation. The dimension cannot change without recreating the table.
**How to avoid:** Write `index_state.json` with `{ embeddingModel, dimension }` after every successful index. On startup, if model or dimension has changed, log a warning and drop + recreate the table.
**Warning signs:** `ArrowInvalid` or `InvalidInput` errors during `table.add()` calls.

### Pitfall 2: tree-sitter CJS/ESM Incompatibility
**What goes wrong:** `import Parser from 'tree-sitter'` fails because tree-sitter is a native CJS addon in an ESM project. Error: `Error [ERR_REQUIRE_ESM]` or `Cannot find module`.
**Why it happens:** The project sets `"type": "module"` in `package.json`. CJS native addons cannot be imported directly with `import`.
**How to avoid:** Use `createRequire(import.meta.url)` to load `tree-sitter` and all grammar packages inside `chunker.ts`.
**Warning signs:** Any import-related error at startup mentioning `tree-sitter`.

### Pitfall 3: Ollama Cold-Start ECONNRESET
**What goes wrong:** The first `ollama.embed()` call fails with `ECONNRESET` or hangs past 30 seconds. Ollama is running but the model is not yet loaded into VRAM.
**Why it happens:** Model load from disk to VRAM takes 13–46 seconds on large models. The default Node.js fetch timeout (or Ollama's internal timeout) fires before the model is ready.
**How to avoid:** Set AbortController timeout to 120 seconds. On ECONNRESET on the first batch, wait 5 seconds and retry once.
**Warning signs:** First batch of a fresh `braincache index` call fails; subsequent batches succeed.

### Pitfall 4: `apache-arrow` Peer Dependency Out of Range
**What goes wrong:** npm installs `apache-arrow@21.x` but LanceDB 0.27.1 declares peer dep `apache-arrow >= 15.0.0 <= 18.1.0`. Arrow breaking changes in v19-21 may cause schema type mismatches.
**Why it happens:** LanceDB bundles its own Arrow build but declares peer deps for the public types API. Version mismatch in type signatures can cause runtime errors.
**How to avoid:** Check if `@lancedb/lancedb` re-exports Arrow types directly (via `@lancedb/lancedb/arrow`). If so, import from there rather than `apache-arrow`. Otherwise, pin `apache-arrow` to `18.1.0`.
**Warning signs:** TypeScript type errors on `new arrow.Schema(...)` or runtime errors on `makeArrowTable`.

### Pitfall 5: Empty Chunks from Header-Only Files
**What goes wrong:** A TypeScript file that is only `interface` and `type` declarations yields zero `function_declaration` or `class_declaration` nodes. The indexer silently skips it or stores no chunks.
**Why it happens:** `interface_declaration` and `type_alias_declaration` are not in the target node type list (they are type-level, not runtime-level).
**How to avoid:** If tree-sitter extraction yields zero chunks for a file, emit one fallback `file`-type chunk covering the whole content. This preserves discoverability at reduced precision.
**Warning signs:** Type definition files (`.d.ts`, files with only `export interface`) produce no chunks.

### Pitfall 6: N+1 LanceDB Write Pattern
**What goes wrong:** Calling `table.add([chunk])` per chunk sends one Arrow batch per row, creating thousands of small files in the Lance dataset directory.
**Why it happens:** LanceDB's Lance format appends a new data file per `add()` call when called one row at a time.
**How to avoid:** Batch inserts — accumulate all chunks from a file (or up to 500 rows), then call `table.add(chunksBatch)` once. Write in file-level batches at minimum.
**Warning signs:** `.brain-cache/chunks.lance/data/` directory fills with thousands of small `.lance` files.

---

## Code Examples

Verified patterns from official sources:

### LanceDB Connect and Table Lifecycle
```typescript
// Source: https://docs.lancedb.com/quickstart (verified 2026-03-31)
import * as lancedb from '@lancedb/lancedb';

const db = await lancedb.connect('.brain-cache/index');
const tableNames = await db.tableNames();
if (tableNames.includes('chunks')) {
  const table = await db.openTable('chunks');
} else {
  const table = await db.createTable('chunks', data, { mode: 'overwrite' });
}
```

### Ollama Batch Embed
```typescript
// Source: https://github.com/ollama/ollama-js + https://docs.ollama.com/capabilities/embeddings (verified 2026-03-31)
import ollama from 'ollama';
const result = await ollama.embed({
  model: 'nomic-embed-text',
  input: ['chunk text 1', 'chunk text 2', 'chunk text 3'],
});
// result.embeddings: number[][] — one float[] per input string
```

### tree-sitter Node Traversal (CJS shim pattern)
```typescript
// Source: https://tree-sitter.github.io/node-tree-sitter/ (verified 2026-03-31)
import { createRequire } from 'node:module';
const _require = createRequire(import.meta.url);
const Parser = _require('tree-sitter');
const { typescript } = _require('tree-sitter-typescript');

const parser = new Parser();
parser.setLanguage(typescript);
const tree = parser.parse(sourceCode);

function* walkNodes(node: any): Generator<any> {
  yield node;
  for (let i = 0; i < node.childCount; i++) {
    yield* walkNodes(node.child(i));
  }
}

const CHUNK_NODE_TYPES = new Set([
  'function_declaration', 'function_expression', 'arrow_function',
  'generator_function_declaration', 'class_declaration',
  'abstract_class_declaration', 'method_definition',
]);

const chunks = [];
for (const node of walkNodes(tree.rootNode)) {
  if (CHUNK_NODE_TYPES.has(node.type)) {
    chunks.push({
      type: node.type,
      startLine: node.startPosition.row,
      endLine: node.endPosition.row,
      text: sourceCode.slice(node.startIndex, node.endIndex),
    });
  }
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Line-split chunking (512-token windows) | AST boundary chunking (function/class nodes) | 2023-2024 | Code chunks are semantically complete; retrieval quality improves dramatically |
| Single-string embed per chunk | Batch embed (array of strings) | 2023 | 10-20x throughput improvement for indexing |
| Storing raw text without metadata | Store chunk_type, scope, name, file_path alongside vector | 2024 | Enables metadata-filtered retrieval in Phase 3 |
| Inferred LanceDB schema | Explicit Apache Arrow schema with FixedSizeList | 2023-2024 | Guarantees Float32 precision and exact vector dimension |

**Deprecated/outdated:**
- `vectordb` (the old LanceDB npm package): superseded by `@lancedb/lancedb` — do not use
- `ts-node`: broken ESM support in Node 20+; use `tsx` for dev, `tsup` for prod
- One-file-per-embed pattern: replaced by batch embed with `input: string[]` in Ollama API

---

## Open Questions

1. **`apache-arrow` version compatibility with `@lancedb/lancedb@0.27.1`**
   - What we know: LanceDB peer dep is `>=15.0.0 <=18.1.0`; current npm-latest is `21.1.0`
   - What's unclear: Does `@lancedb/lancedb` re-export its own Arrow types making a separate `apache-arrow` install unnecessary? Or does it require a pinned version?
   - Recommendation: In Wave 0, install `@lancedb/lancedb` and check if `import * as arrow from '@lancedb/lancedb/arrow'` or similar works before adding a separate `apache-arrow` dep. Pin to `18.1.0` if a separate install is needed.

2. **tree-sitter CJS prebuilt binary on linux/arm64 in Node 20.x**
   - What we know: tree-sitter 0.25.0 ships prebuilt binaries via `node-pre-gyp`. An open issue (#5335) shows macOS C++20 compile failures on fresh installs without prebuilds.
   - What's unclear: Will `npm install tree-sitter` succeed in the CI environment (linux/arm64, Node 20) with prebuilt binaries, or does it require C++20 compile?
   - Recommendation: Verify `npm install tree-sitter` succeeds in Wave 0. If it fails, evaluate `web-tree-sitter` (WASM) as fallback — slower but no native build required.

3. **Ollama `embed()` AbortSignal/timeout mechanism**
   - What we know: The `Ollama` class constructor accepts a custom `fetch` function; no direct `signal` parameter on `embed()`.
   - What's unclear: Whether wrapping native fetch with `AbortController` is cleanly supported in the `ollama@0.6.3` SDK.
   - Recommendation: Implement a custom fetch wrapper that adds `signal` to every request. Alternatively, use `Promise.race([embedCall, timeoutPromise])` which aborts the logical operation even if the HTTP request completes out of band.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Runtime | Yes | v20.20.2 | — |
| npm | Package install | Yes | (default) | — |
| Ollama | Embedding generation | No (not in container) | — | Tests mock `ollama.embed()`; real indexing requires host Ollama |
| `@lancedb/lancedb` | Vector storage | Not installed yet | — | Must install |
| `tree-sitter` | AST parsing | Not installed yet | — | Must install |
| `fast-glob` | File crawling | Not installed yet | — | Must install |
| `ignore` | .gitignore parsing | Not installed yet | — | Must install |

**Missing dependencies with no fallback:**
- All listed packages — they must be installed in Wave 0 of the plan before any implementation begins.

**Missing dependencies with fallback:**
- Ollama (host service) — tests mock the client; the workflow must still handle `isOllamaRunning() === false` gracefully (same pattern as `runInit`).

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 2.1.9 |
| Config file | `/workspace/vitest.config.ts` |
| Quick run command | `npm test` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| IDX-02 | Crawler excludes `node_modules`, binary files, gitignored paths | unit | `npm test -- --reporter=verbose tests/services/crawler.test.ts` | No — Wave 0 |
| IDX-03 | Chunker extracts function/class/method nodes from TS/JS/Python/Go/Rust | unit | `npm test -- --reporter=verbose tests/services/chunker.test.ts` | No — Wave 0 |
| IDX-04 | Embedder calls `ollama.embed()` with batched input, stores in LanceDB | unit (mocked) | `npm test -- --reporter=verbose tests/services/embedder.test.ts` | No — Wave 0 |
| IDX-01, IDX-05 | `runIndex(path)` orchestrates full pipeline with zero-config defaults | integration (mocked Ollama + tmp LanceDB) | `npm test -- --reporter=verbose tests/workflows/index.test.ts` | No — Wave 0 |

### Sampling Rate
- **Per task commit:** `npm test`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/services/crawler.test.ts` — covers IDX-02
- [ ] `tests/services/chunker.test.ts` — covers IDX-03
- [ ] `tests/services/embedder.test.ts` — covers IDX-04
- [ ] `tests/workflows/index.test.ts` — covers IDX-01, IDX-05
- [ ] `npm install @lancedb/lancedb apache-arrow tree-sitter tree-sitter-typescript tree-sitter-python tree-sitter-go tree-sitter-rust fast-glob ignore` — install all Phase 2 deps before test files can import them

---

## Sources

### Primary (HIGH confidence)
- `npm view @lancedb/lancedb version` — confirmed 0.27.1 (2026-03-31)
- `npm view apache-arrow version` — confirmed 21.1.0; cross-checked against LanceDB peer dep range
- `npm view tree-sitter version` — confirmed 0.25.0
- `npm view tree-sitter-typescript version` — confirmed 0.23.2
- `npm view ignore version` — confirmed 7.0.5
- `npm view fast-glob version` — confirmed 3.3.3
- https://docs.lancedb.com/tables/schema — Arrow schema with FixedSizeList; `makeArrowTable`; `createTable` with mode
- https://docs.lancedb.com/quickstart — `connect`, `createTable`, `openTable`, `search().toArray()`
- https://docs.lancedb.com/tables/create — `createTable` with explicit schema, mode:"overwrite"
- https://github.com/ollama/ollama-js — `embed({ model, input: string[] })`, `Ollama` constructor options
- https://docs.ollama.com/capabilities/embeddings — batch embed, L2-normalized vectors, response format
- https://tree-sitter.github.io/node-tree-sitter/ — `createRequire` import pattern, `Parser`, `setLanguage`, `parse`
- https://github.com/tree-sitter/tree-sitter-typescript/blob/master/tsx/src/node-types.json — TypeScript node type names

### Secondary (MEDIUM confidence)
- https://supermemory.ai/blog/building-code-chunk-ast-aware-code-chunking/ — AST chunking patterns, language support list
- https://lancedb.com/blog/building-rag-on-codebases-part-1/ — confirmed LanceDB used for code RAG; distance metric defaults
- Multiple GitHub issues on tree-sitter ESM/CJS: `createRequire` pattern confirmed as standard workaround

### Tertiary (LOW confidence)
- apache-arrow version compatibility with LanceDB 0.27.1 — peer dep range says <=18.1.0 but 21.1.0 is latest; runtime behavior unverified without install test

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all versions verified from npm registry 2026-03-31
- LanceDB API: HIGH — verified from official docs
- tree-sitter node types: HIGH — verified from grammar repo node-types.json
- Ollama batch embed API: HIGH — verified from GitHub README and official docs
- Architecture patterns: HIGH — consistent with Phase 1 code conventions
- tree-sitter ESM/CJS shim: MEDIUM — createRequire pattern is standard Node.js but tree-sitter-specific install issues on macOS noted
- apache-arrow version compat: LOW — peer dep out of range; needs install validation in Wave 0

**Research date:** 2026-03-31
**Valid until:** 2026-04-30 (stable libraries; tree-sitter native addon issues are the only active risk)
