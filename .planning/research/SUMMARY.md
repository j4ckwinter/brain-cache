# Project Research Summary

**Project:** brain-cache v2.1 Presentation Magic
**Domain:** MCP Tool Output Presentation Layer — unified formatting for 6 code intelligence tools
**Researched:** 2026-04-03
**Confidence:** HIGH

## Executive Summary

brain-cache v2.1 is a narrow, well-scoped milestone: replace the raw `JSON.stringify()` output of 6 existing MCP tools with a unified, markdown-formatted presentation layer. The codebase is already fully functional — retrieval, indexing, and workflow logic are shipped. The only gap is that each tool returns output in a different shape (some JSON objects, one JSON array, one partial markdown string), making Claude's experience of the tool results inconsistent and harder to reason from. The recommended approach is a pure-function formatter layer in `src/lib/format.ts` with one named, type-safe formatter per tool, all called from the existing handlers in `src/mcp/index.ts`. One new npm dependency (`dedent` 1.7.2) covers template literal indentation; everything else is string construction in TypeScript.

The most important constraint to internalize: MCP tool text content is consumed by Claude, not displayed in a terminal. This means ANSI escape codes, box-drawing characters, and padded column alignment (`padEnd`) are all harmful — they consume tokens with zero semantic value. Real-world measurement (GitHub issue #15718) confirmed ANSI decoration can inflate token count by 50-80%. The correct formatting target is LLM-readable markdown: semantic headers, code fences for code snippets, plain `label: value` pairs for metadata, and summary-first structure. The existing `formatTokenSavings()` function uses `padEnd(27)` column alignment and must be redesigned before inclusion in the unified layer.

The key risk is breaking Claude's existing learned behavior from tool outputs. `search_codebase`, `trace_flow`, and `doctor` currently return parseable JSON; if reformatting removes or renames fields Claude depends on (like `filePath`), downstream file reads and routing decisions will silently fail. The mitigation is to audit the output contract per tool before writing any formatter, define what fields Claude extracts, and preserve those values in the new format as clearly-labeled text values. Zero-result edge cases must be handled explicitly — a bare single-sentence response, never a structured empty frame.

## Key Findings

### Recommended Stack

The base stack (Node.js 22, TypeScript 5.x, MCP SDK, Ollama, LanceDB, pino, zod v4) is locked and unchanged. The only new dependency is `dedent` 1.7.2 — a tagged template literal utility that strips indentation from multi-line strings, enabling clean source code for the new formatter functions without fighting TypeScript indentation. It has dual ESM/CJS exports, TypeScript declarations included, and was updated March 2026. No other npm dependencies are needed: no markdown parsers, no template engines, no color libraries.

**Core technologies for v2.1:**
- `dedent` 1.7.2: Tagged template literal dedenting — the only new runtime dependency
- `src/lib/format.ts` (extension): Home for all 5 new pure formatter functions plus redesigned `formatTokenSavings`
- `src/mcp/index.ts` (modification): Wire each of 6 tool handlers to call its formatter instead of `JSON.stringify`
- Existing `vitest` + `tsx`: Covers testing and dev execution of the new formatter module with no changes

**What not to add:** ANSI color libraries (picocolors, chalk, kleur), markdown parsers (marked, remark), template engines (Handlebars, Mustache), or terminal UI frameworks (ink, blessed). All are inappropriate for MCP stdio output.

### Expected Features

The v2.1 feature set is driven entirely by the existing tool surface — 6 tools, each needing a formatter that produces consistent, scannable output suited to LLM consumption.

**Must have (v2.1 core — P1):**
- `formatToolResponse` shared function: foundation; all tool-specific formatters compose with it
- Consistent summary line at the top of every tool response — summary-first is the universal pattern
- `search_codebase` ranked text renderer: numbered list with score, file path, line, name, type
- `trace_flow` hop-by-hop renderer: numbered hop sequence with file, line, calls-found per hop
- `doctor` health table renderer: fixed-width status block, one service per row
- `index_repo` summary renderer: single-line completion summary with file and chunk counts
- Consistent metadata footer for retrieval tools: token savings present for `build_context` and `explain_codebase` only; not on `search_codebase`, `trace_flow`, `index_repo`, or `doctor`
- Consistent error envelope: all 6 tools use `Error: [tool] failed\n[message]\nSuggestion: [fix]`

**Should have (after v2.1 core validated):**
- Pipeline label in footer: `localTasksPerformed` rendered as `embed -> search -> dedup -> compress`

**Defer to v2.2+:**
- `structuredContent` field alongside text content: only if MCP spec discussion #315 stabilises
- Per-tool output format configuration: only if scripted MCP consumers emerge as a real use case

**Anti-features to reject:** emoji status indicators (CLAUDE.md constraint; rendering inconsistent in tool panels), JSON as default output (LLMs read text, not parsed JSON), rich markdown tables everywhere (pipe tables render as raw `|---|---|` in MCP tool panels), ANSI color codes, streaming output (MCP stdio buffers complete responses).

### Architecture Approach

The presentation layer is a pure-function extension to `src/lib/format.ts`. Workflows return typed data structures (`RetrievedChunk[]`, `TraceFlowResult`, `ContextResult`) and have no knowledge of output format — this separation is non-negotiable because CLI and MCP share the same workflows. The MCP handlers in `src/mcp/index.ts` are the only place that knows which tool is being called; they call the appropriate formatter and wrap the string in `{ type: "text", text }`. No other files change: not workflows, not services, not cli/, not lib/types.ts.

**Major components:**

1. `src/lib/format.ts` (extended) — All presentation logic; pure functions; no imports from services or workflows; input types from `lib/types.ts` only
2. `src/mcp/index.ts` (modified) — Replace 6 `JSON.stringify()` calls with 6 `format*()` calls; add one import line
3. `tests/lib/format.test.ts` (new) — Unit tests for each formatter; no MCP SDK needed to test them
4. `tests/mcp/server.test.ts` (updated) — Adjust assertions from JSON string matching to formatted string matching

Each formatter accepts the exact TypeScript return type of its workflow — no `any`, no `unknown`. TypeScript enforces that formatters stay in sync with workflow return types as they evolve.

**Build order:** Phase 1 — write and test all formatter functions in `format.ts` (independently deliverable, behavior-transparent). Phase 2 — wire `mcp/index.ts` to call them (depends on Phase 1, mechanical substitution).

### Critical Pitfalls

1. **ANSI codes in MCP text content** — Real-world case: 6k tokens of content + 7k tokens of ANSI decoration = 13k total (50-80% waste). Establish a no-ANSI rule in the formatter foundation and grep for `\x1b[` before any phase is considered done. Use markdown formatting only.

2. **Breaking existing output contracts** — `search_codebase` returns `JSON.stringify(chunks)`; Claude uses `filePath` from those chunks to decide what to read. Reformatting to prose without preserving `filePath` as a parseable value silently breaks file reads. Audit what Claude extracts from each tool's output before writing the formatter; snapshot-test existing output shapes.

3. **Over-formatting for the wrong audience** — Decorative section headers, padded alignment (`padEnd`), and redundant separators consume tokens without adding semantic signal. The existing `formatTokenSavings()` uses `padEnd(27)` — this must be replaced with plain `label: value` pairs before inclusion in the unified layer. Rule: if removing a formatting element loses no information, remove it.

4. **Rigid templates failing at 0 or 1 results** — A zero-result response must be a single clean sentence, not a structured frame with empty sections. Claude interprets a structured empty frame as a partial result. Define the zero/one/many rendering contract per tool before writing each formatter; test all three cases.

5. **Formatter diverging from workflow return types** — If formatters accept `any` or `Record<string, unknown>`, TypeScript cannot surface when a new field is added to `TraceFlowResult` or `ContextResult`. Type each formatter to its exact workflow return type; add unit tests that instantiate the full return type — adding a new field will break the test, forcing formatter update.

6. **Token savings metadata on every tool call** — Adding the savings footer to all 6 tools adds ~240 tokens per 6-tool workflow on accounting metadata alone. `search_codebase` does not do context assembly so the "savings" framing is misleading there. Savings footer belongs only on `build_context` and `explain_codebase`; this policy must be decided in the foundation phase.

## Implications for Roadmap

The milestone naturally splits into two sequential phases with the foundation phase as a hard dependency.

### Phase 1: Formatter Foundation

**Rationale:** All 5 tool-specific formatters share design decisions — ANSI policy, token savings policy, edge case contracts, type-safe interface conventions. These decisions must be locked and implemented before any formatter is written. This phase also redesigns `formatTokenSavings` to eliminate the `padEnd` token waste. The result is testable, isolated formatter functions with no change to MCP behavior yet.

**Delivers:** Extended `src/lib/format.ts` with 5 new pure formatter functions (`formatSearchResults`, `formatContext`, `formatTraceFlow`, `formatDoctorOutput`, `formatIndexResult`) plus redesigned `formatTokenSavings`; full unit test suite in `tests/lib/format.test.ts` covering 0/1/N result cases for each formatter; no MCP behavior change.

**Addresses:** All P1 features from FEATURES.md except the MCP wiring; establishes the shared response envelope, summary line, tool-specific body shapes, error envelope, and metadata footer policy.

**Avoids:** Pitfalls 1 (ANSI), 3 (over-formatting), 4 (rigid templates), 5 (type drift), 6 (savings redundancy) — all caught by formatter unit tests and no-ANSI grep before any handler is touched.

**Research flag:** No additional research needed. Patterns are well-documented via direct codebase inspection, MCP spec, and Anthropic engineering guides. Standard implementation phase.

### Phase 2: MCP Handler Wiring

**Rationale:** Mechanical substitution — replace `JSON.stringify(result)` with `format*(result)` in each of 6 handlers. Can only proceed after Phase 1 because the formatters must exist and be tested before the handlers call them. Low risk because all complex logic is in Phase 1; this phase is one line changed per handler.

**Delivers:** Updated `src/mcp/index.ts` with all 6 handlers calling their formatters; updated `tests/mcp/server.test.ts` with assertions adjusted for formatted output; behavior change now visible to Claude Code.

**Uses:** `dedent` 1.7.2 (for multi-line template literals in formatters), all formatters from Phase 1.

**Implements:** The `mcp/index.ts` → `lib/format.ts` → `lib/types.ts` component boundary defined in ARCHITECTURE.md.

**Avoids:** Pitfall 2 (broken output contract) — snapshot tests in Phase 2 verify field preservation; CLAUDE.md routing guidance updated in the same commit that changes output shapes.

**Research flag:** No additional research needed. Integration pattern is one line per handler; all decision-making is in Phase 1.

### Phase Ordering Rationale

- Phase 1 before Phase 2 is a hard dependency: handlers cannot call formatters that do not exist.
- Within Phase 1, the 5 formatter functions are independent of each other and can be written in any order. The output contract audit (Pitfall 2 mitigation) must be the first task — before any formatter is written.
- `build_context` and `explain_codebase` are simpler in Phase 1 because their body content is already well-structured; they need only a consistent wrapper added. `search_codebase`, `trace_flow`, and `doctor` are complete rewrites from JSON.
- The `formatTokenSavings` redesign (eliminating `padEnd`) must happen in Phase 1 before the shared formatter composes it — retrofitting after Phase 2 ships would require re-testing all 4 retrieval tool outputs.

### Research Flags

Phases with standard patterns (no additional research needed):
- **Phase 1:** All formatter input types confirmed by direct codebase inspection. MCP spec and Anthropic engineering guides fully define the output constraints. No unknowns.
- **Phase 2:** Handler wiring is mechanical. MCP SDK usage pattern is unchanged.

No phase requires a `/gsd:research-phase` call during planning. All research is complete.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Single new dependency (`dedent`) verified against npm; all other decisions based on direct codebase inspection and confirmed MCP specification |
| Features | HIGH | All 6 tool handlers inspected directly; current output shapes confirmed; feature scope is additive with no external API surface |
| Architecture | HIGH | All workflow return types confirmed by direct file reads; formatter boundary and component responsibilities are unambiguous; build order is clear |
| Pitfalls | HIGH | Primary pitfalls backed by Anthropic engineering documentation, MCP spec, and real-world GitHub issue with measured token counts; secondary pitfalls confirmed by multiple independent sources |

**Overall confidence:** HIGH

### Gaps to Address

- **`formatTokenSavings` redesign scope:** The exact replacement format for `padEnd(27)` alignment — `label: value` pairs on separate lines vs. inline prose — should be decided at the start of Phase 1 and applied consistently across all 4 retrieval tool formatters. Low risk; pure string formatting decision with no external dependencies.

- **MCP `structuredContent` field:** The 2025-06-18 MCP spec introduces a `structuredContent` field for separating display content from LLM context. Claude Code client support is not yet confirmed stable. Research recommends deferring to v2.2+. Monitor MCP spec discussion #315 — if this stabilises, it is a low-effort addition but should not be planned for now.

- **CLAUDE.md routing guidance sync:** After Phase 2 ships and output shapes change, the CLAUDE.md tool routing table must be audited for accuracy. Stale descriptions cause routing regressions. Flag this as a post-Phase-2 task in the same commit that wires the handlers.

## Sources

### Primary (HIGH confidence)

- `/workspace/src/mcp/index.ts` — Direct inspection of all 6 MCP tool handlers; current output patterns confirmed
- `/workspace/src/lib/format.ts` — Direct inspection of existing `formatTokenSavings` helper with `padEnd(27)` usage
- `/workspace/src/lib/types.ts` — `RetrievedChunk`, `ContextResult`, `TraceFlowResult` type definitions confirmed
- [MCP Specification 2025-06-18 — Tools](https://modelcontextprotocol.io/specification/2025-06-18/server/tools) — `content[].type: "text"` confirmed as correct unstructured response format
- [Anthropic Engineering — Writing Effective Tools for AI Agents](https://www.anthropic.com/engineering/writing-tools-for-agents) — "return only high signal information"; "avoid formatting noise that confuses agents"
- [GitHub claude-code#15718](https://github.com/anthropics/claude-code/issues/15718) — ANSI token waste measured: 6k content + 7k ANSI = 13k total
- [dedent npm](https://www.npmjs.com/package/dedent) — v1.7.2, dual ESM/CJS, TypeScript declarations, updated March 2026

### Secondary (MEDIUM confidence)

- [ATLAS MCP Server — DeepWiki](https://deepwiki.com/cyanheads/atlas-mcp-server/5.6-response-formatting) — `ResponseFormatter<T>` interface pattern as comparable reference
- [probe code search tool — GitHub](https://github.com/probelabs/probe) — ranked output with file paths, scores, multiple format options
- [Anthropic Engineering — Effective Context Engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) — progressive disclosure and information density principles
- [Trail of Bits — ANSI terminal codes in MCP](https://blog.trailofbits.com/2025/04/29/deceiving-users-with-ansi-terminal-codes-in-mcp/) — ANSI in MCP output confirmed as tokenization problem and security surface

### Tertiary (LOW confidence)

- [MCP spec discussion #315](https://github.com/modelcontextprotocol/modelcontextprotocol/discussions/315) — proposal for `structuredContent`; not finalised; monitor only
- [BytePlus MCP Response Formatting Guide](https://www.byteplus.com/en/topic/541423) — consistent field names and structured output patterns; third-party guide

---
*Research completed: 2026-04-03*
*Ready for roadmap: yes*
