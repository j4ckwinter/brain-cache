# Pitfalls Research

**Domain:** Retrieval Quality Improvements — brain-cache v2.2
**Researched:** 2026-04-03
**Confidence:** HIGH (primary pitfalls derived from observed test failures in the debug session, actual source code, and established IR/ranking literature; all critical pitfalls confirmed against the real implementation)

---

## Critical Pitfalls

### Pitfall 1: Keyword Boost Weight Tuning Corrupts the Dominant Signal

**What goes wrong:**
The hybrid scoring formula `similarity * (1 - WEIGHT) + keywordBoost * WEIGHT` is only safe as long as WEIGHT stays below the threshold where a purely keyword-matched result can outrank a highly vector-relevant result. The current implementation uses 0.10 (10%). If the weight is increased to "fix" missed filename matches, a chunk from `vitest.config.ts` with 3 keyword matches can outscore a chunk from `compression.ts` with similarity 0.82. The vector ranking ceases to be the primary signal and keyword matching noise takes over.

**Why it happens:**
During testing you see a case where the correct file (e.g. `buildContext.ts`) is ranked 3rd despite its name appearing verbatim in the query. The natural impulse is to increase KEYWORD_BOOST_WEIGHT from 0.10 to 0.25 or 0.30 to fix this. That fixes the specific failing case but introduces a regression in the general case: queries that do NOT mention a specific filename start returning wrong results because short common tokens in config filenames match many queries.

**How to avoid:**
- Do not increase KEYWORD_BOOST_WEIGHT above 0.15 without running a regression suite against all 5 test queries from the debug session. The 0.10 weight was set conservatively for exactly this reason.
- The correct fix for "buildContext.ts ranked 3rd despite exact name in query" is to lower `HIGH_RELEVANCE_SIMILARITY_THRESHOLD` in compression (currently 0.85) rather than increasing the boost weight. A file that appears verbatim in the query but scores 0.82 similarity is a retrieval quality issue, not a reranking issue.
- Alternatively, apply the keyword boost as a tiebreaker only (post-filter), not as a blended score. This preserves vector ranking entirely and only reorders items with similar similarity scores (within ±0.05 of each other).
- Never apply the boost to chunks from files in a hardcoded exclusion list (build tool files, test config files). These should be demoted, not just not-boosted.

**Warning signs:**
- `vitest.config.ts` or `tsup.config.ts` appears in top-3 results for a query about application code
- A query containing a function name exactly returns that function 4th or lower after weight increase
- Regression in test 3 (`"What config values does brain-cache use?"`) which already returned vitest.config.ts at rank 5

**Phase to address:**
Hybrid scoring phase. Establish the invariant before implementation: the top-ranked vector result must remain top-ranked unless the keyword boost is above 0.20 on the boosted candidate AND below 0.50 similarity on the vector result.

---

### Pitfall 2: Query-Term Name Matching Protects Against Compression When It Shouldn't

**What goes wrong:**
The proposed fix for "buildContext.ts body-stripped despite query containing 'buildContext'" is to protect files whose name matches a query term from compression. This interacts dangerously with the token budget in `assembleContext`. If `buildContext.ts` is large (220+ lines, ~800+ tokens) and is never compressed due to name match protection, the budget fills up and other relevant files (e.g. `compression.ts`, `retriever.ts`) are dropped entirely. The query "how does buildContext assemble chunks" would then return only `buildContext.ts` intact, missing the compression and retrieval services that answer the actual question.

**Why it happens:**
Name-match-based compression bypass is implemented as a binary gate — if the name matches, the chunk passes through uncompressed. But compression bypass already exists for high-relevance chunks (`similarity >= 0.85`). Adding a second bypass path (name match) creates two independent exemption mechanisms that can both fire simultaneously for large files.

**How to avoid:**
- The compression bypass for name-matching chunks should only apply within the existing budget. If a name-matched chunk would exhaust more than 60% of the token budget alone, apply structural compression anyway (preserve signature + JSDoc, strip body).
- Prefer fixing the upstream cause: if the query contains "buildContext" and the vector search returns `buildContext.ts` with similarity 0.79 instead of 0.85+, the real problem is that the embedding isn't strong enough on filename tokens. Keyword boost (see Pitfall 1) should push it into the HIGH_RELEVANCE threshold naturally, making compression bypass happen through the existing high-relevance path — not a new code path.
- Do not implement a separate "name match = no compression" rule. Instead, ensure the keyword boost raises the `similarity` value on name-matching chunks so the existing `similarity >= HIGH_RELEVANCE_SIMILARITY_THRESHOLD` rule fires.

**Warning signs:**
- Token budget report shows one file consuming 70%+ of the budget
- `compression.ts` and `retriever.ts` are absent from the context for a query about `buildContext` after name-match protection is added
- Token savings percentage drops to near zero (no files were compressed, budget was consumed by a single uncompressed file)

**Phase to address:**
Query-aware relevance boosting phase. Verify with a test: after the fix, the query "how does buildContext assemble and compress chunks" must return BOTH `buildContext.ts` AND `compression.ts` in the context.

---

### Pitfall 3: Build Tool File Noise — Suppression That Breaks Legitimate Queries

**What goes wrong:**
`vitest.config.ts` and `tsup.config.ts` ranking in the top-5 results for generic queries ("config values", "configuration") is a real noise problem. The temptation is to add a hardcoded exclusion list for build tool file patterns (`vitest.config.*`, `tsup.config.*`, `*.config.ts`, etc.) in the retriever. This breaks legitimate queries: "How does tsup build the project?" or "What does the tsup config do?" must return `tsup.config.ts` as the top result, but an exclusion list would suppress it.

**Why it happens:**
Build tool filenames use the word "config" which is also a domain term in the project (`config.ts`, `configLoader.ts`, `UserConfig`). The embedding model can't distinguish "tsup configuration" from "application configuration" without additional context. A naive exclusion list conflates "suppress when noisy" with "suppress always."

**How to avoid:**
- Apply a distance-based penalty (not exclusion) to known build tool file patterns. Multiply their computed score by 0.7 before ranking. This makes them rank lower than application code of equal relevance without removing them from the result set entirely.
- The penalty must be opt-out: if the query contains the filename explicitly (e.g. query contains "tsup" or "vitest"), skip the penalty for that file.
- Test the penalty against: (a) query "What config values does brain-cache use?" — `vitest.config.ts` must not appear in top-3; (b) query "How does tsup build the project?" — `tsup.config.ts` must appear in top-1.
- Do not use distance thresholds to solve this. Raising `distanceThreshold` from 0.4 to 0.3 for explore mode would suppress both noise AND relevant edge cases.

**Warning signs:**
- Query "How does tsup work?" returns no results after adding exclusions
- `vitest.config.ts` exclusion causes test-related queries ("What's in compression.test.ts") to skip the test file
- The exclusion list grows beyond 3-4 entries, becoming a maintenance burden

**Phase to address:**
Search noise reduction phase. Required test: before and after the penalty, verify the config-noise query AND a query explicitly mentioning the tool filename.

---

### Pitfall 4: trace_flow Entry Point Matching Fails on Verbose Queries — Wrong Fix

**What goes wrong:**
Test 4 (`"How does the indexing pipeline chunk files? Walk me through the logic in chunkFile"`) caused `trace_flow` to return results from `retriever.ts` instead of `chunker.ts`. The fix is straightforward: the trace seed search uses a verbose multi-clause query and the embedding centers on the dominant terms ("indexing pipeline") rather than the specific entry point ("chunkFile"). The wrong fix is to extract the entry point from the query with a heuristic (e.g. grab the last noun phrase). This produces a new failure: verbose queries like "how does the compression service compress a chunk" would extract "chunk" as the entry point and land on the wrong seed.

**Why it happens:**
The `trace_flow` MCP tool's `entrypoint` parameter is semantically a function name, not a question. The user (or Claude) passes a full question as the entrypoint when `trace_flow` is invoked from a workflow that does intent classification. Test 4 failed because Claude called `trace_flow(entrypoint: "chunkFile function in the indexing pipeline", maxHops: 5)` — a verbose phrase. Test 5 (same underlying question) succeeded because Claude called `trace_flow(entrypoint: "chunkFile", maxHops: 5)` — a short, precise symbol name.

**How to avoid:**
- The fix is in the CLAUDE.md tool description and MCP tool `inputSchema` description for `entrypoint`, not in the code. The `entrypoint` parameter description must say: "The function or symbol name to trace FROM. Use a short, precise name (e.g. 'chunkFile', 'runBuildContext') — NOT a question or full sentence. Verbose queries cause the seed search to land on the wrong chunk."
- Adding a simple pre-processing step that extracts the last token before common suffixes ("function", "in the", "logic") would improve robustness without overfitting. But this is a secondary improvement — the primary fix is the schema description.
- Do not add fuzzy query rewriting logic inside `runTraceFlow`. The workflow is already correct — the problem is upstream (Claude's choice of what to pass as the entrypoint).

**Warning signs:**
- Test 4 retest with the same verbose entrypoint query still fails
- `trace_flow` returns results from a file with no semantic relationship to the mentioned function name
- Claude uses a 10+ word phrase as the `entrypoint` argument after the schema description is improved

**Phase to address:**
trace_flow entry point matching phase. Verify by replaying Test 4 with verbose entrypoint AND with short entrypoint — both should now resolve correctly (verbose via improved schema description deterring that usage; short via the same working path as Test 5).

---

### Pitfall 5: Honest Token Savings Reporting — Over-Correction Zeros Out the Metric

**What goes wrong:**
The v2.1 fix for inflated token savings (only count files where ALL chunks are uncompressed) is correct but creates a new problem: if the query returns 5 files and 4 of them have even one compressed chunk, `estimatedWithoutBraincache` counts only 1 file and the reported savings look tiny even when brain-cache genuinely saved thousands of tokens. Over-correcting in the other direction (counting all files as savings) inflates the number. The real failure mode is reporting 0% or negative savings when the tool clearly worked.

**Why it happens:**
The current logic (`filesWithAnyCompressedChunk` exclusion) is the result of a previous over-inflation fix. If a file has 4 uncompressed chunks and 1 compressed chunk, the whole file is excluded from savings — even though brain-cache sent 4 complete function bodies instead of the entire file. This is unnecessarily conservative.

**How to avoid:**
- The savings baseline should account for the actual bytes NOT sent, not for whole-file exclusion. For each file in the context: `savedTokens = (fullFileTokens - tokensActuallySent)`. Sum these across all files, whether or not any chunk was compressed. This is more accurate than the binary "file has any compressed chunk" gate.
- Do not move to a completely different savings model mid-milestone. The current model is directionally correct — the fix is to calculate per-file savings rather than excluding files entirely.
- Cap reported reduction at 95% to prevent obviously-wrong 100% savings claims when tiny queries return large files.
- Test with the query that exposed the problem in Test 1: "how does buildContext assemble and compress chunks" — the savings should be meaningful (>30%) after the fix, not 0% or >90%.

**Warning signs:**
- Savings reported as 0% for a query that returned 4 compressed chunks
- Savings reported as 95%+ when the query returned 2 small uncompressed functions
- The `reductionPct` field is negative (can happen if `finalTokenCount > estimatedWithoutBraincache`)

**Phase to address:**
Token savings reporting phase. The fix is confined to `buildContext.ts` lines 155–199. Verify the savings calculation produces a plausible 20–60% range across the 5 test queries.

---

### Pitfall 6: CLAUDE.md Tool Description Rewrite Causes Routing Regression

**What goes wrong:**
The v2.2 goal includes "sharper tool descriptions and CLAUDE.md routing so Claude picks build_context over trace_flow for code understanding queries." Test 1 showed Claude calling `trace_flow` first for "how does buildContext assemble and compress chunks" — clearly a `build_context` query. Rewriting the descriptions to steer toward `build_context` more aggressively can cause the opposite problem: Claude stops using `trace_flow` entirely, even for genuine cross-file call-path queries where it performs well.

**Why it happens:**
Tool descriptions in CLAUDE.md and MCP schema must distinguish between "understanding" queries (build_context) and "propagation" queries (trace_flow). The v2.0 CLAUDE.md already has a routing table, but the distinction "use trace_flow when the question is about call propagation or execution flow across files" isn't clear enough — Claude treats "how does buildContext flow" as both a propagation query AND an understanding query.

**How to avoid:**
- The routing boundary must be operationally defined, not conceptually. Replace "call propagation" (abstract) with concrete query patterns: "trace_flow is correct when the query is 'trace X calls Y', 'what does X call?', or 'call path from X to Y'. It is NOT correct for 'how does X work', 'explain X', 'what does X do', or 'what happens inside X' — use build_context for those."
- Changing both the MCP tool description AND CLAUDE.md simultaneously means two routing surfaces. If the test fails after both changes, it's impossible to know which one caused the regression. Change them in sequence, test after each.
- The MCP tool description for `trace_flow` should lead with what it is NOT for: "Not for understanding how a function works internally — use build_context for that. Use trace_flow only when you need to see the chain of calls across multiple files."
- After rewriting, replay all 5 test queries from the debug session and verify tool selection matches the expected tool.

**Warning signs:**
- Claude never calls `trace_flow` after the rewrite, even for "trace how buildIndex calls embedBatch"
- Claude calls `build_context` for a trace query and then reports the answer is incomplete (because build_context doesn't return hop structure)
- The routing table in CLAUDE.md and the MCP tool description use different phrasing and contradict each other for edge cases

**Phase to address:**
Tool routing clarification phase. Required regression test: all 5 debug session queries must select the correct tool after the rewrite. Both CLAUDE.md and MCP description changes must be included in the same phase to prevent drift.

---

### Pitfall 7: trace_flow Duplicated Call List — Wrong Root Cause Attribution

**What goes wrong:**
Test 5 identified that the `chunkFile` hop in trace_flow output lists its callees twice. The symptom: `callsFound` appears to be duplicated in the serialized output. The wrong fix is to add a deduplication step in the formatter (`formatTraceFlow` in `src/lib/format.ts`). If the duplication happens in `flowTracer.ts` during BFS traversal (e.g. a call edge is visited twice because it appears in both the chunk's direct edges and a re-traversed path), deduplication in the formatter hides the root cause and the underlying data remains corrupt.

**Why it happens:**
The `callsFound` array in each hop is built from the `edges` table lookup for that chunk. If an edge is stored twice in the table (duplicate row from indexing), the array will have duplicates. Alternatively, if the formatter's `formatTraceFlow` expands the `callsFound` array once for display AND once for metadata, the duplication is a formatter-only bug. These require different fixes.

**How to avoid:**
- Before implementing a fix, log the raw `callsFound` array from `runTraceFlow` directly (before any formatter touches it). If the duplicates are there, the fix is in `flowTracer.ts` or `runTraceFlow`. If the array is clean and the output is duplicated, the fix is in `formatTraceFlow`.
- Add a unit test for `formatTraceFlow` with a hop that has `callsFound: ['foo', 'bar']` and assert the output contains each name exactly once.
- Do not add `.filter((v, i, arr) => arr.indexOf(v) === i)` to `runTraceFlow`'s output without first confirming the data source is correct. Silently deduplicating before returning masks a potential indexing bug.

**Warning signs:**
- The duplicate appears only in the formatted output (formatter bug)
- The duplicate appears in the raw `TraceFlowResult` returned by `runTraceFlow` (data bug in flowTracer or retriever)
- The duplicate only happens for specific files with many outgoing edges (data bug at scale)

**Phase to address:**
trace_flow output quality phase. Confirm root cause before fixing — log raw result, then add formatter test.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Increase KEYWORD_BOOST_WEIGHT to 0.25+ to fix one failing test | Quick win on the failing case | Noise files (vitest.config.ts) now outrank application code for generic queries | Never — tune weight against the full test suite, not one case |
| Add build tool filename exclusions to suppress noise | Eliminates vitest.config.ts from results | Breaks explicit queries about those files; exclusion list grows into a maintenance burden | Never — use a score penalty that respects explicit query mention |
| Use name-match as a binary compression bypass | Protects specific named files from being stripped | Large files consume the entire token budget, displacing other relevant results | Never — apply name-match protection only if the chunk fits within budget constraints |
| Rewrite CLAUDE.md and MCP descriptions in one commit without regression testing | Single change to deploy | When routing regresses, unclear which change caused it | Never — sequence the changes and test after each |
| Fix `callsFound` duplication with a dedup call in the formatter | Zero-risk quick fix | Hides a potential indexing or BFS traversal bug that will manifest elsewhere | Only if confirmed the raw data is clean (formatter-only bug) |
| Copy the v2.1 PITFALLS.md template and re-skin it for v2.2 | Saves time | v2.1 pitfalls are about presentation layer; v2.2 pitfalls are retrieval-quality specific — different failure modes, wrong advice | Never for milestone-specific research |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| LanceDB distance filter + keyword boost | Apply keyword boost before the distance threshold filter | Filter by distance first (this is already done in `searchChunks`), then apply boost to the filtered set |
| `HIGH_RELEVANCE_SIMILARITY_THRESHOLD` (compression.ts) vs. hybrid score | Comparing the hybrid-blended score against 0.85 after boosting | The `chunk.similarity` field stored in `RetrievedChunk` must remain the raw vector similarity, not the blended score. The blended score is only for ranking order; compression must check the raw vector similarity |
| `classifyRetrievalMode` vs. `trace_flow` MCP tool | Changing `classifyRetrievalMode` keyword lists causes `build_context` to route to `trace_flow` internally (via the trace mode branch in `runBuildContext`) AND changes how `search_codebase` operates | Keyword list changes in `retriever.ts` affect ALL three routing paths simultaneously — test all three after any change |
| `entrypoint` parameter in `trace_flow` MCP vs. `runTraceFlow` function | The MCP `entrypoint` parameter is passed directly as the query string to `embedBatchWithRetry` | Short, precise symbol names produce better seed results than verbose phrases — enforce this in the schema description, not in pre-processing logic |
| Token savings baseline vs. `finalChunks` array | The savings calculation iterates `finalChunks` to identify compressed files, but `finalChunks` in trace and explore modes contains chunks with `similarity: 1` (synthetic) or synthetic IDs — the savings math will be wrong | Apply the actual savings baseline only in the lookup mode path; use a different savings model (or skip savings) for trace and explore modes |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Reading full file content for savings baseline on every `build_context` call | Latency spike on large files (readFile on 1000-line files × 5 files = significant I/O on every query) | The savings baseline file reads already exist in the current code — do not add more file reads to the hot path | Any query returning more than 10 files in context |
| Computing keyword boost with a regex per chunk × per token | O(chunks × queryTokens) inner loop that scales with result set | Current `extractQueryTokens` + `computeKeywordBoost` is O(n) per chunk with simple string includes — preserve this pattern; do not use regex in the inner loop | Always — regex in an inner loop is always wrong |
| Re-embedding the query multiple times (once for search, once for trace seed) | Double Ollama round-trip latency for queries that trigger trace mode in `build_context` | `runBuildContext` embeds the query then passes the vector to `searchChunks`, but trace mode calls `runTraceFlow` which re-embeds — the vector is not passed through | Every trace-mode query via `build_context` |

---

## "Looks Done But Isn't" Checklist

- [ ] **Keyword boost does not inflate config file scores:** Run query "What config values does brain-cache use?" after boost changes — `vitest.config.ts` and `tsup.config.ts` must NOT appear in top-3.
- [ ] **Name-match protection respects token budget:** Run query "how does buildContext assemble and compress chunks" — both `buildContext.ts` AND `compression.ts` must appear in the context, not just one large uncompressed file.
- [ ] **trace_flow entry point fix tested with verbose AND short entrypoints:** Test 4 (verbose: "chunkFile function in the indexing pipeline") and Test 5 (short: "chunkFile") must both resolve to `chunker.ts`. Test 4's fix is in the schema description deterring verbose usage; Test 5's path must remain working.
- [ ] **`callsFound` duplication root cause confirmed before fix:** Log raw `TraceFlowResult.hops[0].callsFound` to stderr before any formatter runs — confirm whether duplicates exist in the data or only in the output.
- [ ] **CLAUDE.md routing table and MCP description are consistent:** The routing decision for "how does X flow through Y" must be the same in both places. They must not contradict for any of the 5 test queries.
- [ ] **Token savings range is plausible:** All 5 test queries should report 20–70% reduction after fixes. A result of 0% or >90% is a signal the savings calculation is wrong.
- [ ] **`chunk.similarity` field is unchanged after keyword boost:** The `RetrievedChunk` objects returned by `searchChunks` must have the raw vector similarity in `.similarity`, not the blended score. The blended score is used only for sort order.
- [ ] **`classifyRetrievalMode` change tested against all three mode paths:** After any keyword list change, verify lookup, trace, AND explore intent classification against the 5 test queries.

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Keyword boost weight too high — noise files outrank application code | LOW | Revert `KEYWORD_BOOST_WEIGHT` to 0.10; confirm test suite passes; re-tune against full test suite, not single case |
| Name-match compression bypass exhausts token budget | MEDIUM | Remove name-match bypass code path; rely on keyword boost raising similarity above HIGH_RELEVANCE threshold instead |
| Build tool file exclusion list breaks explicit queries | LOW | Replace exclusion list with score penalty; add opt-out for queries containing the filename |
| CLAUDE.md rewrite causes routing regression | MEDIUM | Revert CLAUDE.md to v2.1 version; identify which query is mis-routed; fix that specific pattern before re-deploying |
| `callsFound` duplication fixed in formatter but root cause in data | LOW–MEDIUM | Add raw data log to confirm root cause; if indexing bug, re-index and verify; if BFS bug, add dedup in `flowTracer.ts` |
| Token savings reporting drops to near 0% after accuracy fix | LOW | Switch to per-file partial savings model (saved = fullFileTokens - tokensActuallySent) instead of binary file exclusion |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Keyword boost weight corruption | Hybrid scoring weight tuning | Run all 5 debug session queries; verify no build tool file in top-3 |
| Name-match compression bypass exceeds budget | Query-aware relevance boosting | buildContext query must return both the named file AND dependent services in context |
| Build tool config file noise | Search noise reduction | Config query test (noise files not in top-3) + explicit build tool query test (file IS in top-1) |
| trace_flow verbose entry point failure | trace_flow entry point matching | Test 4 (verbose) deterred by schema; Test 5 (short) still resolves correctly |
| Token savings over-correction | Token savings reporting fix | All 5 queries report 20–70% savings; no negatives or >90% outliers |
| CLAUDE.md/MCP description routing regression | Tool routing clarification | All 5 debug session queries select correct tool after rewrite |
| `callsFound` duplication | trace_flow output quality | Unit test for `formatTraceFlow` with known duplicates; raw data log confirms source |

---

## Phase-Specific Warnings

| Phase / Topic | Likely Pitfall | Mitigation |
|---------------|----------------|------------|
| Hybrid scoring weight tuning | Increasing weight to fix one test breaks general ranking | Test against all 5 debug queries simultaneously, not individually |
| Query-aware relevance boosting (filename protection) | Protected file consumes entire token budget | Apply budget constraint: name-match bypass only if chunk fits within 60% of budget |
| Build tool noise reduction | Exclusion list breaks explicit queries about those tools | Use score penalty (×0.7) with explicit-mention opt-out, not exclusion |
| trace_flow entry point matching | Code change to entry point extraction over-fits to test phrases | Fix the schema description first; only add code changes if schema fix alone is insufficient |
| Token savings baseline | Per-file savings model produces different values than old model (breaking existing assertions) | Update test assertions alongside the savings model change; do not leave tests asserting old values |
| CLAUDE.md + MCP tool description rewrite | Both surfaces changed in one commit makes regression attribution impossible | Change MCP description first, run tests; change CLAUDE.md second, run tests again |
| trace_flow duplicated call list | Fix in formatter masks a data-layer bug | Log raw data before formatter; fix at the layer where the duplication originates |

---

## Sources

- `.planning/debug/claude-debugging-itself-v2.md` — 5 live test sessions with brain-cache MCP, Claude's own failure analysis, root cause for buildContext.ts compression miss, trace_flow wrong entry point, vitest.config.ts noise, callsFound duplication
- `src/services/retriever.ts` — KEYWORD_BOOST_WEIGHT = 0.10, extractQueryTokens, computeKeywordBoost implementation; confirms current hybrid scoring formula
- `src/services/compression.ts` — HIGH_RELEVANCE_SIMILARITY_THRESHOLD = 0.85, COMPRESSION_TOKEN_THRESHOLD = 500, COMPRESSION_HARD_LIMIT = 800; confirms compression decision tree
- `src/workflows/buildContext.ts` — filesWithAnyCompressedChunk savings logic (lines 155–199); confirms the binary file exclusion model and its over-conservative behavior
- `src/workflows/traceFlow.ts` — `similarity: 1` synthetic value on all trace hops; confirms savings model is inapplicable to trace mode
- `src/mcp/index.ts` — MCP tool descriptions for all 6 tools; confirms current routing language for build_context and trace_flow
- `CLAUDE.md` — Current routing table and tool descriptions; confirms both routing surfaces exist and may diverge
- `.planning/PROJECT.md` — v2.2 target features list; confirms scope of intended improvements

---
*Pitfalls research for: brain-cache v2.2 Retrieval Quality milestone*
*Researched: 2026-04-03*
