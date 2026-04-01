# Phase 3: Retrieval and Context Assembly - Research

**Researched:** 2026-03-31
**Domain:** LanceDB vector search, query intent classification, token counting, context assembly
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
None — discuss phase was skipped per `workflow.skip_discuss`. All implementation choices are at Claude's discretion.

### Claude's Discretion
All implementation choices: retrieval strategy, intent classification approach, deduplication method, token budget mechanism, savings metadata format.

### Deferred Ideas (OUT OF SCOPE)
None captured — discuss phase skipped. v2 items (ADV-01: configurable retrieval depth per query type, ADV-02: cross-file dependency-aware retrieval) remain deferred per REQUIREMENTS.md.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| RET-01 | Natural language query returns top-N most relevant code chunks with cosine similarity scores, filtered below 0.7 threshold | LanceDB `table.query().nearestTo(vector).distanceType('cosine').limit(N).toArray()` confirmed working; `distanceRange(0, 0.3)` for 0.7 similarity (distance = 1 - similarity) |
| RET-02 | Retrieved chunks are deduplicated — same function never appears more than once | Hash-based dedup on chunk `id` field (already a stable identifier in existing schema); Set-based O(1) lookup in assembly pass |
| RET-03 | Context assembled within configurable token budget, ranked by relevance score | `@anthropic-ai/tokenizer` `countTokens(text)` for local counting; greedy fill from highest score; configurable budget as parameter |
| RET-04 | Every `build_context` response includes: tokens sent, estimated tokens without Braincache, reduction percentage, local tasks, cloud calls | Token counting with `@anthropic-ai/tokenizer` before + estimated without; metadata struct defined in this research |
| RET-05 | Query types ("why is X broken" vs "how does Y work") use different retrieval strategies | Keyword-based intent classification (no LLM required); diagnostic queries get broader search (higher limit, lower threshold); knowledge queries get tighter search |
</phase_requirements>

---

## Summary

Phase 3 builds on top of the indexed LanceDB table created in Phase 2. The core data flow is: embed query → vector search → dedup → token-budget trim → assemble context + metadata. All five requirements are achievable with the existing stack — no new dependencies required beyond `@anthropic-ai/tokenizer` for local token counting.

The LanceDB query API is well-suited to this phase. `table.query().nearestTo(vector)` returns a `VectorQuery` builder with `.distanceType('cosine')`, `.limit(N)`, `.distanceRange(lower, upper)`, and `.select(columns)` chainable methods. Results include a `_distance` column (cosine distance, not similarity; range 0-2). The 0.7 similarity threshold maps to `distanceRange(0, 0.3)` (distance = 1 - similarity for normalized vectors).

For RET-05 query intent differentiation, a lightweight keyword-based classifier is sufficient. The REQUIREMENTS.md explicitly excludes reranking with a second LLM ("Adds latency and VRAM — vector similarity scores are sufficient"), and ADV-01 (configurable retrieval depth per query type) is a v2 item. The implementation should classify the query into two strategies (diagnostic vs. knowledge) using heuristic keyword matching, adjusting retrieval limit and distance threshold accordingly.

**Primary recommendation:** Implement `src/services/retriever.ts` (vector search + dedup) and `src/workflows/buildContext.ts` (orchestrator returning assembled context + metadata), then wire a `search` CLI command as a thin adapter.

---

## Standard Stack

### Core (no new dependencies)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@lancedb/lancedb` | 0.27.1 | Vector search via `table.query().nearestTo()` | Already installed; full search API confirmed |
| `ollama` | 0.6.3 | Embed the query string via `embedBatchWithRetry` | Already installed; `embedBatch` reused directly |
| `node:crypto` | built-in | SHA-256 hash for chunk dedup key | No extra dep; ships with Node 22 |

### New Dependency
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@anthropic-ai/tokenizer` | latest (~0.0.4) | Local token counting without API round-trip | Required for RET-03 token budget and RET-04 savings metadata |

**Installation:**
```bash
npm install @anthropic-ai/tokenizer
```

**Version note:** Package is in beta (`0.0.4` as of research date). Internals subject to change without major semver. The `countTokens(text: string): number` function is stable for our use case.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@anthropic-ai/tokenizer` | Anthropic `messages.countTokens` API | API requires network round-trip + SDK installed; local tokenizer is zero-latency and has no API cost |
| keyword intent classifier | LLM-based intent detection | LLM adds 500ms+ and VRAM; heuristic keywords are sufficient for 2-class problem |
| `node:crypto` SHA-256 | Third-party hash | No benefit over built-in; SHA-256 is collision-resistant and ships with Node |

---

## Architecture Patterns

### Recommended Project Structure
```
src/
├── services/
│   ├── retriever.ts       # NEW: vector search, dedup, threshold filter
│   ├── tokenCounter.ts    # NEW: wrapper around @anthropic-ai/tokenizer
│   ├── lancedb.ts         # EXISTING: add searchChunks() function
│   ├── embedder.ts        # EXISTING: reused for query embedding
│   └── ...
├── workflows/
│   ├── buildContext.ts    # NEW: orchestrates retrieve -> dedup -> budget -> metadata
│   ├── search.ts          # NEW: thin workflow for CLI `search` command (RET-01 surface)
│   └── index.ts           # EXISTING
├── cli/
│   └── index.ts           # EXISTING: add `search` command (thin adapter)
└── lib/
    └── types.ts           # EXISTING: add RetrievedChunk, ContextResult types
```

### Pattern 1: LanceDB Vector Search with Cosine Distance

**What:** Embed the query string using the same model as indexing, then call `nearestTo()` on the table. Filter by cosine distance (not similarity — LanceDB returns distance, not similarity score).

**Cosine distance math:** `distance = 1 - cosine_similarity` for normalized vectors. A 0.7 similarity threshold maps to `distanceRange(0, 0.3)`. Distance range [0, 2] where 0 = identical.

**Important:** The `_distance` field in results IS cosine distance (0 = identical, 2 = opposite). The user-facing "similarity score" should be presented as `1 - _distance` in returned results.

**When to use:** All queries. bypassVectorIndex() is NOT needed — the table will have fewer rows than the ANN index training threshold for most codebases, so LanceDB falls back to flat search automatically (confirmed: flat search is used when no ANN index exists; no error is thrown).

```typescript
// Source: /workspace/node_modules/@lancedb/lancedb/dist/query.d.ts (confirmed API)
import type { Table } from '@lancedb/lancedb';

export interface SearchOptions {
  limit: number;
  distanceThreshold: number; // cosine distance, not similarity (0.3 = 0.7 similarity)
}

export async function searchChunks(
  table: Table,
  queryVector: number[],
  opts: SearchOptions
): Promise<RawSearchResult[]> {
  const rows = await table
    .query()
    .nearestTo(queryVector)
    .distanceType('cosine')
    .limit(opts.limit)
    .select(['id', 'file_path', 'chunk_type', 'scope', 'name', 'content', 'start_line', 'end_line'])
    .toArray();

  // Filter by distance threshold and convert to similarity score
  return rows
    .filter((r) => r._distance <= opts.distanceThreshold)
    .map((r) => ({
      ...r,
      similarity: 1 - r._distance,
    }));
}
```

### Pattern 2: Hash-Based Deduplication

**What:** Before assembling context, deduplicate retrieved chunks. The existing schema already assigns a stable `id` per chunk (set during indexing). Use a `Set<string>` to track seen ids.

**Why:** A single function can appear multiple times if it was indexed from different embeddings due to chunking overlap, or if the same file was indexed twice (edge case). The chunk `id` is the canonical dedup key.

```typescript
// Source: Existing ChunkRow.id in src/services/lancedb.ts
export function deduplicateChunks(chunks: RetrievedChunk[]): RetrievedChunk[] {
  const seen = new Set<string>();
  return chunks.filter((c) => {
    if (seen.has(c.id)) return false;
    seen.add(c.id);
    return true;
  });
}
```

### Pattern 3: Token Budget Greedy Fill

**What:** Sort chunks by similarity score descending, then accumulate chunks until adding the next chunk would exceed the token budget. The assembled context is the ordered concatenation of kept chunks.

**`@anthropic-ai/tokenizer` API (confirmed from source):**
```typescript
import { countTokens } from '@anthropic-ai/tokenizer';
// countTokens(text: string): number
// Normalizes NFKC, encodes with Anthropic tokenizer, returns token count
```

```typescript
// Source: @anthropic-ai/tokenizer confirmed API
import { countTokens } from '@anthropic-ai/tokenizer';

export interface TokenBudgetOptions {
  maxTokens: number; // default: 4096
}

export function assembleContext(
  chunks: RetrievedChunk[],
  opts: TokenBudgetOptions
): AssembledContext {
  // Chunks already sorted by similarity desc (highest first)
  const kept: RetrievedChunk[] = [];
  let totalTokens = 0;

  for (const chunk of chunks) {
    const chunkTokens = countTokens(formatChunk(chunk));
    if (totalTokens + chunkTokens > opts.maxTokens) break;
    kept.push(chunk);
    totalTokens += chunkTokens;
  }

  return {
    content: kept.map(formatChunk).join('\n\n---\n\n'),
    chunks: kept,
    tokenCount: totalTokens,
  };
}
```

### Pattern 4: Query Intent Classification

**What:** Simple keyword heuristic to choose between two retrieval strategies. No LLM, no external calls. Two strategies:

- **diagnostic**: "why is X broken", "what causes", "error", "bug", "failing", "crash", "undefined", "null" → broader search (higher limit, looser threshold)
- **knowledge**: everything else → standard search

**Rationale for approach:** RET-05 requires different chunk selection, but reranking with a second LLM is explicitly out of scope per REQUIREMENTS.md. ADV-01 (configurable retrieval depth per query type) is v2. The minimum viable implementation is strategy selection via keyword matching.

```typescript
export type QueryIntent = 'diagnostic' | 'knowledge';

const DIAGNOSTIC_KEYWORDS = [
  'why', 'broken', 'error', 'bug', 'fail', 'crash', 'exception',
  'undefined', 'null', 'not working', 'wrong', 'issue', 'problem',
  'causes', 'caused', 'debug', 'fix', 'incorrect', 'unexpected'
];

export function classifyQueryIntent(query: string): QueryIntent {
  const lower = query.toLowerCase();
  return DIAGNOSTIC_KEYWORDS.some((kw) => lower.includes(kw))
    ? 'diagnostic'
    : 'knowledge';
}

export const RETRIEVAL_STRATEGIES: Record<QueryIntent, SearchOptions> = {
  diagnostic: { limit: 20, distanceThreshold: 0.4 },  // looser: 0.6 similarity
  knowledge:  { limit: 10, distanceThreshold: 0.3 },  // tighter: 0.7 similarity
};
```

### Pattern 5: Savings Metadata (RET-04)

**What:** Every `build_context` response includes a `ContextMetadata` object.

- `tokensSent`: `countTokens(assembledContext.content)`
- `estimatedWithoutBraincache`: sum of `countTokens(file.content)` for all files that contributed at least one chunk to results — represents the raw file dump a naive approach would send
- `reductionPct`: `(1 - tokensSent / estimatedWithoutBraincache) * 100`
- `localTasksPerformed`: array of strings describing what ran locally (e.g., `['embed_query', 'vector_search', 'dedup', 'token_budget']`)
- `cloudCallsMade`: always 0 for `build_context` (Phase 4 `ask-codebase` workflow adds cloud calls)

```typescript
export interface ContextMetadata {
  tokensSent: number;
  estimatedWithoutBraincache: number;
  reductionPct: number;
  localTasksPerformed: string[];
  cloudCallsMade: number;
}

export interface ContextResult {
  content: string;
  chunks: RetrievedChunk[];
  metadata: ContextMetadata;
}
```

### Anti-Patterns to Avoid

- **Calling cosine distance "score" without inversion:** LanceDB returns `_distance` (0 = identical). Presenting it as a similarity score without converting (`score = 1 - _distance`) causes confusion. Always invert for user-facing output.
- **Trying to create an ANN index on a small table:** LanceDB's IVF index requires at least 256 rows (confirmed from GitHub issue #2553). For developer codebases that may have fewer chunks, this throws. Do NOT call `table.createIndex()` — the flat search is fast enough for typical codebase sizes (< 50k chunks) and LanceDB falls back automatically.
- **Loading all file content for token estimation:** For RET-04 "estimated without Braincache", only load content of files that contributed to the result set (not all indexed files) — otherwise estimation time grows with index size.
- **Using `filter()` before calling `.toArray()`:** The LanceDB `.where()` predicate is for scalar metadata filtering (e.g., `file_path LIKE '%src%'`). Do not use it for distance threshold — use `distanceRange()` or post-process the results array.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Local token counting | Custom tokenizer / character estimate | `@anthropic-ai/tokenizer` | Anthropic uses different tokenizer than GPT; character estimates are wildly off for code |
| Cosine similarity | Manual dot product / normalization | LanceDB `distanceType('cosine')` | LanceDB normalizes vectors at query time; hand-rolling risks numerical errors |
| Chunk deduplication | Bloom filter / fuzzy matching | `Set<string>` on chunk `id` | Chunk ids are already stable content-addressable keys from Phase 2 |

**Key insight:** The indexed chunk `id` field from Phase 2 is already a stable dedup key — it was set as `${filePath}:${chunkIndex}` or equivalent in `chunker.ts`. No additional hashing is needed.

---

## Common Pitfalls

### Pitfall 1: ANN Index Training Error on Small Tables
**What goes wrong:** Calling `table.createIndex('vector', { config: Index.hnswSq() })` on a table with fewer than 256 rows throws an error.
**Why it happens:** IVF-based indexes require minimum row counts for partition training. LanceDB will error rather than silently skip.
**How to avoid:** Never call `createIndex` in Phase 3. LanceDB automatically uses flat (exhaustive) search when no index exists — this is performant for typical codebase sizes.
**Warning signs:** Any code path that conditionally creates the index based on row count is over-engineering for this phase.

### Pitfall 2: Distance vs. Similarity Confusion
**What goes wrong:** Showing `_distance` directly as a "similarity score" or applying a threshold of 0.7 to `_distance` instead of `1 - _distance`.
**Why it happens:** LanceDB uses distance (smaller = more similar), but users expect similarity (larger = more similar).
**How to avoid:** Always convert at the retriever boundary: `similarity = 1 - row._distance`. The 0.7 similarity threshold is `distanceRange(0, 0.3)`.
**Warning signs:** High-quality results getting filtered out, or low-quality results passing the threshold.

### Pitfall 3: Querying with Wrong Embedding Model
**What goes wrong:** Index was built with `nomic-embed-text` (768-dim), but the query is embedded with `mxbai-embed-large` (1024-dim). Results are garbage; no error is thrown.
**Why it happens:** LanceDB stores the vector column as a fixed-size list — dimension is baked in. A mismatched query vector is silently truncated or causes a runtime panic.
**How to avoid:** Always read `index_state.json` to get `embeddingModel` and `dimension` before embedding the query. Use the stored model, not the profile model (in case the profile was updated after indexing).

### Pitfall 4: `countTokens` Called per Character Instead of per Chunk
**What goes wrong:** Calling `countTokens(char)` in a loop instead of `countTokens(fullChunkContent)` — the tokenizer has non-trivial initialization overhead per call.
**Why it happens:** Misunderstanding the API as character-level.
**How to avoid:** Call `countTokens(chunk.content)` once per chunk string, not per character. The function calls `tokenizer.free()` after each call, which means it re-initializes the WASM tokenizer each time — batch at chunk granularity.

### Pitfall 5: Missing `_distance` in `select()` Column List
**What goes wrong:** Calling `.select(['id', 'content', ...])` without including `_distance` — the column is not returned and post-filtering by distance threshold fails.
**Why it happens:** `_distance` is a computed column added by LanceDB during search, not a stored column. It must be included explicitly OR omitted from `select()` (in which case all columns including `_distance` are returned).
**How to avoid:** Either omit `.select()` entirely, or include `'_distance'` in the columns list. Recommended: omit `select()` for simplicity since the schema is narrow.

---

## Code Examples

### Full Vector Search Flow
```typescript
// Source: /workspace/node_modules/@lancedb/lancedb/dist/query.d.ts (verified)
import type { Table } from '@lancedb/lancedb';

async function vectorSearch(
  table: Table,
  queryVector: number[],
  limit: number,
  maxDistance: number
): Promise<any[]> {
  return await table
    .query()
    .nearestTo(queryVector)
    .distanceType('cosine')
    .limit(limit)
    .toArray();
  // Note: apply distance filter in post-processing with .filter(r => r._distance <= maxDistance)
  // distanceRange() also works: .distanceRange(0, maxDistance) before .toArray()
}
```

### Open Database + Table for Read (existing pattern from lancedb.ts)
```typescript
// Source: src/services/lancedb.ts (verified existing code)
const db = await openDatabase(projectRoot);           // opens .brain-cache/index
const tableNames = await db.tableNames();
if (!tableNames.includes('chunks')) {
  throw new Error('Index not found — run brain-cache index first');
}
const table = await db.openTable('chunks');           // read-only for retrieval
```

### Local Token Counting
```typescript
// Source: @anthropic-ai/tokenizer (verified from source code)
import { countTokens } from '@anthropic-ai/tokenizer';

const tokens = countTokens(chunk.content);  // string -> number
const totalBudget = 4096;
```

### CLI Command Wiring (existing pattern from cli/index.ts)
```typescript
// Source: src/cli/index.ts (verified existing pattern)
program
  .command('search')
  .description('Search indexed codebase with a natural language query')
  .argument('<query>', 'Natural language query string')
  .option('-n, --limit <n>', 'Number of results', '10')
  .option('--budget <tokens>', 'Token budget for context assembly', '4096')
  .action(async (query: string, opts) => {
    const { runSearch } = await import('../workflows/search.js');
    await runSearch(query, { limit: parseInt(opts.limit), budget: parseInt(opts.budget) });
  });
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Separate reranker LLM for result quality | Vector similarity scores only (per REQUIREMENTS.md out-of-scope) | Decided Phase 0 | Simpler, no extra VRAM |
| chromadb for vector storage | `@lancedb/lancedb` embedded | Phase 2 decision | No external server needed |
| `ts-node` for TypeScript | `tsx` dev + `tsup` prod | CLAUDE.md mandate | Better ESM support |

**Deprecated/outdated:**
- `vectordb` (old LanceDB package): DO NOT USE per CLAUDE.md — use `@lancedb/lancedb`
- `filter()` on VectorQuery: deprecated in current LanceDB TS SDK, use `where()` instead

---

## Open Questions

1. **Estimated tokens without Braincache — scope of "all files"**
   - What we know: We need to estimate tokens a naive approach would send. Options: (a) sum tokens of all files that contributed chunks to results; (b) sum tokens of all files in the index.
   - What's unclear: Option (a) is more accurate but requires file reads at query time. Option (b) is in `index_state.json` as `chunkCount` but isn't a token count.
   - Recommendation: Use option (a) — read and sum `countTokens(fileContent)` for unique `file_path` values in the result set. This is bounded by result count (typically 10-20 files), not total index size.

2. **Default token budget value**
   - What we know: Claude 3.5 Sonnet context window is 200K tokens, but the goal is to stay small. Common values in RAG: 2K-8K for code context.
   - Recommendation: Default to 4096 tokens. Make it configurable via `--budget` CLI option and `maxTokens` parameter.

3. **`countTokens` accuracy for code**
   - What we know: `@anthropic-ai/tokenizer` is described as beta; it uses the actual Anthropic tokenizer (not tiktoken). Code typically tokenizes at ~3-4 chars/token.
   - What's unclear: Whether there's drift between this local tokenizer and what the API actually counts.
   - Recommendation: Use it for estimation — accuracy within 5-10% is sufficient for a budget mechanism. Flag as "estimated" in RET-04 metadata.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Runtime | Yes | 22.x (confirmed by container) | — |
| `@lancedb/lancedb` | Vector search | Yes (installed) | 0.27.1 | — |
| `ollama` npm | Query embedding | Yes (installed) | 0.6.3 | — |
| Ollama service | Query embedding | Checked at runtime | varies | `isOllamaRunning()` guard already in place |
| `@anthropic-ai/tokenizer` | Token counting | NOT installed (not in package.json) | — | Must `npm install` |
| `node:crypto` | SHA-256 dedup (if needed) | Built-in Node 22 | — | — |

**Missing dependencies with no fallback:**
- `@anthropic-ai/tokenizer` — required for RET-03 and RET-04; must be installed in Wave 0.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 2.x |
| Config file | `/workspace/vitest.config.ts` |
| Quick run command | `npm test -- --reporter=verbose tests/services/retriever.test.ts` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| RET-01 | `searchChunks()` returns top-N with similarity scores, filters below 0.7 | unit | `npm test -- tests/services/retriever.test.ts` | No — Wave 0 |
| RET-01 | `runSearch()` workflow reads profile, embeds query, opens table, returns results | unit | `npm test -- tests/workflows/search.test.ts` | No — Wave 0 |
| RET-02 | `deduplicateChunks()` removes duplicate ids, preserves order | unit | `npm test -- tests/services/retriever.test.ts` | No — Wave 0 |
| RET-03 | `assembleContext()` respects token budget, keeps highest-score chunks | unit | `npm test -- tests/services/tokenCounter.test.ts` | No — Wave 0 |
| RET-04 | `buildContext()` returns metadata with all 5 required fields | unit | `npm test -- tests/workflows/buildContext.test.ts` | No — Wave 0 |
| RET-05 | `classifyQueryIntent()` returns 'diagnostic' for error queries, 'knowledge' for others | unit | `npm test -- tests/services/retriever.test.ts` | No — Wave 0 |

### Sampling Rate
- **Per task commit:** `npm test -- tests/services/retriever.test.ts tests/services/tokenCounter.test.ts tests/workflows/buildContext.test.ts tests/workflows/search.test.ts`
- **Per wave merge:** `npm test` (full suite — 131 existing + new tests)
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/services/retriever.test.ts` — covers RET-01 (search + threshold), RET-02 (dedup), RET-05 (intent classification)
- [ ] `tests/services/tokenCounter.test.ts` — covers RET-03 (token budget assembly)
- [ ] `tests/workflows/buildContext.test.ts` — covers RET-04 (metadata struct, all 5 fields present)
- [ ] `tests/workflows/search.test.ts` — covers RET-01 workflow integration
- [ ] `npm install @anthropic-ai/tokenizer` — must run before any tokenCounter code

---

## Sources

### Primary (HIGH confidence)
- `/workspace/node_modules/@lancedb/lancedb/dist/query.d.ts` — VectorQuery API: nearestTo, distanceType, limit, distanceRange, bypassVectorIndex, toArray — verified from installed package
- `/workspace/node_modules/@lancedb/lancedb/dist/indices.d.ts` — IvfPqOptions, HnswSqOptions, distanceType options — verified from installed package
- `/workspace/src/services/lancedb.ts` — existing ChunkRow schema, openDatabase, openTable patterns
- `/workspace/src/services/embedder.ts` — embedBatch, embedBatchWithRetry — reused directly
- `/workspace/src/lib/types.ts` — CodeChunk, IndexState types — extended in this phase
- GitHub: `anthropics/anthropic-tokenizer-typescript/blob/main/index.ts` — `countTokens(text: string): number` signature confirmed

### Secondary (MEDIUM confidence)
- [LanceDB Vector Search docs](https://docs.lancedb.com/search/vector-search) — distanceRange, cosine distance range [0,2], distanceType chainable methods
- [LanceDB Vector Index docs](https://docs.lancedb.com/indexing/vector-index) — "at least a few thousand rows" for ANN training; 256-row minimum confirmed from GitHub issue #2553

### Tertiary (LOW confidence)
- WebSearch: LanceDB IVF minimum 256 rows from GitHub issue #2553 — needs validation at runtime if index creation is ever needed (not needed for this phase)

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — installed packages verified from node_modules, API confirmed from .d.ts files
- Architecture: HIGH — LanceDB query API fully inspected from installed TypeScript declarations
- Pitfalls: HIGH — distance vs. similarity confirmed from LanceDB type docs; ANN threshold from GitHub issue
- Token counting: MEDIUM — `@anthropic-ai/tokenizer` beta status noted; function signature confirmed from source

**Research date:** 2026-03-31
**Valid until:** 2026-04-30 (LanceDB 0.27.x is stable; tokenizer is beta but function signature unlikely to change)

---

## Accumulated Decisions Relevant to This Phase

From `STATE.md`:
- **Cosine similarity threshold at 0.7** (locked in Phase 3 column): Drop chunks below threshold; Ollama models produce normalized vectors; cosine is universal default. Maps to `distanceRange(0, 0.3)` since LanceDB returns distance not similarity.
- **stderr-only logging**: All workflow output goes to stderr; `build_context` result JSON goes to stdout.
- **Workflows call process.exit(1) directly**: Fatal conditions (no profile, Ollama not running) exit immediately.
- **CLI commands are thin adapters**: All business logic in `runSearch()` / `runBuildContext()` workflows, not in CLI handlers.

## Project Constraints (from CLAUDE.md)

The following CLAUDE.md directives apply to this phase:

| Directive | Impact on Phase 3 |
|-----------|-------------------|
| No LangChain or LlamaIndex | No retrieval frameworks — implement retriever directly |
| No Vercel AI SDK for Ollama | Use `ollama` npm package directly (already done) |
| No ts-node | Dev with `tsx`, build with `tsup` (already set up) |
| No Postgres or Redis | LanceDB only — already enforced |
| stdout reserved for MCP transport | `build_context` JSON result output must go to stdout; all logging to stderr |
| No over-abstraction | `retriever.ts` and `tokenCounter.ts` are simple flat functions, not class hierarchies |
| AST-aware chunking required | Already done in Phase 2; retriever consumes chunks, does not re-chunk |
| Workflows-first structure | New code goes in `src/services/` (helpers) and `src/workflows/` (orchestrators) |
| CLI commands are thin adapters | `brain-cache search` command delegates to `runSearch()` workflow |
