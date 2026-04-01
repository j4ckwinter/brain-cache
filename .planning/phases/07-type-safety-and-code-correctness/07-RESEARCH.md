# Phase 7: Type Safety and Code Correctness — Research

**Researched:** 2026-04-01

---

## 1. Unsafe `any` Types in Interop Layers

### tree-sitter interop — `src/services/chunker.ts`

Three explicit `any` types in the tree-sitter interop layer:

**Line 85** — `extractName`:
```ts
function extractName(node: any): string | null {
```

**Line 90** — `extractScope`:
```ts
function extractScope(node: any): string | null {
  let current = node.parent;
```

**Line 123** — `walkNodes`:
```ts
function* walkNodes(node: any): Generator<any> {
  yield node;
  for (let i = 0; i < node.childCount; i++) {
    yield* walkNodes(node.child(i));
  }
}
```

**Root cause:** tree-sitter is loaded via `createRequire` (CJS require at runtime), so TypeScript cannot infer types from the import. The type definitions do exist in `node_modules/tree-sitter/tree-sitter.d.ts` and export `Parser.SyntaxNode`.

**Fix:** Import the type from tree-sitter's declaration file and use it:
```ts
import type Parser from 'tree-sitter';
type SyntaxNode = Parser.SyntaxNode;
```
Then replace all three `any` signatures:
- `extractName(node: SyntaxNode): string | null`
- `extractScope(node: SyntaxNode): string | null`
- `walkNodes(node: SyntaxNode): Generator<SyntaxNode>`

The `import type` is compile-time only — it does not affect the runtime CJS require path. This is the correct pattern: use the type for static checking while the actual object is obtained at runtime via `_require`.

### LanceDB interop — `src/services/retriever.ts`

Two explicit `any` types in LanceDB row mapping (lines 46–47):
```ts
.filter((r: any) => r._distance <= opts.distanceThreshold)
.map((r: any) => ({
```

**Root cause:** `table.query().toArray()` returns `Table<any>` from apache-arrow, and its row type is not statically known.

**Fix:** Define a local interface for the raw LanceDB row shape:
```ts
interface RawChunkRow {
  id: string;
  file_path: string;
  chunk_type: string;
  scope: string | null;
  name: string | null;
  content: string;
  start_line: number;
  end_line: number;
  _distance: number;
}
```
Then cast the array result: `(rows as RawChunkRow[]).filter(...)` and `(rows as RawChunkRow[]).map(...)`.

### LanceDB type error — `src/services/lancedb.ts` (line 115)

**This is an actual TypeScript error**, not just an `any` annotation. Running `tsc --noEmit` currently fails with:

```
src/services/lancedb.ts(115,19): error TS2345: Argument of type 'ChunkRow[]' is not assignable to parameter of type 'Data'.
  Type 'ChunkRow[]' is not assignable to type 'Record<string, unknown>[]'.
    Type 'ChunkRow' is not assignable to type 'Record<string, unknown>'.
      Index signature for type 'string' is missing in type 'ChunkRow'.
```

**Location:** `insertChunks` at line 115: `await table.add(rows)` where `rows: ChunkRow[]`.

LanceDB's `Data` type is `Record<string, unknown>[] | TableLike`. The `ChunkRow` interface lacks an index signature, so TypeScript rejects it.

**Fix:** Add an index signature to `ChunkRow`:
```ts
export interface ChunkRow {
  id: string;
  file_path: string;
  chunk_type: string;
  scope: string | null;
  name: string | null;
  content: string;
  start_line: number;
  end_line: number;
  vector: number[];
  [key: string]: unknown; // satisfies LanceDB's Data = Record<string, unknown>[]
}
```

### TypeScript configuration note

`tsconfig.json` uses `"strict": true` (line 9), which already enables `noImplicitAny`. The `any` types in chunker and retriever are **explicit** annotations, not implicit — they are not caught by `noImplicitAny`. They must be replaced manually. The task for DEBT-05 is to eliminate explicit `any` usages in these interop files.

---

## 2. Model Name Matching Bug

**File:** `src/workflows/doctor.ts`, line 41

### Current code:
```ts
modelPresent = list.models.some((m: { name: string }) =>
  m.name.startsWith(saved.embeddingModel)
);
```

### The bug:

`m.name.startsWith(saved.embeddingModel)` checks if the **running model name** starts with the **saved profile model name**.

When `saved.embeddingModel = 'llama3'`, this matches any model whose name starts with `'llama3'` — including `'llama3.2'`, `'llama3.2:latest'`, `'llama32'`, etc.

Ollama model names in `list.models` use the format `<name>:<tag>`, e.g., `nomic-embed-text:latest`, `llama3:latest`, `llama3.2:latest`. The saved profile typically stores the bare name without tag (e.g., `nomic-embed-text`).

**Scenario that fails:** Profile has `embeddingModel: 'llama3'`, Ollama has `llama3.2:latest` running. `'llama3.2:latest'.startsWith('llama3')` → `true` (false positive). Doctor reports the model as present, but `llama3` is not actually available.

**Same bug also appears in `src/services/ollama.ts` line 83** inside `pullModelIfMissing`:
```ts
const alreadyExists = list.models.some((m) => m.name.startsWith(model));
```

### Fix:

Ollama model names include an optional tag after `:`. The correct matching logic is:
1. Strip the tag from the listed model name: `m.name.split(':')[0]` gives the base name.
2. Compare base names exactly: the saved model name (which may or may not include a tag) should match the base name of listed models, or match exactly including tag if a tag is specified.

```ts
// Normalize: strip tag from listed model for exact base-name comparison
function modelMatches(listedName: string, profileModel: string): boolean {
  const listedBase = listedName.split(':')[0];
  const profileBase = profileModel.split(':')[0];
  return listedBase === profileBase;
}
```

Then in `doctor.ts`:
```ts
modelPresent = list.models.some((m: { name: string }) =>
  modelMatches(m.name, saved.embeddingModel)
);
```

And in `ollama.ts`:
```ts
const alreadyExists = list.models.some((m) => modelMatches(m.name, model));
```

This fix should be placed in a shared helper (e.g., added to `src/services/ollama.ts` and exported, since `ollama.ts` already needs it).

---

## 3. Token Counting Duplication

**File:** `src/workflows/index.ts`

### The duplicate counting:

**First count — per file (lines 73–76):** During the file-chunking loop, `countChunkTokens` is called on the raw file content to compute `totalRawTokens`:
```ts
for (let i = 0; i < files.length; i++) {
  const filePath = files[i];
  const content = await readFile(filePath, 'utf-8');
  totalRawTokens += countChunkTokens(content);   // <-- COUNT #1: per file
  const chunks = chunkFile(filePath, content);
  allChunks.push(...chunks);
  ...
}
```

**Second count — per chunk (lines 126–128):** After all embedding is done, `countChunkTokens` is called again on every chunk's content to compute `totalChunkTokens`:
```ts
const totalChunkTokens = allChunks.reduce(
  (sum, chunk) => sum + countChunkTokens(chunk.content), 0  // <-- COUNT #2: per chunk
);
```

Both counts are **intentional** but measure different things:
- `totalRawTokens` = tokens in raw file content (pre-chunking)
- `totalChunkTokens` = tokens in extracted chunks (post-chunking)

These are used to compute a `reductionPct` statistic shown in the summary.

**The actual problem per DEBT-06:** The chunk-level token counting (COUNT #2) calls `countChunkTokens` once per chunk **after** embedding is complete, rather than accumulating the count during chunk creation. This means the tokenizer runs over all chunk content twice — once during chunking (if tokens were counted then) or as a separate pass at the end.

Currently COUNT #2 is a **separate reduce pass** over all chunks after embedding. The fix is to accumulate chunk token counts during the batch-embed loop, so no separate reduce pass is needed:

```ts
// During the embed loop (Step 8):
let totalChunkTokens = 0;
for (let offset = 0; offset < allChunks.length; offset += DEFAULT_BATCH_SIZE) {
  const batch = allChunks.slice(offset, offset + DEFAULT_BATCH_SIZE);
  const texts = batch.map((chunk) => chunk.content);
  // Accumulate chunk tokens here, once per chunk:
  totalChunkTokens += texts.reduce((sum, t) => sum + countChunkTokens(t), 0);
  const vectors = await embedBatchWithRetry(profile.embeddingModel, texts);
  ...
}
// Remove the post-hoc reduce at line 126-128
```

This ensures `countChunkTokens` is called exactly once per chunk, not once per chunk plus a separate pass.

---

## 4. Tree-sitter CJS Require Block

**File:** `src/services/chunker.ts`, lines 1–12

### Current code:
```ts
import { createRequire } from 'node:module';
import { extname } from 'node:path';
import { childLogger } from './logger.js';
import type { CodeChunk } from '../lib/types.js';

const _require = createRequire(import.meta.url);
const Parser = _require('tree-sitter');
const { typescript: tsLang, tsx: tsxLang } = _require('tree-sitter-typescript');
const pythonLang = _require('tree-sitter-python');
const goLang = _require('tree-sitter-go');
const rustLang = _require('tree-sitter-rust');
```

### Why it exists:

The project uses `"module": "Node16"` in tsconfig.json, which means all `src/` files are compiled as ES modules (ESM). However, `tree-sitter` and its language grammars (`tree-sitter-typescript`, `tree-sitter-python`, etc.) are **CommonJS (CJS) packages** — they use `module.exports` and do not provide ESM entry points.

In Node.js ESM, you cannot use `import` to load a CJS module that uses `module.exports` as a class/constructor (rather than as a plain object with named exports) because the default export semantics differ. `tree-sitter`'s main export is the `Parser` class itself, and loading it via `import Parser from 'tree-sitter'` in strict ESM mode does not work correctly at runtime.

`createRequire(import.meta.url)` creates a CommonJS `require` function anchored to the current ESM file's location, allowing CJS modules to be loaded from an ESM context. This is the official Node.js interop pattern.

### What would allow removing it:

- **tree-sitter >= 0.24.0** ships an optional ESM entry point (`exports["import"]` field). If `tree-sitter` adds a proper ESM export of the `Parser` class, the `createRequire` workaround could be replaced with a standard `import`.
- **Alternatively:** If the project migrated to `web-tree-sitter` (WebAssembly-based), which ships as ESM natively. The REQUIREMENTS.md lists this as out of scope ("web-tree-sitter migration: Works fine as CJS; migration is risky for low reward").

The comment to add (HARD-02) should explain: (a) why CJS require is needed instead of ESM import, (b) what tree-sitter version or which migration path would allow removing it.

---

## 5. Arrow Function Extraction

**File:** `src/services/chunker.ts`, lines 158–172

### Current code:
```ts
// For arrow functions: only extract top-level or exported ones.
// Top-level export pattern: root > export_statement > lexical_declaration > variable_declarator > arrow_function (depth=4)
// Nested callback pattern: depth >= 6 (inside function body > call_expression > arguments > arrow_function)
// Threshold: depth <= 5 admits top-level/exported arrow functions; depth > 5 skips nested callbacks.
if (node.type === 'arrow_function') {
  let depth = 0;
  let cur = node.parent;
  while (cur) {
    depth++;
    cur = cur.parent;
  }
  if (depth > 5) {
    continue;
  }
}
```

### The problem with depth counting:

Depth from root is fragile because AST depth varies with context:
- A top-level exported arrow: `program > export_statement > lexical_declaration > variable_declarator > arrow_function` → depth 4
- A module-level (non-exported) `const fn = () => {}` → `program > lexical_declaration > variable_declarator > arrow_function` → depth 3
- A nested arrow inside a class method body → deeper, correctly excluded

However, the depth threshold of 5 is brittle. Consider:
- An arrow function inside an `if` block at module level: `program > if_statement > statement_block > expression_statement > assignment_expression > arrow_function` → depth 5 (or 6), which hits the boundary ambiguously
- Files with deeply-nested module wrappers (IIFE, namespace patterns) shift all depths upward, causing false exclusions

### Parent node type check approach (HARD-03 fix):

Instead of counting depth, check the **semantic parent**: an arrow function is "top-level or exported" if its immediate parent chain passes through a `variable_declarator` whose parent is a `lexical_declaration` (`const`/`let`) that is a **direct child of the program root** or of an `export_statement` that is a direct child of the program root.

Concretely, check whether `node.parent?.type` is `variable_declarator` and `node.parent?.parent?.type` is `lexical_declaration` and `node.parent?.parent?.parent?.type` is either `program` or `export_statement`:

```ts
if (node.type === 'arrow_function') {
  const varDeclarator = node.parent;
  const lexDecl = varDeclarator?.parent;
  const container = lexDecl?.parent;

  const isTopLevelConst =
    varDeclarator?.type === 'variable_declarator' &&
    lexDecl?.type === 'lexical_declaration' &&
    (container?.type === 'program' || container?.type === 'export_statement');

  if (!isTopLevelConst) {
    continue;
  }
}
```

This correctly admits:
- `export const fn = () => {}` (container = `export_statement`)
- `const fn = () => {}` at module level (container = `program`)

And correctly excludes:
- Arrow functions as callback arguments: parent is `arguments`, not `variable_declarator`
- Arrow functions in object literals: parent is `pair` or `shorthand_property_identifier_pattern`
- Deeply nested arrow functions in function bodies

### Note on the `SyntaxNode` type

After fixing the `any` types (section 1 above), `node`, `varDeclarator`, `lexDecl`, and `container` will be typed as `SyntaxNode | null`, so the optional chaining (`?.`) is already correct TypeScript.

---

## 6. TypeScript Configuration

**File:** `/workspace/tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

**Key findings:**
- `"strict": true` is already set. This enables `noImplicitAny` — but the `any` types in the codebase are **explicit** annotations (`node: any`), not implicit inferences. Explicit `any` is not caught by `noImplicitAny`; only implicit inference of `any` is caught.
- To fully ban all `any` usage, `noImplicitAny` is already on, but `"noExplicitAny"` does not exist as a `tsc` flag. The replacement of explicit `any` types must be done manually.
- Currently `tsc --noEmit` **fails with 1 error** (the `ChunkRow` / `lancedb.Table.add()` type mismatch in `src/services/lancedb.ts:115`).
- After Phase 7 fixes, `tsc --noEmit` must pass with zero errors.
- The success criterion says "passes with `noImplicitAny: true`" — since `strict: true` already covers this, no tsconfig change is needed for that criterion. The real work is replacing explicit `any` types.

---

## Validation Architecture

### How to verify each fix:

**DEBT-05 (any types):**
- Run `tsc --noEmit` → must exit 0 with no errors
- Manually confirm no `any` appears in `src/services/chunker.ts` or `src/services/retriever.ts` (can use `grep -n ': any'` or `grep -n 'any>'`)
- Run existing test suite (`npm test`) → all tests pass

**BUG-01 (model name matching):**
- Unit test: `modelMatches('llama3.2:latest', 'llama3')` must return `false`
- Unit test: `modelMatches('llama3:latest', 'llama3')` must return `true`
- Unit test: `modelMatches('nomic-embed-text:latest', 'nomic-embed-text')` must return `true`
- Doctor workflow test: mock `ollama.list()` returning `[{ name: 'llama3.2:latest' }]` with saved model `llama3` → `modelPresent` must be `false`

**DEBT-06 (token counting):**
- Add a `vi.spyOn` on `countChunkTokens` in the index workflow test
- Run `runIndex` on a mocked 2-file repo with 1 chunk per file
- Assert `countChunkTokens` was called exactly N times where N = (files × 1 for raw) + (chunks × 1 for chunk tokens) = 2 + 2 = 4, not 2 + 2 + 2 (double-counting)
- The existing `tests/workflows/index.test.ts` already mocks `countChunkTokens` — a new test assertion on call count can verify single invocation per chunk

**HARD-02 (CJS comment):**
- Code review: open `src/services/chunker.ts` lines 1–12 and verify the inline comment is present and explains: (1) CJS nature of tree-sitter packages, (2) ESM/CJS interop reason, (3) what version/migration would allow removal

**HARD-03 (arrow function parent type check):**
- Unit test in `tests/services/chunker.test.ts`: create a TypeScript file with deeply nested arrow functions (e.g., arrow inside `.map()` callback inside a function body, at depth > 5) and assert they are NOT extracted
- Assert that `export const fn = () => {}` IS extracted
- Assert that `const fn = () => {}` at module level IS extracted
- Run against a large real file and confirm behavior matches expectations

---

## RESEARCH COMPLETE
