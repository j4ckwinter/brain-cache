# Project Research Summary

**Project:** brain-cache v2.2 Retrieval Quality
**Domain:** RAG retrieval quality improvements — scoring, noise filtering, trace accuracy, and honest metrics
**Researched:** 2026-04-03
**Confidence:** HIGH

## Executive Summary

brain-cache v2.2 is a targeted accuracy milestone, not a feature expansion. All four research areas converge on a single diagnosis: the retrieval pipeline produces correct results in the average case but fails predictably in well-understood edge cases that directly erode user trust. The fixes are individually small (constants, optional parameters, guard clauses, text edits) but they interact in specific ways that require careful sequencing — changing the keyword boost weight without also carrying the blended score into compression creates a new class of budget exhaustion failures. The research confirms that no new dependencies are required: every improvement is implementable with pure TypeScript on top of the existing LanceDB/Ollama/Commander stack.

The recommended approach is to ship six targeted fixes in four sequenced phases, ordered by dependency depth and risk. The isolated single-file fixes (trace deduplication, entry point resolution) ship first as the lowest-risk group. Retrieval scoring changes (config file penalty) follow independently. The cross-cutting changes (query-aware compression + honest savings computation) ship together in a single phase to avoid double-editing the same files. Documentation and routing description updates close the milestone, written last to reflect the behavior actually delivered rather than the behavior intended.

The key risk is well-documented: increasing `KEYWORD_BOOST_WEIGHT` to fix one failing test while ignoring the others will promote build tool config files above application code in the general case. PITFALLS.md is explicit that the weight must be validated against all five test queries from the debug session simultaneously. The pitfalls research also identifies a correct-looking but wrong fix for the compression bypass — name-match protection should raise the similarity score used in the existing threshold check, not add a new bypass code path. These two constraints are the critical guardrails for Phase 22-C.

## Key Findings

### Recommended Stack

The base stack is unchanged and validated. All v2.2 improvements are implementable with the already-installed packages: `@lancedb/lancedb` 0.27.1 (vector storage + SQL metadata filtering), `ollama` 0.6.3 (local embeddings), and TypeScript 5.x (type-safe retrieval logic). No new npm dependencies are needed for any of the six improvements in scope.

The one technology decision deferred for v2.2 is LanceDB's native FTS (full-text search) index. While the API exists in 0.27.1 and a known bug workaround is documented (GitHub issue #1557), adding FTS would force all users to re-index their repositories. The existing keyword boost at an increased weight addresses the same precision gap with zero migration cost. FTS is the correct path for a v2.3 hybrid retrieval milestone if post-v2.2 testing shows the boost approach remains insufficient.

**Core technologies (unchanged):**
- `@lancedb/lancedb` 0.27.1: vector storage + SQL metadata filtering — embedded, disk-backed, no separate server required
- `ollama` 0.6.3: local embeddings — official JS library, connection pooling included
- TypeScript 5.x: type-safe retrieval logic — all improvements are pure TS layered on existing services

### Expected Features

All v2.2 improvements are P1 — each is tied to a documented test session failure with an identified root cause. There are no "nice to have" items in the v2.2 core scope.

**Must have (table stakes for v2.2):**
- Keyword boost weight increase (0.10 to 0.40 as starting point) with score passthrough to compression — fixes Test 1 (buildContext.ts compressed despite query name match)
- Build tool config file score penalty in search results — fixes Test 3 (vitest.config.ts ranked 3rd for "config values" query)
- trace_flow exact-match entry point resolution before vector search — fixes Tests 1 and 4 (wrong seed chunk used for BFS)
- CLAUDE.md routing table with explicit negative examples ("Do NOT use trace_flow for...") — fixes Tests 3 and 4 (wrong tool selection)
- MCP tool description updates mirroring CLAUDE.md negative routing guidance
- trace_flow empty-result savings guard (report 0% when hops array is empty) — fixes Test 4 (67% claimed on abandoned trace)
- trace_flow duplicate callsFound fix — fixes Test 5 (call list rendered twice per hop)

**Should have (post-v2.2 validation):**
- search_codebase savings estimate correction (replace `tokensSent * 3` multiplier with real calculation)
- Infrastructure file filter per-query bypass (pass config files through when query explicitly mentions them by name)

**Defer (v2.3+):**
- LanceDB FTS hybrid search — adds latency, forces re-index migration; keyword boost at 40% should be sufficient
- Cross-encoder reranking — second Ollama model per query; explicitly out of scope per PROJECT.md

### Architecture Approach

The architecture is a layered MCP server: transport (`mcp/index.ts`) → workflow (`src/workflows/`) → service (`src/services/`) → data (LanceDB + Ollama). All six v2.2 improvements are in-place modifications to existing functions within this structure — no new modules are needed. The build order follows dependency depth: isolated single-file fixes first, scoring changes next, cross-cutting signature changes last, documentation closes.

**Components changed in v2.2:**
1. `src/services/retriever.ts` — build-config file score penalty in `searchChunks`; export `extractQueryTokens`
2. `src/services/compression.ts` — optional `queryTokens?` parameter enabling name-match bypass via existing threshold
3. `src/services/flowTracer.ts` — deduplicate `callsFound` with `[...new Set(...)]`
4. `src/workflows/buildContext.ts` — pass `queryTokens` to each `compressChunk` call in lookup-mode path
5. `src/workflows/traceFlow.ts` — pre-step exact-match symbol resolution before vector search; real savings computation replacing hardcoded `reductionPct: 67`
6. `src/mcp/index.ts` — read savings from `result.metadata` (not hardcoded); sharper tool description strings
7. `CLAUDE.md` — routing table with explicit negative examples per tool

**Unchanged:** `src/workflows/search.ts`, `src/workflows/explainCodebase.ts`, `src/lib/format.ts` (likely), `src/lib/config.ts` (likely)

**Key architectural patterns established:**
- Optional parameter extension: `compressChunk(chunk, queryTokens?)` maintains backward compatibility with all callers
- Pre-resolution before vector search: attempt exact SQL name lookup first, fall back to embedding only if no match
- Savings computation in workflow, not MCP handler: follows the pattern already established by `buildContext.ts` lines 152-199

### Critical Pitfalls

1. **Keyword boost weight tuning corrupts the dominant signal** — increasing `KEYWORD_BOOST_WEIGHT` to fix one failing test promotes build tool config filenames above application code for generic queries. Validate against all five debug session queries simultaneously before settling on any weight above 0.15. Start at 0.40, adjust down if config noise returns. Never validate against a single case.

2. **Name-match compression bypass exhausts the token budget** — implementing name-match protection as a binary bypass rule ("name matches → skip compression") can cause `buildContext.ts` (800+ tokens) to consume the entire token budget, displacing `compression.ts` and `retriever.ts` that actually answer the question. Correct fix: let keyword boost raise the chunk's similarity score above 0.85 so the existing threshold fires naturally. Do not add a new bypass code path.

3. **Build tool file noise filter breaks explicit queries** — a hardcoded filename exclusion list removes `tsup.config.ts` from results for "How does tsup build the project?" Use a score penalty (×0.7 or a subtracted coefficient) with an explicit-mention opt-out, not hard exclusion.

4. **CLAUDE.md and MCP description changes in one commit make regression attribution impossible** — if both surfaces are changed together and routing regresses, there is no way to determine which change caused it. Change MCP descriptions first, verify all five test queries, then update CLAUDE.md.

5. **trace_flow callsFound duplication root cause must be confirmed before fixing** — adding dedup in `format.ts` hides a potential indexing bug in the edges table or BFS traversal. Log raw `TraceFlowResult.hops[0].callsFound` before any formatter runs. Fix at the layer where duplicates originate.

## Implications for Roadmap

Based on research, suggested phase structure:

### Phase 22-A: Isolated Single-File Fixes
**Rationale:** Contained to one file each with no callers to update. Lowest risk, independently verifiable. Ship first to establish confidence before touching cross-cutting code.
**Delivers:** trace_flow correct entry point resolution for verbose queries; deduplicated callsFound output
**Addresses:** Test 4 wrong seed (verbose entrypoint), Test 5 duplicate call list
**Avoids:** Do not change `resolveSymbolToChunkId` signature — already exported and correct. Pre-step in `traceFlow.ts` only.
**Files:** `src/workflows/traceFlow.ts` (entry point resolution), `src/services/flowTracer.ts` (callsFound dedup)
**Research flag:** Standard patterns — no additional research needed. Direct codebase evidence is high confidence for both fixes.

### Phase 22-B: Retrieval Scoring (Config Noise)
**Rationale:** Additive change to `retriever.ts` scoring formula. No callers change signature. Independent of compression changes in Phase 22-C. Ships cleanly in isolation.
**Delivers:** Build tool config files demoted in search results for application-logic queries
**Addresses:** Test 3 (vitest.config.ts ranked 3rd for "config values")
**Avoids:** Score penalty, not exclusion list. Pattern-match on filename shape (`*.config.ts`, `*.rc.ts`) not hardcoded filenames. Penalty is `BUILD_CONFIG_PENALTY_WEIGHT = 0.05` subtracted from blend.
**Files:** `src/services/retriever.ts`
**Research flag:** Standard patterns — penalty formula specified with exact coefficients in ARCHITECTURE.md. No unknowns.

### Phase 22-C: Compression and Savings (Cross-Cutting)
**Rationale:** Both improvements touch `traceFlow.ts` and `buildContext.ts`. Shipping them together avoids double-editing. Highest complexity phase: changes `compressChunk` signature (backward-compatible via optional parameter) and extends `TraceFlowResult.metadata`.
**Delivers:** Identifier-named chunks protected from compression via boosted similarity score; real token savings numbers in trace_flow output (no more hardcoded 67%)
**Addresses:** Test 1 (buildContext.ts body stripped despite name in query), Test 4 (67% savings on wrong/discarded trace)
**Avoids:** Do NOT implement name-match as a new bypass rule — carry blended score into `chunk.similarity` so the existing `>= 0.85` threshold fires. `chunk.similarity` for compression must remain the raw cosine distance used for ranking; the blended score is for sort order only (see integration gotcha in PITFALLS.md). Cap reported reduction at 95%.
**Files:** `src/services/compression.ts`, `src/services/retriever.ts` (export `extractQueryTokens`), `src/workflows/buildContext.ts`, `src/workflows/traceFlow.ts`, `src/mcp/index.ts`, `src/lib/types.ts` (TraceFlowMetadata extension)
**Research flag:** Needs careful post-implementation verification — run all 5 test queries. Both `buildContext.ts` AND `compression.ts` must appear in context for Test 1's query. Savings must be in 20-70% range. Update test assertions alongside the savings model change (they will assert old values).

### Phase 22-D: Documentation and Routing Descriptions
**Rationale:** Documentation changes ship last so descriptions reflect behavior actually delivered by Phases A-C. CLAUDE.md and MCP descriptions tested in sequence to enable regression attribution.
**Delivers:** Claude selects correct tool for all five documented test queries
**Addresses:** Tests 3 and 4 tool misselection (trace_flow for code-understanding, search_codebase for "how does X work")
**Avoids:** Do not use abstract descriptions ("call propagation"). Use concrete query patterns. Lead with what each tool is NOT for. Change MCP descriptions first, test all five queries, then update CLAUDE.md and test again.
**Files:** `CLAUDE.md`, `src/mcp/index.ts` (description strings only)
**Research flag:** Low code risk. High behavior risk — replay all five debug session queries explicitly after each surface is updated.

### Phase Ordering Rationale

- **A before B and C:** Isolated fixes have no dependencies. Establishing a working trace pipeline before changing scoring behavior makes failures easier to isolate.
- **B before C:** Retrieval scoring is independent of compression. If Phase C interactions are unexpected, Phase B's verified baseline provides a clean isolation point.
- **C grouped (not split):** `compressChunk` signature change and `TraceFlowResult.metadata` extension both touch `traceFlow.ts` and `buildContext.ts`. Splitting forces double-editing and risks inconsistent intermediate states.
- **D last:** Documentation describes delivered behavior, not intended behavior. CLAUDE.md routing must describe what the code actually does after A-C.

### Research Flags

Phases needing attention during execution:
- **Phase 22-C:** `KEYWORD_BOOST_WEIGHT` change must be validated against all five debug session test queries simultaneously. The distinction between "blended score for sort order" vs. "raw cosine similarity for compression threshold" is a critical invariant — `chunk.similarity` must remain the raw cosine distance.
- **Phase 22-D:** Two separate verification steps — test after MCP description change, test again after CLAUDE.md change. Do not combine.

Phases with standard, well-documented patterns (skip research-phase):
- **Phase 22-A:** Both fixes are one-liners with confirmed root causes from direct code inspection.
- **Phase 22-B:** Score penalty formula specified with exact coefficients in ARCHITECTURE.md.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All techniques confirmed against existing codebase; zero new dependencies; LanceDB 0.27.1 API verified |
| Features | HIGH | Each feature tied to a documented test failure with exact query, expected behavior, and root cause identified |
| Architecture | HIGH | All findings from direct source inspection of the actual files; no inference |
| Pitfalls | HIGH | Pitfalls derived from observed failures in live test sessions and IR literature; recovery strategies specified per pitfall |

**Overall confidence:** HIGH

### Gaps to Address

- **Keyword boost weight target (0.40 vs. lower):** FEATURES.md recommends 0.40 as the "hybrid search standard starting point." PITFALLS.md warns against exceeding 0.15-0.20 without regression testing. These are not contradictory — start at 0.40, validate against all five test queries, and adjust down if config file noise returns. Do not treat 0.40 as a fixed commitment.
- **Token savings baseline model consistency:** Switching to per-file partial savings (`fullFileTokens - tokensActuallySent`) will break existing test assertions. Phase 22-C must update test assertions alongside the savings model change — do not leave tests asserting old baseline values.
- **trace_flow entry point: code vs. description fix scope:** PITFALLS.md recommends fixing the `entrypoint` schema description first (deterring verbose usage) and adding code extraction logic only if the description fix alone is insufficient. ARCHITECTURE.md describes a pre-step code fix. Implement both: schema description deters verbose usage; symbol extraction code handles cases that still slip through.

## Sources

### Primary (HIGH confidence)

- `/workspace/src/services/retriever.ts` — `searchChunks`, `computeKeywordBoost`, `extractQueryTokens`, `KEYWORD_BOOST_WEIGHT = 0.10`
- `/workspace/src/services/compression.ts` — `compressChunk`, rules 1-4, `HIGH_RELEVANCE_SIMILARITY_THRESHOLD = 0.85`
- `/workspace/src/workflows/buildContext.ts` — savings baseline at lines 152-199, `filesWithAnyCompressedChunk` exclusion logic
- `/workspace/src/workflows/traceFlow.ts` — entry point embedding, BFS delegation, hardcoded `reductionPct: 67`
- `/workspace/src/services/flowTracer.ts` — `traceFlow` BFS loop, `callsFound` construction, `resolveSymbolToChunkId`
- `/workspace/src/mcp/index.ts` — 6 tool handlers, hardcoded savings estimate, tool description strings
- `/workspace/.planning/debug/claude-debugging-itself-v2.md` — 5 live test sessions, exact failure modes, tool selection errors
- `/workspace/.planning/PROJECT.md` — v2.2 milestone target features, out-of-scope constraints

### Secondary (MEDIUM confidence)

- [LanceDB Full-Text Search docs](https://docs.lancedb.com/search/full-text-search) — FTS API confirmed; deferred to v2.3+
- [LanceDB Hybrid Search docs](https://docs.lancedb.com/search/hybrid-search) — `RRFReranker` confirmed as built-in no-model reranker
- [Optimizing RAG with Hybrid Search — Superlinked VectorHub](https://superlinked.com/vectorhub/articles/optimizing-rag-with-hybrid-search-reranking) — 40% keyword weight as hybrid search starting point; BM25 + dense + rerank at 87% recall
- [Advanced RAG: RRF — glaforge.dev](https://glaforge.dev/posts/2026/02/10/advanced-rag-understanding-reciprocal-rank-fusion-in-hybrid-search/) — RRF formula, k=60 constant verified

### Tertiary (LOW confidence)

- [LanceDB FTS issue #1557](https://github.com/lancedb/lancedb/issues/1557) — `Index.fts is not a function` bug; open as of Nov 2024; used to justify deferring FTS to v2.3+

---
*Research completed: 2026-04-03*
*Ready for roadmap: yes*
