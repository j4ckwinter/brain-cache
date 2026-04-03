# Feature Research

**Domain:** MCP tool output presentation layer — unified formatting for code intelligence tools
**Researched:** 2026-04-03
**Confidence:** HIGH (existing codebase read directly; MCP and CLI presentation patterns verified against current sources)

---

## Context: Scope of This Research

This research covers only the **v2.1 Presentation Magic** milestone. All retrieval, indexing, and workflow logic is already shipped. The question is:

> What does a unified, polished presentation layer for 6 MCP tools look like?

**What already exists (not in scope):**
- 6 MCP tools: `index_repo`, `search_codebase`, `build_context`, `doctor`, `trace_flow`, `explain_codebase`
- Each returns raw data via `content: [{ type: "text", text: ... }]`
- Inconsistent output shapes: `index_repo` returns JSON, `search_codebase` returns a JSON array, `build_context` returns JSON with inline token savings text, `trace_flow` returns raw JSON, `explain_codebase` returns a hand-rolled markdown string, `doctor` returns raw JSON
- One shared helper: `formatTokenSavings()` in `src/lib/format.ts` — padded key-value table, used only by `build_context` and `explain_codebase`

**Current inconsistencies observed in the codebase:**
- `index_repo`: returns `JSON.stringify({ status, path, fileCount, chunkCount })`
- `search_codebase`: returns `JSON.stringify(chunks)` — raw array dump, no framing
- `build_context`: returns `JSON.stringify({ ...result, tokenSavings: formatTokenSavings(...) })` — JSON with embedded text block
- `doctor`: returns `JSON.stringify(health)` — raw health object
- `trace_flow`: returns `JSON.stringify(result)` — raw hops array in JSON
- `explain_codebase`: returns hand-assembled markdown string: `# Codebase Architecture Overview\n\n${content}\n\n---\n${tokenSavings}`

**The goal:** every tool response feels like it comes from a single, polished system — consistent structure, predictable order, readable output suited for Claude Code's chat interface.

---

## Feature Landscape

### Table Stakes (Users Expect These)

These are required for the presentation layer to feel complete. Missing any of these makes the output feel unfinished or inconsistent.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Consistent response envelope across all tools | Inconsistent output shapes force Claude (and humans reading tool results) to adapt per-tool — breaks the "single system" feel; all code intelligence tools from well-maintained projects (probe, atlas-mcp-server) use a consistent wrapper | LOW | A shared `formatToolResponse(tool, payload, meta?)` function in `src/lib/format.ts`; wraps all tool outputs in a predictable shape |
| Summary line at the top of every response | Summary-first is a universal CLI convention (git, gh, cargo output patterns all front-load the result); without it, consumers must scan the full response to understand what happened | LOW | One-line summary rendered before body content: `Indexed 142 files (8,341 chunks) in /workspace` before the detail block |
| Structured sections with clear labels | Separate sections for results, metadata, and errors prevent consumers from parsing mixed-format blobs; atlas-mcp-server shows this pattern produces better LLM reasoning | LOW | Markdown-style section headers (`## Results`, `## Metadata`) used consistently within text content responses |
| Predictable field presence | Claude Code must infer meaning from tool output; if optional fields randomly appear or disappear, prompting becomes unreliable | LOW | All metadata fields always present with null/0 defaults rather than omitted; never conditional key presence |
| Error responses that match success response structure | Current error paths return bare strings like `"Search failed: ..."` with no structure; LLM cannot distinguish an error from a result | LOW | Error responses use the same envelope as success, with an explicit `status: "error"` marker and `message` field |
| Token savings consistent across tools that do retrieval | `build_context` shows token savings; `search_codebase` and `trace_flow` do not — yet they also perform local retrieval that saves tokens; inconsistency trains Claude to only look for savings in one place | LOW | Token savings metadata section present for all tools that perform retrieval (`search_codebase`, `build_context`, `trace_flow`, `explain_codebase`); absent for `index_repo` and `doctor` which do not retrieve |

### Differentiators (Competitive Advantage)

These go beyond basic consistency — they make the output quality noticeably better than raw JSON dumps or hand-rolled strings.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Tool-specific identity within the shared system | Each tool has its own result shape that makes sense for its content type: `trace_flow` shows numbered hops, `search_codebase` shows ranked file locations, `explain_codebase` shows directory tree + module groups, `doctor` shows a health dashboard; all within a shared envelope | MEDIUM | Shared formatter dispatches to tool-specific body renderers; each renderer lives in the same `format.ts` or a `formatters/` subfolder; the shared wrapper (header, metadata footer) never changes |
| Hop-by-hop formatting for `trace_flow` | Flow traces are inherently sequential; rendering each hop as a numbered step with file + line + calls-found makes the execution path scannable at a glance — raw JSON forces Claude to reconstruct the path mentally | LOW | `Hop 1 → src/workflows/buildContext.ts:28 (runBuildContext)\n  Calls: runTraceFlow, runExplainCodebase` — plain text, no markdown tables |
| Ranked result formatting for `search_codebase` | Search results have a similarity score; surfacing it as a ranked list with score + file + line makes the relevance gradient visible — Claude can use rank position to weight evidence | LOW | `1. src/services/embedder.ts:45 — embedBatch [function] (score: 0.94)\n2. ...` format; not a JSON array |
| Health dashboard format for `doctor` | Structured health report with visual status indicators (installed/running/missing) is the standard pattern for diagnostic tools (Docker health checks, npm doctor) — raw JSON requires parsing to see status | LOW | `Ollama: running (v0.6.3)\nIndex:  indexed (142 files, 2026-04-03)\nModel:  nomic-embed-text (loaded)\nVRAM:   8.0 GiB (standard tier)` — fixed-width table |
| `localTasksPerformed` surfaced as a readable pipeline | `metadata.localTasksPerformed` exists on every retrieval result but is currently buried inside JSON; showing it as a one-line pipeline summary (`embed → search → dedup → compress → group`) communicates what brain-cache did locally vs what Claude has to do | LOW | Append as a single "Pipeline" line in the metadata footer; already available from every workflow result |
| Cohesion with Claude's response style | The output should read as a natural extension of Claude's own reasoning style — factual, structured, no decorative prose, no padding — so Claude's response wraps around it naturally without reformatting | LOW | Use plain text over JSON for human-readable sections; avoid bullet overload; prefer section headers to nested JSON keys; follow Claude's own convention of leading with the answer |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Emoji status indicators (✅ ❌ ⚠️) | atlas-mcp-server uses them; they feel polished in demos | Claude Code renders tool output in a monospace panel where emojis sometimes display inconsistently; brain-cache CLAUDE.md instructions already state no emojis; adds visual noise to content Claude will reason about | Use text status words: `ok`, `error`, `warning`; or simple ASCII markers like `[ok]` / `[error]` if a prefix is needed |
| JSON output as the default format | JSON is machine-parseable; seems like it gives Claude more to work with | Claude Code parses tool output as text, not as structured JSON — the AI reads the text content directly; JSON-formatted output produces worse Claude responses than well-structured prose because it forces Claude to re-parse structure instead of reading naturally | Use structured text (sections, labels, values) for default; raw JSON is appropriate only for `index_repo` success (a small status object) and `doctor` where field names carry meaning |
| Rich markdown with tables everywhere | Tables look organised in chat; seem to communicate structure well | MCP tool output is rendered in a tool-result panel, not in the main chat markdown renderer; markdown tables are displayed as raw `|---|---|` strings in many Claude Code contexts | Use fixed-width aligned text for tabular data (like `git status` output); use plain headers (`## Results`) only where sections genuinely need names |
| Returning both structured content and text content | MCP spec discussion #315 proposes `structuredContent` + backward-compat `TextContent` | The proposal is not finalised; Claude Code currently reads only the `text` content block; implementing dual-format adds code complexity with no practical benefit today | Return text content only; structured content field can be added in a future milestone if the spec stabilises |
| Colour / ANSI escape codes in output | CLI tools use colour; improves scannability in terminal | MCP tool output is not rendered in a raw terminal — it goes through the MCP text content type and is displayed in Claude Code's tool result view; ANSI codes appear as raw `\x1b[32m` characters | No colour in MCP tool output; colour is appropriate for the CLI commands (`brain-cache doctor`, `brain-cache status`) but not for MCP |
| Per-tool output format toggle (json vs text) | Power users want raw JSON for scripting | Brain-cache MCP tools are called by Claude Code, not by scripts; the consumer is always an LLM; a toggle adds config surface area with no practical use case | Default to readable text; `doctor` JSON fields are self-documenting enough to stay as a formatted text block |
| Streaming / incremental output | Feels more responsive for long operations | MCP stdio transport buffers complete responses; partial output would require protocol-level support that the current SDK does not expose; index operations are better served by progress logs to stderr (which already exist) | Keep stdout for complete responses; use `process.stderr.write` for progress updates (already done in `buildContext.ts` and `explainCodebase.ts`) |

---

## Feature Definitions (Concrete Behaviours)

### Shared response envelope — what "consistent structure" means

Every tool response is text content in this shape:

```
[SUMMARY LINE]

[TOOL-SPECIFIC BODY]

---
[METADATA FOOTER]
```

- **Summary line:** one sentence, front-loaded. Always the first line. Always present.
- **Tool-specific body:** varies by tool (see below). May be empty for simple operations.
- **Separator:** `---` always separates body from footer.
- **Metadata footer:** always present for retrieval tools; omitted for `index_repo` and `doctor` (they have no retrieval metadata). Contains: pipeline, token savings (if applicable).

Example for `search_codebase`:
```
Found 5 results for "embed batch"

1. src/services/embedder.ts:45 — embedBatch [function] (score: 0.94)
2. src/services/embedder.ts:89 — embedBatchWithRetry [function] (score: 0.91)
3. src/workflows/buildContext.ts:132 — embed call [file] (score: 0.78)
4. src/services/lancedb.ts:201 — storeChunks [function] (score: 0.62)
5. src/cli/index.ts:89 — runSearch call [file] (score: 0.58)

---
Pipeline:   embed → search → dedup
Tokens sent to Claude:   312
Estimated without:       ~4,100  (5 files + overhead)
Reduction:               92%
```

### Tool-specific body renderers — what each tool produces

| Tool | Body Shape | Key Fields |
|------|-----------|------------|
| `index_repo` | `Indexed N files (M chunks) at /path` — single line body, no footer | fileCount, chunkCount, path |
| `search_codebase` | Numbered ranked list: rank, file path, line, name, type, score | similarity, filePath, startLine, name, chunkType |
| `build_context` | Full formatted context (existing `formatGroupedContext` output) unchanged | content, tokensSent, reductionPct |
| `doctor` | Fixed-width health table: one service per row | ollamaStatus, indexFreshness, embeddingModel, vramAvailable |
| `trace_flow` | Numbered hops: hop depth, file, line, name, calls-found list | hops[].filePath, hops[].name, hops[].callsFound |
| `explain_codebase` | Directory tree preamble + module-grouped code sections (existing content) | content, directory tree |

### Error envelope — what errors look like

All errors use the same envelope. The `isError: true` flag stays on the MCP response for protocol compliance. The text content of the error is:

```
Error: [tool name] failed

[error message]

Suggestion: [actionable next step — e.g. "Run 'brain-cache init' first" or "Start Ollama with 'ollama serve'"]
```

The `Suggestion` line is only included if a remediation is known. It is omitted for unexpected errors.

### `formatToolResponse` — the shared formatter signature

The single new function that all tools will call:

```typescript
// src/lib/format.ts (extends existing file)
export function formatToolResponse(
  tool: ToolName,
  summary: string,
  body: string,
  meta?: ToolMetadata,
): string
```

Where `ToolMetadata` carries:
- `pipeline?: string[]` — tasks performed locally
- `tokensSent?: number`
- `estimatedWithout?: number`
- `reductionPct?: number`
- `filesInContext?: number`

The function is pure (no I/O), testable, and replaces all the inline string assembly currently scattered across `mcp/index.ts`.

---

## Feature Dependencies

```
[Shared response envelope]
    └──required by──> [All tool-specific body renderers]
    └──required by──> [Consistent error envelope]

[formatToolResponse function]
    └──replaces──> [inline JSON.stringify calls in mcp/index.ts]
    └──replaces──> [hand-assembled markdown string in explain_codebase handler]
    └──extends──>  [existing formatTokenSavings in src/lib/format.ts]

[Tool-specific body renderers]
    └──search_codebase renderer──requires──> [RetrievedChunk.similarity, .filePath, .startLine, .name, .chunkType]
    └──trace_flow renderer──requires──>      [TraceFlowResult.hops[].hopDepth, .filePath, .name, .callsFound]
    └──doctor renderer──requires──>          [health object fields from doctor handler]
    └──index_repo renderer──requires──>      [indexState.fileCount, .chunkCount]
    └──build_context renderer──requires──>   [existing formatGroupedContext output — no change]
    └──explain_codebase renderer──requires── [existing content string — no change]

[Token savings footer]
    └──requires──> [formatTokenSavings (already exists)]
    └──applies to──> search_codebase, build_context, trace_flow, explain_codebase
    └──not applicable──> index_repo, doctor
```

### Dependency Notes

- **`build_context` and `explain_codebase` bodies are unchanged:** These tools already produce well-structured text (formatted grouped context, directory tree + module sections). The presentation layer wraps them with a consistent summary line and footer — the body content itself is not modified.
- **`search_codebase` body is a complete rewrite from JSON array to ranked text:** Currently returns `JSON.stringify(chunks)`. The new body renderer converts the same data into a numbered ranked list. The underlying workflow (`runSearch`) is not touched.
- **`trace_flow` body is a complete rewrite from JSON to hop-by-hop text:** Currently returns `JSON.stringify(result)`. The new body renderer formats hops as a numbered sequence. The underlying workflow (`runTraceFlow`) is not touched.
- **`doctor` body is a complete rewrite from JSON to health table:** Currently returns `JSON.stringify(health)`. Health fields are stable and known; a fixed-width table is easy to produce.
- **`index_repo` body is minimal change:** Currently returns `JSON.stringify({ status, path, fileCount, chunkCount })`. New format is a one-line summary — no body section needed.
- **No workflow changes:** The presentation layer is purely in `mcp/index.ts` and `src/lib/format.ts`. No workflow, service, or type changes required.

---

## MVP Definition for v2.1

### Launch With (v2.1 core)

All of these are required for the milestone goal of "outputs feel like a single, polished system."

- [ ] **`formatToolResponse` shared function** — the foundation; all other presentation features build on this; lives in `src/lib/format.ts`
- [ ] **Consistent summary line for all 6 tools** — first line of every response; one sentence; always present
- [ ] **`search_codebase` ranked text renderer** — replace JSON array dump with numbered ranked list including score, file, line, name, type
- [ ] **`trace_flow` hop-by-hop text renderer** — replace JSON dump with numbered hop sequence showing file, line, calls-found
- [ ] **`doctor` health table renderer** — replace JSON object with fixed-width health dashboard
- [ ] **`index_repo` summary renderer** — replace JSON object with single-line completion summary
- [ ] **Consistent metadata footer for retrieval tools** — token savings + pipeline present for `search_codebase`, `build_context`, `trace_flow`, `explain_codebase`; absent for `index_repo` and `doctor`
- [ ] **Consistent error envelope** — all 6 tools use the same error shape with `Error:`, message, and optional `Suggestion:`

### Add After Validation (v2.1.x)

- [ ] **Pipeline label in footer** — `localTasksPerformed` shown as `embed → search → dedup → compress`; low value on launch but useful for debugging and transparency

### Future Consideration (v2.2+)

- [ ] **Structured content field alongside text content** — only if MCP spec discussion #315 stabilises and Claude Code adds client-side parsing; no practical benefit today
- [ ] **Per-tool output format configuration** — only if scripted MCP consumers emerge as a real use case

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| `formatToolResponse` shared function | HIGH | LOW | P1 |
| Summary line — all tools | HIGH | LOW | P1 |
| `search_codebase` ranked text renderer | HIGH | LOW | P1 |
| `trace_flow` hop-by-hop renderer | HIGH | LOW | P1 |
| `doctor` health table renderer | MEDIUM | LOW | P1 |
| `index_repo` summary renderer | MEDIUM | LOW | P1 |
| Consistent metadata footer | HIGH | LOW | P1 |
| Consistent error envelope | HIGH | LOW | P1 |
| Pipeline label in footer | LOW | LOW | P2 |
| Structured content field | LOW | MEDIUM | P3 |

**Priority key:**
- P1: Required for v2.1 milestone
- P2: Add in v2.1.x after core validated
- P3: Future milestone

---

## Competitor Format Analysis

Surveying how comparable developer tools format their tool/plugin output — looking at what Claude Code actually receives and reasons from.

| Pattern | atlas-mcp-server | probe (code search) | gh CLI | brain-cache v2.1 approach |
|---------|-----------------|---------------------|--------|---------------------------|
| Summary line | Status emoji + name | Token count + result count | `#123  PR title  (open)` front-loaded | Plain text: `Found 5 results for "..."` |
| Body structure | Hierarchical JSON-like text with labels | Markdown code blocks per result, AST-aware | Table or detail view depending on command | Tool-specific renderer within shared envelope |
| Metadata footer | Pagination metadata | Token budget used | Rate limits in verbose mode | Token savings + pipeline for retrieval tools |
| Error format | `❌ Error message` | Error message to stderr | Error to stderr + exit code | `Error: [tool] failed\n[message]\nSuggestion: [fix]` |
| Status indicators | Emojis ✅ ❌ ⚠️ | None | Text status words | Text status words; no emojis (CLAUDE.md constraint) |
| Consistency mechanism | `ResponseFormatter<T>` interface | Token-budget parameter; ranked output | Command-specific but consistent within `gh` | `formatToolResponse()` function called by all 6 handlers |

**Key insight from research:** The ATLAS pattern (typed `ResponseFormatter<T>` interface per tool, with a central `createToolResponse` wrapper) is the closest match to what brain-cache needs. The difference is that brain-cache outputs text content, not structured JSON — so the equivalent is a `formatToolResponse` function with a tool-specific body renderer callback, not a JSON schema.

---

## Sources

- `/workspace/src/mcp/index.ts` — all 6 MCP tool handlers, current output shapes (HIGH confidence — direct codebase read)
- `/workspace/src/lib/format.ts` — existing `formatTokenSavings` helper (HIGH confidence — direct codebase read)
- `/workspace/src/workflows/traceFlow.ts` — `TraceFlowResult` type with `hops[]` structure (HIGH confidence — direct codebase read)
- `/workspace/src/workflows/explainCodebase.ts` — `ContextResult` type, existing content assembly (HIGH confidence — direct codebase read)
- `/workspace/src/lib/types.ts` — `RetrievedChunk`, `ContextMetadata`, `ContextResult` type definitions (HIGH confidence — direct codebase read)
- [ATLAS MCP Server Response Formatting — DeepWiki](https://deepwiki.com/cyanheads/atlas-mcp-server/5.6-response-formatting) — `ResponseFormatter<T>` interface pattern, `createToolResponse` wrapper, dual JSON/text format support (MEDIUM confidence — third-party analysis)
- [MCP Suggested Response Format Discussion #315 — GitHub](https://github.com/modelcontextprotocol/modelcontextprotocol/discussions/315) — proposal for `structuredContent` field; not finalised; backward-compat text content still primary (MEDIUM confidence — official spec discussion)
- [probe code search tool — GitHub](https://github.com/probelabs/probe) — ranked output with file paths, scores, AST-aware complete blocks; multiple format options (markdown default, JSON, XML) (MEDIUM confidence — project README)
- [MCP Response Formatting Guide — BytePlus](https://www.byteplus.com/en/topic/541423) — avoids narrative/explanatory text, consistent lowercase field names, structured extractable fields (LOW confidence — third-party guide)
- [Top CLI UX Patterns — Medium](https://medium.com/@kaushalsinh73/top-8-cli-ux-patterns-users-will-brag-about-4427adb548b7) — structured output, smart errors, honest progress as key CLI UX patterns (LOW confidence — opinion piece, consistent with observed patterns)

---

*Feature research for: brain-cache v2.1 Presentation Magic milestone*
*Researched: 2026-04-03*
