# Phase 9: Indexing and Retrieval Performance — Research

**Gathered:** 2026-04-01
**Requirements:** PERF-01, PERF-02, PERF-03, PERF-04

---

## 1. Current File Reading (PERF-01)

**File:** `src/workflows/index.ts` (lines 71–83)

File reading is **fully sequential** — a plain `for` loop with `await` on every iteration:

```ts
for (let i = 0; i < files.length; i++) {
  const filePath = files[i];
  const content = await readFile(filePath, 'utf-8');
  totalRawTokens += countChunkTokens(content);
  const chunks = chunkFile(filePath, content);
  allChunks.push(...chunks);
  // progress log every 10 files
}
```

Each iteration awaits `readFile`, then synchronously calls `countChunkTokens` and `chunkFile` before moving to the next file. There is no concurrency at all. For a 500-file repo, every file read blocks the event loop for the next.

**No existing concurrency utilities exist anywhere in `src/`.** No `p-limit`, no `Promise.all`, no semaphore pattern. This is a clean addition.

---

## 2. Memory Model — Chunk Accumulation (PERF-02)

**Chunking loop** (lines 71–83): Every chunk from every file is pushed into `allChunks: CodeChunk[]`. All chunks accumulate in memory before the embed+store loop begins.

**Embed+store loop** (lines 90–114): Iterates over `allChunks` in batches of `DEFAULT_BATCH_SIZE` (32), embeds each batch, builds `ChunkRow[]`, and calls `insertChunks`. The batching only applies to the Ollama embedding calls — the full `allChunks` array is held in memory throughout.

For a 10,000-chunk repo: the entire set of `CodeChunk` objects (each with `id`, `filePath`, `chunkType`, `scope`, `name`, `content`, `startLine`, `endLine`) lives in RAM from the end of the chunking loop until `insertChunks` is called for the final batch. With ~1 KB average chunk content, this is roughly 10 MB of raw strings plus object overhead — not catastrophic but unbounded by repo size.

**The pipeline could be restructured:** instead of two separate sequential loops (chunk-all-then-embed), the chunking and embed+store can be interleaved — produce a batch of chunks from N files, embed, store, discard, repeat.

---

## 3. LanceDB Indexing (PERF-03)

**File:** `src/services/lancedb.ts`

`insertChunks` calls `table.add(rows)` — no index creation:

```ts
export async function insertChunks(table: lancedb.Table, rows: ChunkRow[]): Promise<void> {
  if (rows.length === 0) return;
  await table.add(rows);
  log.debug({ count: rows.length }, 'Inserted chunk rows');
}
```

There is currently no vector index at all. LanceDB performs brute-force scan on every `vectorSearch` call, which scales as O(n) with chunk count.

**LanceDB IVF-PQ API is confirmed available** in `@lancedb/lancedb` 0.27.1:

```ts
import { Index } from '@lancedb/lancedb';

// Create IVF-PQ index after all rows are inserted:
await table.createIndex('vector', {
  config: Index.ivfPq({ numPartitions: 256, numSubVectors: 96 }),
});
```

`table.listIndices()` returns an empty array when no index exists and returns `[{name, indexType, columns}]` when one does. This enables a conditional check: if no IVF-PQ index exists and the table exceeds a threshold (e.g., 10,000 rows), create one after inserting.

`table.countRows()` is available to get the current row count after all inserts complete.

**Important constraint:** IVF-PQ requires a minimum number of rows (roughly 256 × `numPartitions` for a meaningful index). With the default `numPartitions: 256`, the minimum is ~256 rows. A 10,000-row threshold is a reasonable guard: it ensures the table is large enough to benefit and satisfies the success criterion.

For typical configs (768-dim nomic-embed-text), recommended starting params:
- `numPartitions`: 256 (for ~10k+ rows, square root heuristic)
- `numSubVectors`: 96 (768 / 8 = 96; each sub-vector covers 8 dimensions)

For mxbai-embed-large (1024-dim): `numSubVectors` = 128 (1024 / 8).

The index creation should be done **after** all chunks are inserted (not per-batch), called at the end of `runIndex` via a new `createVectorIndexIfNeeded` function in `lancedb.ts`.

---

## 4. Separator Token Count (PERF-04)

**File:** `src/services/tokenCounter.ts` — `assembleContext` function (lines 37–62)

```ts
const separator = '\n\n---\n\n';

for (const chunk of chunks) {
  const formatted = formatChunk(chunk);
  const chunkTokens = countChunkTokens(formatted);
  const sepCost = kept.length > 0 ? countChunkTokens(separator) : 0;
  ...
}
```

`countChunkTokens(separator)` is called **on every loop iteration where `kept.length > 0`**. The separator string `'\n\n---\n\n'` is a constant — it never changes across iterations.

Verified: `countTokens('\n\n---\n\n')` = **4 tokens** (static result from `@anthropic-ai/tokenizer`).

The fix is trivial: hoist the separator cost to a constant before the loop:

```ts
const separator = '\n\n---\n\n';
const separatorTokens = countChunkTokens(separator); // compute once

for (const chunk of chunks) {
  const formatted = formatChunk(chunk);
  const chunkTokens = countChunkTokens(formatted);
  const sepCost = kept.length > 0 ? separatorTokens : 0;
  ...
}
```

This eliminates repeated tokenizer calls for the separator on every chunk iteration. The actual runtime impact is small (the tokenizer is fast), but it's a correctness improvement that removes the unnecessary repeated computation DEBT-06 describes.

---

## 5. Concurrency Patterns

No concurrency utilities exist in the codebase. The project does not have `p-limit` or similar in `package.json`. Since the project avoids adding unnecessary dependencies (CLAUDE.md constraint), a concurrency limiter should be implemented inline using native `Promise` with a simple semaphore pattern rather than adding a new npm dependency.

A concurrency-limited file processor can be built with a pool pattern:
- Maintain a pool of N concurrent `readFile` + `chunkFile` tasks
- Collect results in order
- Flush a batch of chunks to embed+store whenever `DEFAULT_BATCH_SIZE` chunks accumulate (or per-file-group to address PERF-02)

The concurrency limit should be a constant (e.g., `FILE_READ_CONCURRENCY = 20`) in `src/lib/config.ts`.

---

## 6. Test Coverage

**`tests/workflows/index.test.ts`** — 13 tests, all passing. Tests cover:
- Pipeline order (crawl → chunk → embed → store → writeIndexState)
- Error cases (no profile, Ollama not running, zero files)
- stdout/stderr output contracts
- Token savings stats in output

**Coverage gaps relevant to Phase 9:**
- No test for concurrent file processing (the sequential loop is mocked away by `readFile` and `chunkFile` mocks)
- No test for IVF-PQ index creation path
- No test asserting memory-bounded behavior (not practical in unit tests, but the batch pipeline structure can be verified)
- The progress logging test (`(100%)`) will need updating if the loop structure changes

**`tests/workflows/buildContext.test.ts`** — 13 tests, all passing. Tests cover assembleContext via mock. No tests for separator token counting specifically, but the `assembleContext` unit tests in the tokenCounter test file (if any) would cover PERF-04.

**Changes to existing tests required:**
- `index.test.ts`: The `(100%)` progress assertion will still pass if we maintain the `processedCount/allChunks.length` output. The concurrent file reading may require adjusting the call-order test if chunk ordering changes.
- `tokenCounter.ts` tests: The `assembleContext` function change for PERF-04 is non-breaking — same behavior, just more efficient. Existing tests will pass without changes.

---

## 7. Implementation Summary by Requirement

| Req | Change Needed | File(s) |
|-----|--------------|---------|
| PERF-01 | Replace sequential `for` loop with concurrency-limited parallel file reads | `src/workflows/index.ts`, `src/lib/config.ts` |
| PERF-02 | Interleave chunking with embed+store — flush each file group's chunks before reading the next group | `src/workflows/index.ts` |
| PERF-03 | Add `createVectorIndexIfNeeded(table)` that calls `table.createIndex` with IVF-PQ config when `countRows() >= threshold` | `src/services/lancedb.ts`, `src/workflows/index.ts` |
| PERF-04 | Hoist `countChunkTokens(separator)` to before the `assembleContext` loop | `src/services/tokenCounter.ts` |

**New constants to add to `src/lib/config.ts`:**
- `FILE_READ_CONCURRENCY = 20` — max parallel file reads (PERF-01)
- `VECTOR_INDEX_THRESHOLD = 10_000` — min chunk count before creating IVF-PQ index (PERF-03)

**No new npm dependencies required.** The concurrency limiter can be implemented with native Promises. LanceDB IVF-PQ API is already in `@lancedb/lancedb` 0.27.1.

---

## RESEARCH COMPLETE
