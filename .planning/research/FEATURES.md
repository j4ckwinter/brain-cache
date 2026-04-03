# Feature Research

**Domain:** Retrieval quality improvements for brain-cache v2.2 — fixing tool routing, retrieval accuracy, and output quality
**Researched:** 2026-04-03
**Confidence:** HIGH (primary evidence from direct codebase reads and documented test session failures; supplemented by RAG ecosystem research)

---

## Context: Scope of This Research

This research covers the **v2.2 Retrieval Quality** milestone only. v2.1 shipped a polished presentation layer. v2.2 fixes the underlying accuracy and routing problems that surfaced during testing sessions.

**Five improvement areas from the milestone, each tied to a documented test failure:**

1. **Query-term boosting** — query containing "buildContext" should rank buildContext.ts above the 0.85 threshold so it is not compressed (Test 1)
2. **Preventing compression of high-relevance results** — when a file matching the query is compressed, Claude must do follow-up reads, negating savings (Test 1)
3. **Reducing noise from build tool config files** — vitest.config.ts and tsup.config.ts ranked 3rd and 5th for "config values" query (Test 3)
4. **Tool selection guidance for AI agents** — Claude used trace_flow for an intra-file logic question and search_codebase for a "how does X work" question (Tests 3, 4)
5. **Honest token savings metrics** — trace_flow claimed 67% savings on a result that was abandoned as wrong (Test 4); search_codebase claimed savings on a result that required 3 follow-up reads (Test 3)

**What already exists (not in scope for v2.2):**
- Vector similarity search with distance threshold filtering
- 10% keyword boost blend in `searchChunks` for filename/name reranking (already in `retriever.ts`)
- 0.85 similarity gate protecting high-relevance chunks from compression (already in `compression.ts`)
- `.braincacheignore` custom exclusion patterns (already in v2.0)
- CLAUDE.md routing table with tool-to-query-type mappings (already in v2.0)

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features that must work correctly for brain-cache to be trustworthy. Missing or broken = users stop trusting tool output and fall back to manual file reads.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Identifier-aware retrieval boosting** | When a query contains a specific symbol name or filename ("buildContext", "compression.ts"), the file/function by that exact name must rank at or near the top — not below generic semantic matches | MEDIUM | The 10% keyword boost weight in `retriever.ts` is already implemented but undersized; a 40% weight is the standard starting point for hybrid search. Tied to Test 1 failure: buildContext.ts fell below 0.85 despite the query literally containing "buildContext" |
| **Non-compression guarantee for high-relevance matches** | A chunk with similarity >= 0.85 already bypasses compression (rule 2 in `compression.ts`). The gap: the query-term boost currently only affects *ranking order*, not the stored similarity score — so a well-ranked chunk can still be compressed if its raw embedding similarity is below 0.85 | MEDIUM | The fix is to carry the blended reranking score through to the `similarity` field on `RetrievedChunk` so compression decisions see the boosted score, not just the raw cosine distance. Tied to Test 1: buildContext.ts body was stripped despite being the most relevant file |
| **Build tool config file exclusion from application queries** | vitest.config.ts, tsup.config.ts, package.json, .eslintrc, and similar build/infra configs match many generic programming terms ("config", "options", "setup") but are almost never the answer to application-logic questions | LOW | Implement a built-in exclusion list for well-known non-application file patterns (*.config.ts, *.config.js, vitest.config.*, tsup.config.*, eslint.config.*) that applies during post-search filtering. Tied to Test 3: vitest.config.ts ranked 3rd for "config values" |
| **Correct tool classification in CLAUDE.md and tool descriptions** | Claude chose trace_flow for "walk me through logic in chunkFile" (an intra-file logic question) and search_codebase for "what config values does brain-cache use" (a "how does it work" question). Tool descriptions must carry explicit negative examples showing when NOT to use each tool | LOW | No code changes — pure description and CLAUDE.md text update. Tied to Tests 3 and 4: wrong tool selection on 2 of 4 tests observed |
| **Zero token savings claimed for discarded/wrong results** | trace_flow reported "67% savings" on a result that was completely discarded as wrong (Test 4). Claiming savings on irrelevant output is misleading — it trains users to distrust the savings metric entirely | LOW | Guard: if hops array is empty, or if the result was abandoned without being used, report 0% savings. More precisely: only report savings after a result is confirmed non-empty. Tied to Test 4: 67% claimed on empty/wrong trace |

### Differentiators (Competitive Advantage)

These exceed bare correctness — they make brain-cache noticeably more accurate and trustworthy than a naive vector search.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Score passthrough from reranking to compression** | Today the blended score (vector + keyword boost) is used only for ranking order, then discarded — compression uses only the original cosine similarity. Carrying the blended score through means that a chunk which is highly relevant to the query (high keyword match + decent vector score) is protected from compression, even if its raw cosine distance is slightly below the 0.85 threshold | MEDIUM | Requires `searchChunks` to return a `rerankedScore` alongside `similarity`, and compression to use whichever is higher. This is the correct fix for Test 1 and closes the gap between "ranked first" and "protected from compression" |
| **Configurable application-file-only mode** | A toggle (default: on) that filters search results to application source files only, excluding known infrastructure patterns. Makes the tool reliable for the primary use case (understanding application logic) without removing the ability to search build configs when explicitly needed | LOW | One filter function applied post-search. User can disable per-query or via config.json. This is more targeted than `.braincacheignore` (which removes files from indexing entirely) — these files stay indexed but are demoted in application-logic queries |
| **Negative example routing in CLAUDE.md and tool descriptions** | Current descriptions say what each tool IS for. Adding explicit "Do NOT use this tool when..." statements reduces ambiguous tool calls where the description-match looks plausible but the tool is wrong | LOW | Pattern used by GitHub Copilot Workspace, atlas-mcp-server, and other multi-tool MCP servers — negative examples improve LLM tool selection more than positive examples alone |
| **Trace entry point exact-match preference** | When the trace_flow entrypoint query exactly matches a function name in the index (case-insensitive), use that as the seed without vector search — bypassing embedding similarity entirely. Resolves Test 4 (trace_flow seeded on retriever code when given "chunkFile function") and Test 1 (trace_flow seeded on assembleContext when given "buildContext workflow") | MEDIUM | Requires a pre-search name lookup: `chunksTable.query().where("name = '...'")` before falling back to vector search. Builds on `resolveSymbolToChunkId` already in `flowTracer.ts` |
| **Honest savings only on uncompressed, non-empty results** | Token savings should be reported only when brain-cache actually saved tokens the user would otherwise have spent — not on compressed files Claude will re-read, not on empty results, not on discarded traces | LOW | Extend the existing savings baseline logic in `buildContext.ts` (which already excludes files with compressed chunks) to also gate on result non-emptiness and to set savings to 0 when the result was produced by a wrong-seed trace |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **Cross-encoder reranking (second model call)** | Industry RAG systems use a cross-encoder as a second pass to dramatically improve precision (BM25 + dense + rerank combo hits 87% recall vs 71% for dense alone) | Requires a second Ollama model load, adds 200-800ms latency per query, and violates the "no unnecessary complexity" constraint. The existing 10% keyword boost already partially addresses this for code search — the marginal gain from a cross-encoder doesn't justify the operational overhead for a local developer tool | Increase the keyword boost weight to 40% (hybrid weighting standard) and carry blended scores through to compression. This captures most of the precision gain with zero latency overhead |
| **BM25 sparse index alongside LanceDB** | Hybrid BM25 + vector search is the SOTA approach for text retrieval | Requires a second index maintained in sync with LanceDB, adds dependency complexity, and is likely overkill for codebase-size corpora (typically 10K-100K chunks). LanceDB's FTS (full-text search) capabilities would be the right path if BM25 is ever needed | Rely on LanceDB's built-in full-text search or the existing token-level boost for keyword precision; don't add a second database |
| **Dynamic exclusion lists from config** | Users want to tune which files are excluded | Adds surface area for misconfiguration; the built-in list should handle 90%+ of cases. The existing `.braincacheignore` already handles project-specific exclusions at index time | Add well-known patterns to the built-in exclusion list; use `.braincacheignore` for project-specific cases |
| **LLM-based intent classification for tool routing** | LLM classification would be more accurate than keyword bigrams | Adds a Claude API round-trip (300-500ms) to every tool call, defeating the "reduce Claude token usage" core value. The current keyword classifier is fast, local, and the routing bugs are in the tool *descriptions*, not the intent classifier | Fix the CLAUDE.md routing table and tool descriptions; the intent classifier is not the root cause |
| **Per-query savings toggle (show/hide)** | Users who trust the tool don't want savings noise | Adds a parameter to every tool call signature. The real fix is accurate savings numbers — accurate metrics are not annoying, inflated ones are | Fix the calculation so savings are only claimed when earned; don't add a toggle |

---

## Feature Definitions (Concrete Behaviours)

### 1. Identifier-aware boosting — what "larger keyword weight" means

The existing blend in `searchChunks` is:

```
score = similarity * 0.90 + keywordBoost * 0.10
```

The failure mode: a query like "how does buildContext assemble chunks" produces `keywordBoost = 1.0` for `buildContext.ts` (exact name match) but the blended score is only `0.88 * 0.90 + 1.0 * 0.10 = 0.89`, which might not change the rank order enough. More critically, the `similarity` field on the returned `RetrievedChunk` is still the raw cosine similarity (0.82), not the blended score — so compression sees 0.82 (below 0.85) and strips the body.

**Fix:** Increase `KEYWORD_BOOST_WEIGHT` from 0.10 to 0.40. Update `searchChunks` to set `chunk.similarity = blendedScore` (not raw cosine similarity) so compression and downstream consumers see the query-aware score. This closes the Test 1 failure in one change.

Expected observable behavior: "How does buildContext work?" returns buildContext.ts with body intact, not a compressed manifest.

### 2. Build tool config exclusion — what the filter looks like

A post-search filter applied in `searchChunks` (or as a caller-side filter in each workflow) before returning results:

```
INFRASTRUCTURE_FILE_PATTERNS = [
  /vitest\.config\.[tj]s$/,
  /tsup\.config\.[tj]s$/,
  /eslint\.config\.[tj]s$/,
  /.eslintrc(\.(js|ts|json|yml|yaml))?$/,
  /prettier\.config\.[tj]s$/,
  /babel\.config\.[tj]s$/,
  /jest\.config\.[tj]s$/,
  /webpack\.config\.[tj]s$/,
  /rollup\.config\.[tj]s$/,
  /vite\.config\.[tj]s$/,
]
```

Applied only when the query does NOT explicitly mention the infrastructure tool name (e.g. a query containing "vitest" should still return vitest.config.ts). Detection: if any pattern token from `extractQueryTokens` appears in the infrastructure file name, pass it through.

Expected observable behavior: "What config values does brain-cache use?" returns config.ts, configLoader.ts, types.ts — not vitest.config.ts or tsup.config.ts.

### 3. Tool routing — what the CLAUDE.md update looks like

Current CLAUDE.md routing table has positive examples. The update adds:

- `build_context` section: "Do NOT use trace_flow to understand how a single function works internally — trace_flow traces call paths ACROSS files, not logic WITHIN a function."
- `trace_flow` section: "Do NOT use trace_flow for queries about how something works, what it does, or explaining logic. Use build_context for those."
- `search_codebase` section: "Do NOT use search_codebase for 'how does X work' questions — it returns file locations, not explanations. Use build_context for understanding questions."
- `build_context` section: add "Use for: 'How does X work?', 'Explain the logic in Y', 'What does this function do?'" to reinforce the positive case.

The tool description strings in `mcp/index.ts` should mirror these negatives for tool discovery (MCP servers without CLAUDE.md).

Expected observable behavior: "Walk me through the logic in chunkFile" → Claude calls build_context, not trace_flow.

### 4. Honest token savings — what "zero for empty/wrong results" means

Current flow: `buildContext.ts` computes savings after assembly, regardless of whether the assembled result is useful. `traceFlow.ts` doesn't compute savings at all (the MCP handler estimates them separately using a crude `tokensSent * 3` multiplier).

**Fix 1 (trace_flow):** If `result.hops.length === 0`, report `tokensSent: 0`, `estimatedWithout: 0`, `reductionPct: 0`. Never claim savings on an empty trace.

**Fix 2 (search_codebase handler):** Replace the `tokensSent * 3` rough multiplier with a calculation that accounts for the fact that search results are file locators, not complete file reads. The savings from search_codebase are minimal (Claude will read the files anyway) — report the actual tokens sent in the result, with estimatedWithout reflecting one tool call overhead only, not full file reads.

**Fix 3 (build_context trace path):** When trace mode returns an empty hops array and falls back, report savings as 0 for the trace step rather than claiming the fallback savings retroactively.

Expected observable behavior: trace_flow on a wrong-seed query shows "0% reduction" in the footer, not "67% reduction".

### 5. trace_flow duplicate call list — the serialization bug

Test 5 noted: "Hop 1 call list was noisy. The chunkFile hop listed its callees twice (the full list appears duplicated)."

Looking at `traceFlow.ts` line 101-122: the `hops` output includes `callsFound: hop.callsFound` from `flowTracer.ts`. The `flowTracer.ts` line 102 builds `callsFound: callEdges.map(e => e.to_symbol)`. This produces the correct list once. The duplication is in the MCP formatter (`formatTraceFlow` in `src/lib/format.ts`), not in the data — the formatter likely renders `callsFound` twice during template assembly.

Expected observable behavior: each hop shows its calls list exactly once.

---

## Feature Dependencies

```
[Score passthrough from reranking to compression]
    └──requires──> [Keyword boost weight increase]
    └──enables──>  [Non-compression of identifier-matched chunks]

[Build tool config exclusion filter]
    └──independent──> (no upstream dependencies)
    └──should NOT remove from index──> .braincacheignore handles index exclusion; this is query-time filtering only

[Tool routing CLAUDE.md update]
    └──independent──> (pure text change, no code dependencies)
    └──parallel-with──> [Tool description update in mcp/index.ts]

[Honest token savings]
    └──requires──> [Non-empty trace result guard]
    └──modifies──> [buildContext.ts savings baseline logic]
    └──modifies──> [mcp/index.ts search handler savings estimate]

[trace_flow duplicate call list fix]
    └──independent──> (bug in format.ts renderer, not in flowTracer.ts or traceFlow.ts)
```

### Dependency Notes

- **Score passthrough requires boost weight change first:** Carrying the blended score to `similarity` only makes sense if the blend weight is meaningful. At 10% weight, the blended score barely differs from raw cosine. Increase to 40% first, then passthrough is worthwhile.
- **Build tool exclusion is purely additive:** No existing feature depends on infrastructure files appearing in results. Safe to ship independently.
- **CLAUDE.md and tool descriptions are independent of code changes:** These can ship in the same PR as any other fix, or alone. Routing accuracy depends on neither code fix nor vice versa.
- **Savings fix is layered:** The empty-trace guard is a 2-line change. The search_codebase multiplier fix is a separate concern. Both are low-risk and can ship together.
- **Duplicate call list bug is in `format.ts`:** Does not affect retrieval logic. Safe to fix in isolation.

---

## MVP Definition for v2.2

### Launch With (v2.2 core — all required for milestone)

- [ ] **Keyword boost weight: 0.10 → 0.40** — primary fix for Test 1 (buildContext.ts compressed despite query match); one constant change in `retriever.ts`
- [ ] **Score passthrough to similarity field** — carry blended score to `chunk.similarity` in `searchChunks` so compression rule 2 fires correctly; one-line change in `retriever.ts`
- [ ] **Build tool config exclusion filter** — post-search filter for vitest.config.ts / tsup.config.ts / eslint.config.ts etc. applied to non-infrastructure queries; fixes Test 3 noise
- [ ] **CLAUDE.md routing table update** — add negative examples ("Do NOT use trace_flow for..."); fixes Tests 3 and 4 tool selection
- [ ] **Tool description updates in mcp/index.ts** — mirror the negative examples in the MCP tool descriptions for Claude Code's tool selection
- [ ] **trace_flow empty-result savings guard** — report 0% savings when hops array is empty; fixes Test 4 fraudulent 67% claim
- [ ] **trace_flow duplicate call list fix** — find and fix the double-render in `formatTraceFlow` in `format.ts`; fixes Test 5 output noise
- [ ] **trace_flow exact-match seed resolution** — try `name = 'X'` lookup before vector search for entrypoint; fixes Test 4 wrong-seed trace

### Add After Validation (v2.2.x)

- [ ] **search_codebase savings estimate correction** — replace crude `tokensSent * 3` multiplier with a calculation based on actual search results; low priority, less misleading than trace_flow's 67% on wrong results
- [ ] **Infrastructure file filter per-query bypass** — if query tokens include an infrastructure tool name, pass those files through; needed to avoid over-filtering when user explicitly asks about build config

### Future Consideration (v2.3+)

- [ ] **LanceDB FTS hybrid search** — if keyword boost at 40% is insufficient for precision, add a full-text search pass through LanceDB's native FTS; adds latency but no new dependency
- [ ] **Cross-encoder reranking** — only if the blended score approach proves insufficient at scale; adds second Ollama model requirement

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority | Test Failure |
|---------|------------|---------------------|----------|--------------|
| Keyword boost weight 0.10 → 0.40 | HIGH | LOW (1 constant) | P1 | Test 1 |
| Score passthrough to similarity | HIGH | LOW (1 field assignment) | P1 | Test 1 |
| Build tool config exclusion | HIGH | LOW (filter function + pattern list) | P1 | Test 3 |
| CLAUDE.md routing table update | HIGH | LOW (text edit) | P1 | Tests 3, 4 |
| MCP tool description negative examples | HIGH | LOW (text edit) | P1 | Tests 3, 4 |
| trace_flow empty-result savings guard | MEDIUM | LOW (2-line guard) | P1 | Test 4 |
| trace_flow duplicate call list fix | MEDIUM | LOW (bug in format.ts) | P1 | Test 5 |
| trace_flow exact-match seed resolution | HIGH | MEDIUM (pre-search name lookup) | P1 | Tests 1, 4 |
| search_codebase savings estimate correction | LOW | MEDIUM (recalculate baseline) | P2 | Test 3 (indirect) |
| Infrastructure filter per-query bypass | LOW | LOW | P2 | — |
| LanceDB FTS hybrid search | LOW | HIGH | P3 | — |

---

## Comparison: Existing vs Required Behavior Per Test

| Test | Query | Expected Tool | Actual Tool Used | Root Cause | Fix |
|------|-------|--------------|-----------------|------------|-----|
| Test 1 | "how does buildContext assemble chunks" | build_context | trace_flow (wrong seed) + build_context (compressed result) | trace_flow seeded on assembleContext not buildContext; similarity 0.82 < 0.85 triggered compression on the most relevant file | Exact-match seed lookup + score passthrough |
| Test 2 | "explain compression.test.ts" | Read (direct) | Read (correct) | N/A — direct read was appropriate | No change needed |
| Test 3 | "what config values does brain-cache use" | build_context | search_codebase (wrong tool); vitest.config.ts ranked 3rd | search_codebase used for understanding question; infrastructure files polluted results | CLAUDE.md routing update + build tool exclusion filter |
| Test 4 | "how does indexing pipeline chunk files" (verbose query) | search_codebase → build_context | trace_flow (wrong seed → retriever.ts) | Long, verbose entrypoint query — semantic embedding anchored to retriever.ts instead of chunker.ts | Exact-match seed lookup; shorten entrypoint extraction |
| Test 5 | Same query with shorter entrypoint "chunkFile" | trace_flow (correct seed) | trace_flow (correct, but noisy output) | Correct seed found; duplicate callsFound in output | Fix formatTraceFlow double-render |

---

## Sources

- `/workspace/.planning/debug/claude-debugging-itself-v2.md` — 5 test sessions documenting actual failures, wrong tool calls, wrong seeds, inflated savings claims, and output noise (HIGH confidence — direct test results)
- `/workspace/src/services/retriever.ts` — `searchChunks`, `computeKeywordBoost`, `extractQueryTokens`, existing 10% blend weight (HIGH confidence — direct codebase read)
- `/workspace/src/services/compression.ts` — `compressChunk`, rules 1-4, 0.85 threshold (HIGH confidence — direct codebase read)
- `/workspace/src/workflows/buildContext.ts` — savings baseline calculation, `filesWithAnyCompressedChunk` exclusion logic (HIGH confidence — direct codebase read)
- `/workspace/src/workflows/traceFlow.ts` — `runTraceFlow`, empty hops path, `localTasksPerformed` (HIGH confidence — direct codebase read)
- `/workspace/src/services/flowTracer.ts` — `traceFlow`, `resolveSymbolToChunkId`, BFS implementation (HIGH confidence — direct codebase read)
- `/workspace/src/mcp/index.ts` — tool descriptions, `buildSearchResponse` savings estimate, tool registration (HIGH confidence — direct codebase read)
- [Optimizing RAG with Hybrid Search & Reranking — Superlinked VectorHub](https://superlinked.com/vectorhub/articles/optimizing-rag-with-hybrid-search-reranking) — BM25 + dense + rerank hitting 87% recall; 40% keyword weight as starting point for hybrid blends (MEDIUM confidence — industry research)
- [Advanced RAG: Hybrid Search and Re-ranking — dasroot.net](https://dasroot.net/posts/2025/12/advanced-rag-techniques-hybrid-search/) — standard hybrid weighting patterns, reranking cost tradeoffs (MEDIUM confidence — technical blog, consistent with industry pattern)
- [RAG Evaluation — Meilisearch](https://www.meilisearch.com/blog/rag-evaluation) — honest metrics as "the difference between a system that only looks impressive in demos and one that consistently delivers value" (MEDIUM confidence — vendor blog, reinforces honest-metrics finding)

---

*Feature research for: brain-cache v2.2 Retrieval Quality milestone*
*Researched: 2026-04-03*
