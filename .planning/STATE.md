---
gsd_state_version: 1.0
milestone: v2.3
milestone_name: Final Quality Pass
status: verifying
stopped_at: Completed 28-02-PLAN.md
last_updated: "2026-04-03T19:01:11.711Z"
last_activity: 2026-04-03
progress:
  total_phases: 15
  completed_phases: 4
  total_plans: 13
  completed_plans: 24
  percent: 0
---

# Project State: Brain-Cache

**Last updated:** 2026-04-03
**Updated by:** roadmapper (v2.3 roadmap created)

---

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-03)

**Core value:** Reduce Claude token usage and improve response quality by running embeddings, retrieval, and context building locally — Claude only sees what matters.
**Current focus:** Phase 28 — trace-output-quality

---

## Current Position

Phase: 28 (trace-output-quality) — EXECUTING
Plan: 2 of 2
Status: Phase complete — ready for verification
Last activity: 2026-04-03

Progress: [░░░░░░░░░░] 0% (0/4 phases complete)

---

## Accumulated Context

### Active Blockers

None.

### Key Decisions (Phase 28, Plan 01 — test file and stdlib filtering in traceFlow)

- isTestFile inlined per-workflow (not shared from buildContext.ts) — avoids cross-service coupling, per Phase 27 key decision
- STDLIB_SYMBOLS as Set for O(1) lookup; covers Array, Set/Map, Promise, Object, String methods (60+ symbols)
- productionHops filter applied before map() so metadata.totalHops reflects filtered count in both exact-name and vector paths

### Key Decisions (Phase 26, Plan 01 — tiered computeKeywordBoost for search precision)

- Tier 3 (filename stem) uses return 0.6 not 0.8 as specced — 0.8 caused regression on tsup noise-penalty test; 0.6 satisfies all PREC tests at boost weight 0.40 while not overpowering at default 0.10
- Tier 2 camelCase match requires ALL sub-tokens of chunk.name to appear in query tokens (not partial) — prevents spurious 1.0 boosts
- splitCamelCase filters sub-tokens shorter than 2 chars to prevent single-char noise tokens

### Key Decisions (Phase 25, Plan 01 — MCP tool routing negative guards)

- Negative guards use "Do NOT use this tool when..." pattern — matches CLAUDE.md routing table directive tone
- build_context loses "Prefer this tool" framing — replaced with neutral "Use this tool" to prevent over-selection vs trace_flow
- build_context gets 2 negative guards (trace_flow and explain_codebase); each other tool gets 1
- Test assertions lock description wording via registeredTools.get(name).schema.description

### Key Decisions (Phase 24, Plan 02 — real token savings in runTraceFlow)

- computeHopSavings mirrors buildContext.ts pattern: BODY_STRIPPED_MARKER filter + readFile per unique file + TOOL_CALL_OVERHEAD_TOKENS
- Token savings are workflow-layer concerns (computed in runTraceFlow), not MCP handler concerns
- Zero-hop path short-circuits with inline zeros — no helper call needed
- MCP trace_flow handler uses destructuring then formatTokenSavings — matches buildContext handler pattern

### Key Decisions (Phase 17, Plan 01 — FlowHop callsFound, compression, configLoader)

- flowTracer always queries edges per hop (even at maxHops depth) for callsFound; only children-enqueue is gated by depth check
- compressChunk threshold is <= 200 returns unchanged; 201+ triggers structural body stripping
- resolveStrategy uses spread precedence: { ...base, ...userOverride, ...toolOverride }
- loadUserConfig reads ~/.brain-cache/config.json per call (no caching), returns {} on any error

### Key Decisions (Phase 16, Plan 01 — three-mode intent classifier)

- TRACE_KEYWORDS use multi-word phrases only (not single token 'trace') to avoid false positives on phrases like 'trace the error'
- Ambiguity guard: 'trace the architecture' -> explore (not trace) because broad architectural terms win over trace prefix
- classifyQueryIntent kept as deprecated re-export alias for backward compatibility with external callers
- DIAGNOSTIC_DISTANCE_THRESHOLD and DIAGNOSTIC_SEARCH_LIMIT removed from config — inlined in RETRIEVAL_STRATEGIES

### Key Decisions (Phase 15, Plan 03 — chunker edge extraction and pipeline wiring)

- Edge extraction positioned before `nodeTypes.has()` guard so call_expression/import_statement nodes run for all AST nodes (not just chunkable ones)
- `currentChunkId` tracking is approximate — updates after chunk push, top-level call expressions fall back to `filePath:0`
- `toFile` is `null` at index time for call edges — symbol resolution deferred to query time
- Import edges use `filePath:0` as `fromChunkId` — imports are file-level constructs

### Key Decisions (Phase 15, Plan 02 — .braincacheignore support)

- opts object pattern for crawlSourceFiles (not positional arg) — keeps signature clean for future optional params
- loadIgnorePatterns is a standalone service, not merged into crawler — single responsibility, testable in isolation

### Key Decisions (Phase 15 prerequisites — from research)

- LanceDB edges table uses no vector column: `from_chunk_id`, `from_file`, `from_symbol`, `to_symbol`, `to_file`, `edge_type`
- Chunker return type changes from `CodeChunk[]` to `{ chunks, edges }` — single `walkNodes()` traversal, no double-parse
- LanceDB write mutex (Promise-chain serialization) must be added before any concurrent writes are possible
- Cross-encoder reranking DEFERRED to v2.x — Ollama has no native `/api/rerank` endpoint (PR #7219 closed Sept 2025)
- Structural context compression only (strip bodies, preserve signatures + JSDoc) — no LLM-based summarization

### Key Decisions (Prior milestones)

- Phase 14: Reverted DEFAULT_DISTANCE_THRESHOLD to 0.3 (comment/value mismatch)
- Phase 14: Excluded tree-sitter chunker test via vitest.config.ts — ELF header arch issue, not code defect
- Phase 13: MCP tool descriptions rewritten with directive tone and explicit cross-references

### Session Notes

v2.3 Final Quality Pass roadmap defined: 4 phases (26-29), 9 requirements, all mapped.
Phase ordering: 26 (search precision) → 27 (compression protection) → 28 (trace output quality) → 29 (explain depth).
Phase 27 depends on 26 (compression protection requires precision boosting logic to identify the primary result).
Phase 28 depends on 26 (trace confidence signal requires same similarity threshold awareness as precision boosting).
Phase 29 depends on 27 (explain depth depends on compression protection being in place for primary chunks).
All 4 phases are quality-only — no new MCP tools, no schema changes.
debug.md scenarios map directly to success criteria in each phase.

### Quick Tasks Completed

See prior STATE.md entries for v1.x–v2.2 quick tasks (archived).

---

## Session Continuity

**Last session:** 2026-04-03T19:01:11.706Z

**Stopped at:** Completed 28-02-PLAN.md

**Next action:** `/gsd:plan-phase 26`

---
*State initialized: 2026-03-31*
