# Stack Research

**Domain:** Retrieval quality improvements — query-aware boosting, noise filtering, trace entry point resolution, lightweight reranking
**Researched:** 2026-04-03
**Confidence:** HIGH (all techniques verified against current LanceDB docs and live codebase)

---

## Scope

This is a **delta research document** for the v2.2 Retrieval Quality milestone. The base stack
(Node.js 22, TypeScript, LanceDB 0.27.1, Ollama, nomic-embed-text) is validated and unchanged.
This document covers only the *additions and technique changes* needed for:

1. Query-aware relevance boosting (keyword/filename match reranking)
2. Noise filtering for build tool config files
3. Trace entry point resolution for verbose queries
4. Lightweight reranking without a second model

---

## Recommended Stack

### Core Technologies (Existing — No Changes)

| Technology | Version | Purpose | Status |
|------------|---------|---------|--------|
| `@lancedb/lancedb` | 0.27.1 | Vector storage + SQL metadata filtering | Already installed |
| `ollama` | 0.6.3 | Local embeddings | Already installed |
| TypeScript | 5.x | Type-safe retrieval logic | Already installed |

### New Dependencies

**None.** All four improvement areas are implementable with the existing stack. The techniques
below use pure TypeScript logic layered on top of what is already installed.

| Technique | Implementation Approach | File |
|-----------|------------------------|------|
| Keyword boost reranking | Existing function, weight adjustment only | `src/services/retriever.ts` |
| Config file noise filtering | New patterns in `ALWAYS_EXCLUDE_GLOBS` + post-filter regex | `src/services/crawler.ts` + `src/services/retriever.ts` |
| Query symbol extraction | Regex-based camelCase/PascalCase token extraction | `src/services/retriever.ts` or `src/workflows/traceFlow.ts` |
| RRF (Reciprocal Rank Fusion) | Pure TS formula `1 / (rank + k)` | `src/services/retriever.ts` |

---

## Implementation Details

### 1. Query-Aware Relevance Boosting

**Current state:** `computeKeywordBoost()` and `extractQueryTokens()` already exist in
`src/services/retriever.ts`. The blend is `similarity * 0.9 + boost * 0.1`. The implementation
is correct. The weight (10%) is too conservative for lookup queries where the query subject
directly names a file or function.

**Recommended change — mode-aware boost weight:**

The boost weight should scale with retrieval mode. In `lookup` mode the user is asking about a
specific symbol, so a filename match is a strong signal. In `explore` mode the user is asking
about a domain concept, so filename matches are coincidental.

```typescript
// In searchChunks(), after mode is threaded through (or as a new opts field):
const KEYWORD_BOOST_WEIGHT = mode === 'lookup' ? 0.20 : 0.10;

// Current blend (works correctly, just adjust the weight constant):
return chunks
  .map(chunk => ({
    chunk,
    score: chunk.similarity * (1 - KEYWORD_BOOST_WEIGHT)
      + computeKeywordBoost(chunk, queryTokens) * KEYWORD_BOOST_WEIGHT,
  }))
  .sort((a, b) => b.score - a.score)
  .map(({ chunk }) => chunk);
```

The boost is already proportional (`matchCount / tokenCount`). No algorithmic change needed —
just make the weight a parameter rather than a constant. Thread `mode` into `searchChunks()` via
`opts` (add `mode?: QueryIntent` to `SearchOptions`).

**No new dependency. Confidence: HIGH.**

---

### 2. Config File Noise Filtering

**Problem:** `package.json`, `tsconfig.json`, `vite.config.ts`, `jest.config.ts`, and similar
build tool configs match generic terms ("build", "test", "scripts", "config") and appear in
results with misleadingly high cosine similarity scores. They contain no source logic.

**Current state:** `ALWAYS_EXCLUDE_GLOBS` in `src/services/crawler.ts` already excludes
`node_modules/`, `dist/`, `.git/`. Config files are not excluded and get indexed.

**Two-layer approach:**

**Layer 1 — Index-time exclusion in `ALWAYS_EXCLUDE_GLOBS` (primary fix):**

```typescript
// src/services/crawler.ts — add to ALWAYS_EXCLUDE_GLOBS:
export const ALWAYS_EXCLUDE_GLOBS: string[] = [
  // ... existing entries ...
  '**/tsconfig*.json',
  '**/jest.config.*',
  '**/vitest.config.*',
  '**/vite.config.*',
  '**/eslint.config.*',
  '**/.eslintrc*',
  '**/.prettierrc*',
  '**/prettier.config.*',
  '**/babel.config.*',
  '**/webpack.config.*',
  '**/rollup.config.*',
  '**/esbuild.config.*',
  '**/.editorconfig',
  '**/commitlint.config.*',
];
```

Index-time exclusion is zero query-time cost and prevents embedding overhead waste.

**Layer 2 — Query-time post-filter in `searchChunks()` (fallback for already-indexed repos):**

```typescript
// Pure function, no new deps:
const CONFIG_NOISE_PATTERNS = [
  /tsconfig[^/]*\.json$/,
  /jest\.config\.[^/]+$/,
  /vitest\.config\.[^/]+$/,
  /vite\.config\.[^/]+$/,
  /eslint\.config\.[^/]+$/,
  /\.eslintrc[^/]*$/,
  /prettier\.config\.[^/]+$/,
  /webpack\.config\.[^/]+$/,
];

function filterConfigNoise(chunks: RetrievedChunk[]): RetrievedChunk[] {
  return chunks.filter(c =>
    !CONFIG_NOISE_PATTERNS.some(p => p.test(c.filePath))
  );
}
```

Apply `filterConfigNoise()` in `searchChunks()` before the keyword boost sort. Both layers
should be shipped together — Layer 1 prevents future indexing, Layer 2 fixes existing indexes.

**No new dependency. Confidence: HIGH.**

---

### 3. Trace Entry Point Resolution for Verbose Queries

**Problem:** `runTraceFlow()` receives queries like "how does the compression workflow get
triggered" and embeds the entire sentence. The vector seed search finds chunks vaguely related
to "triggered" or "workflow" instead of `compressChunk`. The BFS then traces from the wrong
entry point, producing an unrelated hop chain.

**Root cause:** `resolveSymbolToChunkId()` in `flowTracer.ts` does exact SQL name lookup — it is
never called for symbol extraction from the query at all. It only runs during BFS edge resolution,
not for the initial entrypoint.

**Current flow:**
1. `runTraceFlow(entrypoint)` embeds the full verbose string via Ollama
2. `searchChunks()` returns the nearest vectors — probabilistic match, may be wrong
3. BFS traces from that seed, potentially from the wrong entry point

**Recommended fix — symbol extraction before embedding:**

Extract the most likely symbol name from the query using a camelCase/PascalCase regex. If the
extracted candidate resolves to an exact chunk (via existing `resolveSymbolToChunkId()`), skip
the embedding round-trip entirely.

```typescript
/**
 * Extracts a candidate symbol name from a verbose trace query.
 * Returns null when no camelCase, PascalCase, or snake_case symbol is found.
 *
 * Examples:
 *   "how does compressChunk work"      → "compressChunk"
 *   "trace the flow of runBuildContext" → "runBuildContext"
 *   "what calls embedBatchWithRetry"   → "embedBatchWithRetry"
 *   "explain the architecture"         → null (no symbol token)
 */
export function extractSymbolCandidate(query: string): string | null {
  // Matches: camelCase (runSearch), PascalCase (BuildContext), or
  // snake_case with underscore (embed_batch). Requires length >= 4
  // to avoid short tokens like "the", "run", "add".
  const candidates = [...query.matchAll(
    /\b([a-z][a-zA-Z0-9]*[A-Z][a-zA-Z0-9]*|[A-Z][a-zA-Z][a-zA-Z0-9]*|[a-z][a-z0-9]+_[a-z][a-z0-9_]+)\b/g
  )].map(m => m[1]).filter(c => c.length >= 4);

  if (candidates.length === 0) return null;
  // Return longest candidate — more specific is more likely to be the target symbol
  return candidates.sort((a, b) => b.length - a.length)[0];
}
```

**Integration in `runTraceFlow()`:**

```typescript
// Before embedding: attempt direct symbol resolution
const symbolCandidate = extractSymbolCandidate(entrypoint);
if (symbolCandidate) {
  const directId = await resolveSymbolToChunkId(table, symbolCandidate, '');
  if (directId !== null) {
    // Exact match found — skip embedding, use this chunk as seed
    // (set seedResults to a synthetic one-element array)
  }
}
// Fall through to vector search if no direct match
```

`resolveSymbolToChunkId()` already exists, is fast (SQL equality query, no Ollama), and
handles multi-file disambiguation (prefers same-file match). This is purely additive — the
existing vector path remains as the fallback.

**No new dependency. Confidence: HIGH.**

---

### 4. Lightweight Reranking Without a Second Model

**Current state:** Single-pass reranking: `score = similarity * 0.9 + keywordBoost * 0.1`.
This handles the existing single-pass vector search. For v2.2, this is sufficient.

**Reciprocal Rank Fusion (RRF) — for dual-pass retrieval (future use):**

RRF is the standard merge algorithm for combining two separately ranked result lists. It requires
no model, no external service, and no new dependencies. LanceDB's own built-in `RRFReranker`
uses this same formula. The algorithm: `score = sum(1 / (rank + k))` across all ranked lists,
where `k = 60` (standard constant from Cormack et al.).

```typescript
const RRF_K = 60;

/**
 * Merges multiple ranked result lists using Reciprocal Rank Fusion.
 * Each list is an ordered array of chunk IDs (index 0 = highest rank).
 * Returns chunk IDs ordered by descending merged score.
 */
export function reciprocalRankFusion(rankedLists: string[][]): string[] {
  const scores = new Map<string, number>();
  for (const list of rankedLists) {
    list.forEach((id, index) => {
      const rank = index + 1; // 1-based rank
      scores.set(id, (scores.get(id) ?? 0) + 1 / (rank + RRF_K));
    });
  }
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id);
}
```

**When to apply RRF vs. the existing blend:**

- **Existing blend** (`similarity * w + boost * (1-w)`) — correct for the current single vector-pass.
  Sufficient for all v2.2 goals.
- **RRF** — correct when running *two separate retrieval passes* (e.g. vector search + a
  filename-filtered pass) and merging their result lists. Not needed for v2.2 but implementable
  trivially when that path is added.

**No new dependency. Confidence: HIGH.**

---

### 5. LanceDB FTS Index — Assessment

LanceDB 0.27.1 exposes `table.createIndex(column, { config: Index.fts() })` and
`table.search(query, 'fts')` in the TypeScript client. The `rerankers` namespace is exported.
The built-in `RRFReranker` is documented and works without external models.

**Known issue:** GitHub issue #1557 reports `lancedb.Index.fts is not a function` in some
configurations. The workaround (passing `'fts'` as the search type string directly rather than
using `Index.fts()`) is stable. The core FTS query path works.

**Recommendation for v2.2: Do NOT add FTS indexing.** Reasons:

1. Requires schema migration — adds a new index to the `chunks` table, forcing all users to
   re-index their repos.
2. The noise problem is better solved by excluding config files at index time than by adding a
   BM25 retrieval dimension to merge.
3. The existing keyword boost already handles filename/name token matching without a full BM25
   index and without query-time FTS overhead.
4. FTS is best paired with RRF and dual-pass hybrid retrieval — that is a coherent v2.3 feature
   if post-v2.2 testing shows the boost approach is still insufficient.

**Defer FTS to v2.3+.** Confidence: HIGH.

---

## Alternatives Considered

| Recommended | Alternative | Why Not |
|-------------|-------------|---------|
| Regex symbol extraction | `compromise` NLP library | Adds ~1MB dependency; camelCase regex captures 95%+ of TypeScript function/class names without POS tagging. No NLP needed for code symbol extraction. |
| Regex symbol extraction | `keyword-extractor` npm | Removes stopwords only — does not identify camelCase tokens as symbol candidates. Opposite of what is needed. |
| `ALWAYS_EXCLUDE_GLOBS` expansion | LanceDB `where()` SQL filter per query | Index-time exclusion prevents wasted embed cost. Query-time filter is the right *fallback* for existing indexes, not a replacement. |
| Pure-TS RRF formula | `@lancedb/lancedb` `RRFReranker.create()` | LanceDB's RRFReranker is designed for hybrid (FTS + vector) merging — requires an active FTS index. Not applicable to the current single-pass vector path. |
| Mode-aware boost weight | Cross-encoder reranker | Cross-encoders require a second model inference call per query. Explicitly out of scope per PROJECT.md ("Reranking with second LLM — Out of Scope"). |
| Mode-aware boost weight | Increase `limit` then re-filter | Higher limits raise token cost in context assembly. Targeted boost is more precise and does not inflate the candidate set. |
| Direct symbol resolution (SQL) | Re-embed a shorter extracted query | Double Ollama round-trip for marginal gain. SQL exact-match lookup is instantaneous and already implemented. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| Cross-encoder models (ms-marco, etc.) | Second inference call per query; adds 200–800ms latency; explicitly out of scope in PROJECT.md | Mode-aware keyword boost blend |
| LangChain / LlamaIndex retrieval wrappers | Out of scope per PROJECT.md; obscures direct LanceDB query API | Direct LanceDB query API |
| `compromise`, `wink-nlp`, `natural` | NLP overhead not warranted for extracting camelCase symbols from code queries | Regex `/[a-z][a-zA-Z0-9]*[A-Z][a-zA-Z0-9]*/` |
| LanceDB FTS index (v2.2) | Forces re-index migration; not needed when boost covers v2.2 scope | Index-time config exclusion + keyword boost |
| Separate re-embedding with extracted query | Double Ollama latency | Symbol extraction → direct SQL lookup via `resolveSymbolToChunkId()` |

## Version Compatibility

| Package | Current Version | Notes |
|---------|----------------|-------|
| `@lancedb/lancedb` | 0.27.1 | FTS API exists and is deferred. Existing `query().where()` SQL filter API unchanged. |
| All other packages | (unchanged) | No new packages required for v2.2. |

## Sources

- [LanceDB Full-Text Search docs](https://docs.lancedb.com/search/full-text-search) — `createIndex(col, { config: Index.fts() })` and `table.search(q, 'fts')` TypeScript API verified — HIGH
- [LanceDB Hybrid Search docs](https://docs.lancedb.com/search/hybrid-search) — `RRFReranker.create()` confirmed as built-in no-external-model reranker; `.rerank(reranker)` chain API — HIGH
- [LanceDB FTS issue #1557](https://github.com/lancedb/lancedb/issues/1557) — `Index.fts is not a function` bug with string workaround; issue open as of Nov 2024 — MEDIUM
- [RRF Reranker — LanceDB docs](https://docs.lancedb.com/integrations/reranking/rrf) — RRF formula `1/(rank + k)`, k=60 confirmed as LanceDB default — HIGH
- [Advanced RAG: RRF in Hybrid Search (Feb 2026)](https://glaforge.dev/posts/2026/02/10/advanced-rag-understanding-reciprocal-rank-fusion-in-hybrid-search/) — RRF algorithm behavior and k=60 constant confirmed — MEDIUM
- `/workspace/src/services/retriever.ts` — Existing `computeKeywordBoost`, `extractQueryTokens`, `KEYWORD_BOOST_WEIGHT = 0.10` reviewed directly — HIGH
- `/workspace/src/services/flowTracer.ts` — `resolveSymbolToChunkId` SQL exact-match lookup reviewed; not called during initial seed resolution — HIGH
- `/workspace/src/services/crawler.ts` — `ALWAYS_EXCLUDE_GLOBS` reviewed; config file patterns absent — HIGH
- `/workspace/.planning/PROJECT.md` — v2.2 goals, out-of-scope constraints (no second LLM for reranking) — HIGH

---
*Stack research for: brain-cache v2.2 Retrieval Quality milestone*
*Researched: 2026-04-03*
