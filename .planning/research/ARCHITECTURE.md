# Architecture Research

**Domain:** brain-cache v2.2 — retrieval quality improvements integration
**Researched:** 2026-04-03
**Confidence:** HIGH — all findings from direct source inspection of existing codebase

---

## System Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                     MCP Transport Layer                           │
│   src/mcp/index.ts — 6 registered tools, stdio JSON-RPC          │
│   formatToolResponse, formatErrorEnvelope (lib/format.ts)         │
├────────┬──────────────┬──────────────────┬───────────────────────┤
│        │              │                  │                        │
│ index  │ search_      │ build_context    │  trace_flow            │
│ _repo  │ codebase     │                  │  explain_codebase      │
│        │              │                  │  doctor                │
├────────┴──────────────┴──────────────────┴───────────────────────┤
│                      Workflow Layer                               │
│  src/workflows/                                                   │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────┐   │
│  │  search.ts   │  │buildContext  │  │   traceFlow.ts        │   │
│  │              │  │   .ts        │  │                       │   │
│  └──────────────┘  └──────────────┘  └───────────────────────┘   │
│  ┌──────────────┐  ┌──────────────┐                              │
│  │  index.ts    │  │explainCode   │                              │
│  │              │  │   base.ts    │                              │
│  └──────────────┘  └──────────────┘                              │
├──────────────────────────────────────────────────────────────────┤
│                      Service Layer                                │
│  src/services/                                                    │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐  │
│  │retriever.ts│  │compression │  │flowTracer  │  │cohesion.ts │  │
│  │            │  │    .ts     │  │    .ts     │  │            │  │
│  └────────────┘  └────────────┘  └────────────┘  └────────────┘  │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐                  │
│  │tokenCounter│  │configLoader│  │  lancedb   │                  │
│  │    .ts     │  │    .ts     │  │    .ts     │                  │
│  └────────────┘  └────────────┘  └────────────┘                  │
├──────────────────────────────────────────────────────────────────┤
│                       Lib Layer                                   │
│  src/lib/                                                         │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐                  │
│  │  config.ts │  │  types.ts  │  │  format.ts │                  │
│  └────────────┘  └────────────┘  └────────────┘                  │
├──────────────────────────────────────────────────────────────────┤
│                      Data Layer                                   │
│  LanceDB: chunks table, edges table, index_state.json            │
│  Ollama: local embeddings via HTTP                               │
└──────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Modified by v2.2? |
|-----------|----------------|------------------|
| `src/mcp/index.ts` | Registers 6 tools, formats responses, handles protocol | Yes — tool descriptions, trace_flow savings |
| `src/workflows/buildContext.ts` | Orchestrates lookup/trace/explore pipeline, token savings | Yes — passes query tokens to compressChunk |
| `src/workflows/traceFlow.ts` | Embeds entrypoint, BFS seed search, maps hops to output | Yes — entry point resolution, savings metadata |
| `src/workflows/search.ts` | Embeds query, runs searchChunks, returns ranked chunks | No direct change |
| `src/services/retriever.ts` | classifyRetrievalMode, searchChunks, keyword boost reranking | Yes — build-config file noise penalty |
| `src/services/compression.ts` | compressChunk — relevance-gated body stripping | Yes — optional query tokens parameter |
| `src/services/flowTracer.ts` | BFS traversal of edges table, resolveSymbolToChunkId | Yes — deduplicate callsFound |
| `src/lib/format.ts` | Pure formatter functions for all 6 tools | Possibly — if format is source of trace duplication |
| `src/lib/config.ts` | Constants: thresholds, budgets, timeouts | Possibly — new penalty constant |
| `CLAUDE.md` | Routes Claude to correct tool per query type | Yes — sharper routing table |

---

## The 6 Improvements: Integration Map

### Improvement 1: Tool Routing

**Problem:** Test session — Claude called `trace_flow` for "how does buildContext assemble and compress chunks" (code-understanding, not call-path). Claude also used `search_codebase` (locator) for "what config values does brain-cache use" instead of `build_context`.

**Root cause:** MCP descriptions and CLAUDE.md routing table do not sufficiently disambiguate `trace_flow` (call propagation) from `build_context` (code understanding). Positive signals for trace_flow ("trace how a function call propagates") exist, but no negative signals ("do NOT use for questions about internal logic").

**Files that change:**
- `CLAUDE.md` — sharpen routing table: add explicit trigger phrases for `build_context` and explicit "not this" guidance for `trace_flow`
- `src/mcp/index.ts` — `trace_flow` description: add negative signal for code-understanding queries

**Integration scope:** Isolated — pure documentation. No TypeScript changes, no data flow changes, no service dependencies.

---

### Improvement 2: Query-Aware Relevance Boosting

**Problem:** Test session — "how does buildContext assemble chunks" caused buildContext.ts to fall below the 0.85 similarity threshold and get compressed, hiding the most relevant file. The embedding did not align the filename/function name with the query despite the query containing the function name literally.

**Root cause:** `compressChunk` (compression.ts) only looks at `chunk.similarity` — it has no knowledge of whether the chunk's name or filename appears in the query. A chunk named `buildContext` in a query containing "buildContext" should be treated as high-relevance regardless of its vector similarity score.

**Files that change:**
- `src/services/compression.ts` — add optional `queryTokens?: string[]` parameter to `compressChunk`. If queryTokens are provided and any token matches the chunk's filename base or function name, skip compression (treat as high-relevance). The existing rule 2 (similarity >= 0.85) is unchanged; this is an additional bypass.
- `src/workflows/buildContext.ts` — in the lookup-mode path, extract query tokens before compression and pass them to each `compressChunk` call:
  ```typescript
  const queryTokens = extractQueryTokens(query); // reuse from retriever.ts
  const compressed = enriched.map(c => compressChunk(c, queryTokens));
  ```
- `src/services/retriever.ts` — export `extractQueryTokens` (currently private). It already exists and does the right thing (split on whitespace/punctuation, filter short tokens, lowercase).
- `src/workflows/traceFlow.ts` — `compressChunk` calls here pass `similarity: 1`, so compression is always bypassed by rule 2 anyway. When the signature changes to accept optional `queryTokens`, these callers can pass `undefined` or nothing — no behavioral change needed.

**Integration scope:** Moderate. compressChunk signature changes, two callers affected (buildContext + traceFlow), one export added (retriever.ts). Backward-compatible because queryTokens is optional.

**Data flow change:**
```
Before: compressChunk(chunk)
After:  compressChunk(chunk, queryTokens?)

In buildContext.ts lookup path:
  queryTokens = extractQueryTokens(query)
  compressed = enriched.map(c => compressChunk(c, queryTokens))
```

---

### Improvement 3: Trace Entry Point Resolution

**Problem:** Test 4 — `trace_flow` called with verbose entrypoint "chunkFile function in the indexing pipeline" returned `retriever.ts` results instead of `chunker.ts:chunkFile`. Test 5 — same query as bare "chunkFile" resolved correctly.

**Root cause:** `runTraceFlow` embeds the full entrypoint string and uses vector similarity to find the seed chunk. For verbose queries, the embedding drifts from the function name. `flowTracer.ts` already has `resolveSymbolToChunkId` which does exact-name lookup — but it is only called during BFS, not for the initial seed.

**Files that change:**
- `src/workflows/traceFlow.ts` — add a pre-step before vector search: extract candidate symbol names from the entrypoint (bare words >= 3 chars, preferring camelCase/PascalCase tokens), call `resolveSymbolToChunkId` for each, and if any match, use the first matching chunk as seed. Only fall back to vector search if no exact name match is found.

  ```typescript
  // Pseudo-code for new pre-step
  const candidateNames = extractCandidateNames(entrypoint); // e.g. ["chunkFile"]
  for (const name of candidateNames) {
    const seedId = await resolveSymbolToChunkId(table, name, '');
    if (seedId) {
      // use this seed, skip vector search
    }
  }
  // else: existing vector search path
  ```

- `src/services/flowTracer.ts` — `resolveSymbolToChunkId` is already exported. No change needed.

**Integration scope:** Contained to `traceFlow.ts`. The `resolveSymbolToChunkId` service already exists and is exported. No other workflows affected.

**Data flow change:**
```
Before: embed(entrypoint) -> vector search -> seeds[0] -> BFS
After:  extractCandidateNames(entrypoint)
          -> resolveSymbolToChunkId for each candidate
          -> if found: use as seed (bypass vector search)
          -> if not found: embed(entrypoint) -> vector search -> seeds[0] -> BFS
```

---

### Improvement 4: Reduced Search Noise

**Problem:** Test 3 — `vitest.config.ts` and `tsup.config.ts` ranked 3rd and 5th for query "configuration values config settings". Build tool config files matched "config" semantically but are not application config.

**Root cause:** `searchChunks` in `retriever.ts` applies a keyword boost (10% weight) when query tokens appear in file paths. The word "config" in the query matches `*.config.ts` filenames, boosting build-tool config files above application config files.

**Files that change:**
- `src/services/retriever.ts` — in the reranking step of `searchChunks`, apply a build-config penalty to known config-shaped filenames. Use pattern matching (filename ends in `.config.ts` or `.config.js`) rather than an explicit deny list, to avoid rot. The penalty uses a small negative coefficient so the file still appears if it is the only result or if the user queries specifically for it.

  ```typescript
  const BUILD_CONFIG_PENALTY_WEIGHT = 0.05;

  function computeBuildConfigPenalty(chunk: RetrievedChunk): number {
    const base = chunk.filePath.split('/').pop()?.toLowerCase() ?? '';
    if (/\.(config|rc)\.(ts|js|cjs|mjs)$/.test(base)) return 1;
    return 0;
  }

  // In reranking:
  score = similarity * 0.90
        + keywordBoost * 0.10
        - computeBuildConfigPenalty(chunk) * BUILD_CONFIG_PENALTY_WEIGHT;
  ```

**Integration scope:** Isolated to `retriever.ts`. The change is additive to existing reranking. No callers change signature. No tests need updating beyond adding a case for config-file penalty.

---

### Improvement 5: Trace Serialization Duplicate Fix

**Problem:** Test 5 — "Hop 1 call list was noisy. The chunkFile hop listed its callees twice (the full list appears duplicated)."

**Root cause to verify:** In `flowTracer.ts`, `callsFound: callEdges.map(e => e.to_symbol)` — if `queryEdgesFrom` returns duplicate edge rows (same `from_chunk_id` + `to_symbol` pair), the list is duplicated. This is the most likely source. Alternatively, `formatTraceFlow` in `format.ts` could be rendering the calls twice (less likely — formatter just joins the array).

**Files that change:**
- `src/services/flowTracer.ts` — deduplicate `to_symbol` values before building `callsFound`:
  ```typescript
  callsFound: [...new Set(callEdges.map(e => e.to_symbol))],
  ```
  This is the primary fix. The set deduplication is a one-line change.
- `src/lib/format.ts` — check `formatTraceFlow` for any double-render of `callsFound`. Currently: `hop.callsFound.join(', ')`. If flowTracer dedup fixes the issue, no change needed here.

**Integration scope:** Isolated to `flowTracer.ts`. One-line fix. No callers change.

---

### Improvement 6: Honest Token Savings for trace_flow

**Problem:** Test 4 — `trace_flow` reported 67% token savings on a result that resolved the wrong entry point (irrelevant output). The `reductionPct: 67` in the trace_flow MCP handler is hardcoded, not computed.

**Files that change:**
- `src/workflows/traceFlow.ts` — add savings computation to `runTraceFlow`. After building hops, read the full file content for each unique file in the hop set (only files where no hop chunk has compressed content), sum tokens, add tool-call overhead. Store as `estimatedWithoutBraincache` in `TraceFlowResult.metadata`.

  ```typescript
  // TraceFlowResult.metadata extension:
  interface TraceFlowMetadata {
    seedChunkId: string | null;
    totalHops: number;
    localTasksPerformed: string[];
    tokensSent: number;              // NEW
    estimatedWithoutBraincache: number; // NEW
    reductionPct: number;            // NEW
  }
  ```

- `src/mcp/index.ts` — replace `reductionPct: 67` hardcode with values from `result.metadata`:
  ```typescript
  const savings = formatTokenSavings({
    tokensSent: result.metadata.tokensSent,
    estimatedWithout: result.metadata.estimatedWithoutBraincache,
    reductionPct: result.metadata.reductionPct,
    filesInContext: new Set(result.hops.map(h => h.filePath)).size,
  });
  ```

**Integration scope:** Moderate. `TraceFlowResult.metadata` type in `lib/types.ts` or inline in `traceFlow.ts` must be extended. Both `traceFlow.ts` and `mcp/index.ts` change. No other workflows affected.

**Note:** `search_codebase` MCP handler also uses a fabricated estimate (`tokensSent * 3`). This is lower priority — `search_codebase` is a locator tool where exact savings are less meaningful. Address in a follow-up if needed.

---

## Build Order

The improvements split into three independent groups plus one documentation group.

### Group A: Isolated Single-File Fixes

These have no dependencies on each other or on Group B/C. Ship first — lowest risk.

1. **Improvement 5** (trace serialization dedup) — one-line fix in `flowTracer.ts`
2. **Improvement 3** (entry point resolution) — contained to `traceFlow.ts`, uses already-exported `resolveSymbolToChunkId`

### Group B: Retrieval Scoring

3. **Improvement 4** (search noise penalty) — additive change to `retriever.ts`, no callers change

### Group C: Compression + Savings (ship together)

These two touch the same files (`traceFlow.ts`, `buildContext.ts`). Ship in a single plan to avoid double-editing.

4. **Improvement 2** (query-aware compression) — changes `compressChunk` signature, updates two callers, exports `extractQueryTokens`
5. **Improvement 6** (honest trace savings) — extends `TraceFlowResult.metadata`, updates MCP handler

### Group D: Documentation

6. **Improvement 1** (CLAUDE.md + MCP descriptions) — pure documentation, no code risk. Ship last so descriptions reflect the actual behavior delivered in A, B, C.

### Recommended Phase Sequence

```
Phase 22-A: Group A (improvements 5 + 3) — isolated fixes
Phase 22-B: Group B (improvement 4)      — scoring change
Phase 22-C: Group C (improvements 2 + 6) — compression + savings
Phase 22-D: Group D (improvement 1)      — documentation
```

Alternatively, Group A and B can be merged into one phase since they are all isolated.

---

## Integration Classification

| Improvement | Isolated or Cross-Cutting | Files Modified | Test Files Likely Affected |
|-------------|--------------------------|----------------|---------------------------|
| 1 — Tool routing | Isolated (docs only) | `CLAUDE.md`, `src/mcp/index.ts` (description strings) | None |
| 2 — Relevance boosting | Cross-cutting | `src/services/compression.ts`, `src/workflows/buildContext.ts`, `src/workflows/traceFlow.ts`, `src/services/retriever.ts` (export) | `tests/services/compression.test.ts`, `tests/workflows/buildContext.test.ts` |
| 3 — Entry point resolution | Isolated | `src/workflows/traceFlow.ts` | `tests/workflows/traceFlow.test.ts` (if exists) |
| 4 — Search noise | Isolated | `src/services/retriever.ts` | `tests/services/retriever.test.ts` |
| 5 — Trace serialization | Isolated | `src/services/flowTracer.ts` | `tests/services/flowTracer.test.ts` (if exists) |
| 6 — Token savings | Cross-cutting | `src/workflows/traceFlow.ts`, `src/mcp/index.ts` | `tests/workflows/traceFlow.test.ts` |

---

## Data Flow

### Retrieval Pipeline (build_context, lookup mode) — with v2.2 changes annotated

```
Claude calls build_context(query)
    |
    v
mcp/index.ts -> runBuildContext(query)
    |
    v
classifyRetrievalMode(query)          [retriever.ts]
    |
    v
embedBatchWithRetry(query)            [embedder.ts -> Ollama]
    |
    v
searchChunks(table, vector, opts, query)  [retriever.ts]
  -> LanceDB vector search
  -> filter by distanceThreshold
  -> keyword boost reranking
  -> [NEW] build-config file penalty     (improvement 4)
    |
    v
deduplicateChunks()                   [retriever.ts]
    |
    v
assembleContext()                     [tokenCounter.ts]
    |
    v
enrichWithParentClass()               [cohesion.ts]
    |
    v
queryTokens = extractQueryTokens(query) [retriever.ts — newly exported]
enriched.map(c => compressChunk(c, queryTokens))  [compression.ts]
  [NEW] bypass compression if chunk name/file in queryTokens (improvement 2)
    |
    v
groupChunksByFile + formatGroupedContext  [cohesion.ts]
    |
    v
compute token savings baseline        [buildContext.ts:152-199, unchanged]
    |
    v
ContextResult -> MCP response
```

### Trace Flow Pipeline — with v2.2 changes annotated

```
Claude calls trace_flow(entrypoint)
    |
    v
mcp/index.ts -> runTraceFlow(entrypoint)
    |
    v
[NEW] extractCandidateNames(entrypoint)    (improvement 3)
  -> resolveSymbolToChunkId for each name  [flowTracer.ts — already exported]
  -> if found: use as seedId directly
  -> if not: embed + vector search (existing path)
    |
    v
traceFlow(edgesTable, chunksTable, seedId)  [flowTracer.ts]
  -> BFS over call edges
  -> queryEdgesFrom per hop
  -> [NEW] deduplicate to_symbol per hop  (improvement 5)
  -> resolveSymbolToChunkId for each callee
    |
    v
hops.map(compressChunk)     [compression.ts, similarity=1 -> always pass-through]
    |
    v
[NEW] compute tokensSent + estimatedWithoutBraincache  (improvement 6)
  -> read full file content for uncompressed-file hops
  -> sum tokens + tool-call overhead
    |
    v
TraceFlowResult (metadata includes tokensSent, estimatedWithoutBraincache, reductionPct)
    |
    v
mcp/index.ts: reads savings from result.metadata (no more hardcoded 67%)
    |
    v
formatTraceFlow + formatTokenSavings -> MCP response
```

---

## Architectural Patterns

### Pattern 1: Optional Parameter Extension (compressChunk)

**What:** Extend `compressChunk(chunk)` to `compressChunk(chunk, queryTokens?)` with the query tokens being optional. When absent, behavior is identical to current. When present, an additional bypass rule fires.

**When to use:** When a service function needs context from the caller (the original query) but that context is not always available.

**Trade-offs:** Maintains backward compatibility with all existing callers. The traceFlow.ts caller passes `undefined` implicitly — no behavior change there since those chunks have similarity=1 anyway.

### Pattern 2: Pre-Resolution Before Vector Search (traceFlow)

**What:** Before running expensive vector search + BFS, attempt exact-name resolution using the LanceDB WHERE query. If a chunk with that name exists, bypass embedding entirely.

**When to use:** When the caller (Claude) may have already identified the symbol name as part of their query, and exact-name lookup is more reliable than embedding for short function names.

**Trade-offs:** Adds one fast DB query per candidate name. Eliminates embedding latency and reduces seed-search errors for verbose entrypoint queries.

### Pattern 3: Savings Computation in Workflow, Not MCP Handler

**What:** `runTraceFlow` computes `estimatedWithoutBraincache` and returns it in metadata. MCP handler reads it directly.

**When to use:** Any tool that needs accurate token savings reporting. Already established by `buildContext.ts` (lines 152-199); `traceFlow.ts` follows the same pattern.

**Trade-offs:** Adds file I/O to the workflow return path. Justified because savings reporting is a core feature promise of brain-cache.

---

## Anti-Patterns

### Anti-Pattern 1: New File for Each Improvement

**What people do:** Create `src/services/queryAwareCompression.ts`, `src/services/noiseFilter.ts` etc.
**Why it's wrong:** brain-cache has an explicit "no over-abstraction" constraint. All 6 improvements are in-place modifications to existing functions, not new abstractions.
**Do this instead:** Modify the existing function. `compressChunk` gets an optional parameter. `searchChunks` gets an additional scoring term. No new modules.

### Anti-Pattern 2: Making queryTokens Required in compressChunk

**What people do:** `compressChunk(chunk: RetrievedChunk, queryTokens: string[])` — required parameter.
**Why it's wrong:** `traceFlow.ts` compresses hops with `similarity: 1` (always pass-through), so passing query tokens there adds noise with no effect. Callers that don't have a query (e.g. future tooling) would need to pass `[]`.
**Do this instead:** `compressChunk(chunk: RetrievedChunk, queryTokens?: string[])` — optional.

### Anti-Pattern 3: Hardcoding Build-Config File Names in Deny List

**What people do:** `const DENY_LIST = ['vitest.config.ts', 'tsup.config.ts', 'vite.config.ts', ...]`
**Why it's wrong:** The list rots. Users may have custom config files with those names for legitimate application reasons.
**Do this instead:** Pattern-match on filename shape: `*.config.ts`, `*.config.js`, `*.rc.ts`. The user can still retrieve these files by querying specifically for them — the penalty is soft, not a hard filter.

### Anti-Pattern 4: Computing Savings in the MCP Handler

**What people do:** Move the file-read savings loop into the `trace_flow` MCP handler in `mcp/index.ts`.
**Why it's wrong:** MCP handlers should call workflows and format results. File I/O belongs in workflows. `buildContext.ts` already established the correct pattern (savings computed inside `runBuildContext`).
**Do this instead:** Compute `estimatedWithoutBraincache` inside `runTraceFlow`, return it in `TraceFlowResult.metadata`.

---

## Integration Points

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| `mcp/index.ts` → `workflows/*` | Direct function call, typed return | Workflows throw on error; MCP handler catches |
| `workflows/buildContext.ts` → `services/compression.ts` | `compressChunk(chunk, queryTokens?)` | Signature change is backward-compatible |
| `workflows/traceFlow.ts` → `services/flowTracer.ts` | `traceFlow()` and `resolveSymbolToChunkId()` | `resolveSymbolToChunkId` already exported — usable for pre-seed resolution |
| `workflows/traceFlow.ts` → `services/compression.ts` | `compressChunk(chunk)` — similarity=1 always pass-through | Optional queryTokens not needed here |
| `services/retriever.ts` → LanceDB | Async query via `table.query()` | Config penalty is post-fetch scoring — no LanceDB API change |
| `services/flowTracer.ts` → `services/lancedb.ts` | `queryEdgesFrom()` | Dedup fix is in-memory after queryEdgesFrom returns |

### Key Behavioral Invariants to Preserve

1. `compressChunk` with `similarity >= 0.85` still never compresses (rule 2 is unchanged). The query-name bypass is additive.
2. Keyword boost weight in `searchChunks` stays at 10%. The config penalty uses a separate 5% coefficient.
3. `trace_flow` savings must never default to 0% as a "safe" fallback — that falsely signals the tool is not saving anything. Compute real values or report N/A.
4. `resolveSymbolToChunkId` in `flowTracer.ts` must not change its existing signature — `traceFlow.ts` is the only caller of the pre-seed path, and BFS uses it internally.

---

## Sources

- Direct inspection: `src/services/retriever.ts` — `searchChunks`, `extractQueryTokens`, `computeKeywordBoost`
- Direct inspection: `src/services/compression.ts` — `compressChunk`, rule 1/2/3/4 decision tree
- Direct inspection: `src/workflows/buildContext.ts` — full pipeline, savings computation at lines 152-199
- Direct inspection: `src/workflows/traceFlow.ts` — entry point embedding, BFS delegation, hardcoded savings
- Direct inspection: `src/services/flowTracer.ts` — `traceFlow` BFS loop, `callsFound` construction, `resolveSymbolToChunkId`
- Direct inspection: `src/lib/format.ts` — `formatTraceFlow`, `formatTokenSavings`
- Direct inspection: `src/mcp/index.ts` — all 6 tool handlers, hardcoded `reductionPct: 67` in trace_flow handler
- `.planning/debug/claude-debugging-itself-v2.md` — 5 live test sessions with Claude's self-analysis identifying exact failure modes
- `.planning/PROJECT.md` — v2.2 milestone target feature list
- CONFIDENCE: HIGH — all findings from direct code inspection, not inference

---
*Architecture research for: brain-cache v2.2 retrieval quality improvements*
*Researched: 2026-04-03*
