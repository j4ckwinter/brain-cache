# Architecture Research

**Domain:** Local AI runtime — v2.1 Presentation Magic: unified formatting layer for brain-cache MCP tool outputs
**Researched:** 2026-04-03
**Confidence:** HIGH (based on direct inspection of all src/ files — mcp/index.ts, lib/format.ts, workflows/*.ts, lib/types.ts)

---

## Current State: How Formatting Works Today

Each MCP tool in `src/mcp/index.ts` serializes its output independently, with no shared contract:

| Tool | Current output format | Notes |
|------|-----------------------|-------|
| `index_repo` | `JSON.stringify({ status, path, fileCount, chunkCount })` | Raw JSON object |
| `search_codebase` | `JSON.stringify(chunks)` — `RetrievedChunk[]` array | Raw JSON array |
| `build_context` | `JSON.stringify({ ...result, tokenSavings: formatTokenSavings(...) })` | Hybrid JSON + formatted string inside |
| `doctor` | `JSON.stringify(health)` | Raw JSON object |
| `trace_flow` | `JSON.stringify(result)` — `TraceFlowResult` | Raw JSON with nested hops array |
| `explain_codebase` | Template literal: `# Codebase Architecture Overview\n\n${result.content}\n\n---\n${tokenSavings}` | Only tool that returns structured markdown |

The existing `src/lib/format.ts` has one function: `formatTokenSavings()`. It is only called in `build_context` and `explain_codebase` tool handlers — not a shared layer.

**The gap:** No tool follows a consistent output shape. Claude sees JSON blobs, raw arrays, or ad-hoc template strings depending on which tool it called. The goal is consistent structure: summary-first, scannable sections, token savings footer on relevant tools, tool-specific identity within a shared shell.

---

## Recommended Architecture: Formatter in `src/lib/`

### Decision: Formatters Belong in `src/lib/`, Not in Workflows

The formatting layer must live in `src/lib/format.ts` (extending the existing file). Not in workflows. Not in services. Here is why:

**Workflows return data structures, not display strings.** `runSearch()` returns `RetrievedChunk[]`. `runTraceFlow()` returns `TraceFlowResult`. These are consumed by both MCP handlers and CLI commands. CLI output may differ from MCP output (e.g., coloured terminal vs. MCP TextContent). Pushing formatting into workflows would break this separation and force CLI and MCP to share the same presentation.

**MCP handlers are where tool identity is applied.** The `src/mcp/index.ts` handler already knows which tool is being formatted. It is the only place that has context to call the right formatter with the right parameters.

**`src/lib/` is the right home for pure-function utilities** with no external dependencies. `format.ts` already exists there and already has `formatTokenSavings()`. The new formatters are pure functions: `(data, metadata?) => string`. No database, no Ollama, no workflow imports.

### Where Formatting Does NOT Happen

- **Not in workflows:** Workflows return typed data (`ContextResult`, `TraceFlowResult`, `RetrievedChunk[]`). They are display-agnostic. This rule is non-negotiable — CLI and MCP share the same workflow layer.
- **Not in services:** Services are lower-level transformation utilities. Formatting is a presentation concern, not a data concern.
- **Not as a new `src/tools/` module:** The `src/tools/index.ts` file explicitly notes it is reserved for future standalone tool modules. Formatters are not tool modules — they are rendering utilities.

---

## System Overview With Presentation Layer

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Entry Points                                        │
│  ┌──────────────────────┐              ┌──────────────────────────────────┐  │
│  │  CLI (Commander)     │              │  MCP Server (stdio JSON-RPC)     │  │
│  │  src/cli/index       │              │  src/mcp/index                   │  │
│  │                      │              │          │                        │  │
│  │  [uses pino/chalk    │              │  format*(result) ──► TextContent │  │
│  │   for terminal]      │              │  [calls src/lib/format.ts]        │  │
│  └──────────┬───────────┘              └────────────────┬─────────────────┘  │
└─────────────┼────────────────────────────────────────────┼────────────────────┘
              │                                            │
              │        ┌────────────────────────┐          │
              └───────►│   src/lib/format.ts    │◄─────────┘
                       │                        │
                       │  formatSearchResults() │
                       │  formatContext()        │
                       │  formatTraceFlow()      │
                       │  formatDoctorOutput()   │
                       │  formatIndexResult()    │
                       │  formatTokenSavings()   │
                       │  (pure functions)       │
                       └────────────────────────┘
                                  ▲
                       Uses types from src/lib/types.ts only
                                  │
┌─────────────────────────────────┼───────────────────────────────────────────┐
│                    Workflows Layer                                            │
│  ┌──────────┐ ┌─────────────┐ ┌──────────────┐ ┌────────┐ ┌──────────────┐  │
│  │  index   │ │buildContext │ │ explainCbase │ │ search │ │  traceFlow   │  │
│  │ (void)   │ │(ContextResult│ │(ContextResult│ │(Chunk[]│ │(TraceFlowRes)│  │
│  └──────────┘ └─────────────┘ └──────────────┘ └────────┘ └──────────────┘  │
│  Return typed data structures — no knowledge of output format                │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## Component Responsibilities

| Component | Responsibility | What It Owns |
|-----------|---------------|-------------|
| `src/lib/format.ts` | Pure rendering functions — typed data in, string out | All presentation logic, section ordering, labels, separators |
| `src/mcp/index.ts` | Wire workflows to formatters; own MCP TextContent wrapping | Calls `format*()` before wrapping in `{ type: 'text', text }` |
| `src/lib/types.ts` | Input types for formatters | Already has `ContextResult`, `TraceFlowResult`, `RetrievedChunk[]` — no changes needed |
| Workflows | Return typed data; no formatting concern | Return types stay unchanged |

---

## New File Structure

Only `src/lib/format.ts` is new or modified. Nothing else moves or changes structurally.

```
src/
├── lib/
│   ├── format.ts     EXTEND: add 5 new formatter functions alongside existing formatTokenSavings()
│   ├── types.ts      NO CHANGE (formatter input types already exist)
│   ├── config.ts     NO CHANGE
│   └── index.ts      NO CHANGE (re-exports)
├── mcp/
│   └── index.ts      MODIFY: replace inline JSON.stringify / template literals with format*() calls
├── workflows/        NO CHANGE (return types unchanged)
├── services/         NO CHANGE
└── cli/              NO CHANGE (cli formatting is separate, terminal-specific concern)
```

---

## Formatter Function Signatures

All formatters are pure functions. No async. No imports from services or workflows.

```typescript
// src/lib/format.ts

// Existing — unchanged
export function formatTokenSavings(input: TokenSavingsInput): string

// New: format search_codebase output
export function formatSearchResults(chunks: RetrievedChunk[], query: string): string

// New: format build_context and explain_codebase output
export function formatContext(result: ContextResult, opts: { toolName: string }): string

// New: format trace_flow output
export function formatTraceFlow(result: TraceFlowResult, entrypoint: string): string

// New: format doctor output
export function formatDoctorOutput(health: DoctorHealth): string

// New: format index_repo output
export function formatIndexResult(result: IndexResult): string
```

The `DoctorHealth` and `IndexResult` shapes are currently inline in `mcp/index.ts`. They should either be typed inline in `format.ts` parameter signatures or extracted to `lib/types.ts` if reused. Given that `doctor` builds its health object directly in the handler and `index_repo` reads index state, defining the formatter parameter types locally in `format.ts` is sufficient — no types.ts changes required.

---

## Data Flow: Before and After

### Before (current, search_codebase example)

```
runSearch(query, opts)
  → RetrievedChunk[]
  → JSON.stringify(chunks)       ← inline in handler, no structure
  → { type: 'text', text: "[{filePath:..., content:...}]" }
```

### After (with presentation layer)

```
runSearch(query, opts)
  → RetrievedChunk[]
  → formatSearchResults(chunks, query)   ← pure function in lib/format.ts
  → "## Search Results\n\n### 1. functionName (file.ts:12)\n..."
  → { type: 'text', text: "## Search Results\n\n..." }
```

### Call Site Pattern in mcp/index.ts

The handler pattern becomes:

```typescript
// Before
return {
  content: [{ type: "text" as const, text: JSON.stringify(chunks) }],
};

// After
return {
  content: [{ type: "text" as const, text: formatSearchResults(chunks, query) }],
};
```

This is the entire change at each call site. The workflow is untouched. The formatter is testable in isolation.

---

## Consistent Output Structure (Design Contract)

Each formatter should follow this structure where applicable:

```
[Tool identity line]       ← 1 line: "brain-cache / search_codebase"
[Summary line]             ← 1 line: "Found 8 results for 'runBuildContext'"

[Section 1: primary data] ← tool-specific content
[Section 2: secondary]    ← optional

---
[Token savings footer]     ← only on tools that retrieve/assemble content
```

**Tool-specific identity:**

| Tool | Primary section shape |
|------|----------------------|
| `search_codebase` | Ranked list: `### N. name (file.ts:line)` with similarity score |
| `build_context` | File-grouped code blocks (already formatted by cohesion service) |
| `trace_flow` | Numbered hops: `### Hop N: name (file.ts:line)` with callsFound |
| `explain_codebase` | Directory tree + module sections (already formatted by workflow) |
| `doctor` | Labelled status lines (healthy/warning/error per component) |
| `index_repo` | Single status block: indexed N files, M chunks |

---

## Architectural Patterns

### Pattern 1: Formatter as Pure Function in lib/

**What:** Each formatter takes typed data, returns a string. No side effects. No imports from services or workflows.

**When to use:** Every new presentation need for an MCP tool output.

**Trade-offs:** Slight duplication of type shapes (DoctorHealth, IndexResult defined locally). Benefit: complete testability without mocking anything.

**Example:**
```typescript
// Pure — no deps except lib/types.ts
export function formatSearchResults(chunks: RetrievedChunk[], query: string): string {
  const header = `brain-cache / search_codebase\nFound ${chunks.length} result${chunks.length !== 1 ? 's' : ''} for '${query}'\n`;
  const items = chunks.map((c, i) => {
    const loc = `${c.filePath}:${c.startLine}`;
    const score = `similarity ${(c.similarity * 100).toFixed(0)}%`;
    return `### ${i + 1}. ${c.name ?? '[anonymous]'} (${loc})  ${score}\n\`\`\`\n${c.content}\n\`\`\``;
  });
  return [header, ...items].join('\n\n');
}
```

### Pattern 2: MCP Handler Calls One Formatter, Returns TextContent

**What:** The handler calls the workflow, calls the formatter, returns. No conditional logic about format.

**When to use:** All 6 tool handlers in `src/mcp/index.ts`.

**Trade-offs:** Handler becomes thinner (good). Formatter must handle edge cases (empty arrays, null fields) cleanly.

**Example:**
```typescript
// In mcp/index.ts — trace_flow handler
try {
  const result = await runTraceFlow(entrypoint, { maxHops, path });
  return { content: [{ type: 'text' as const, text: formatTraceFlow(result, entrypoint) }] };
} catch (err) {
  return { isError: true, content: [{ type: 'text' as const, text: `trace_flow failed: ...` }] };
}
```

### Pattern 3: Error Messages Are NOT Formatted by lib/format.ts

**What:** Error paths in MCP handlers return plain text strings. Only success paths use formatters.

**When to use:** All `isError: true` returns.

**Rationale:** Error messages are already consistent (plain sentence describing what failed). No structure needed. Wrapping them in formatted sections adds noise. The current error pattern is correct and stays unchanged.

### Pattern 4: Token Savings Footer Appended by Formatter, Not Handler

**What:** `formatContext()` and `formatTraceFlow()` accept metadata and append `formatTokenSavings()` internally. The handler does not compute or inject the savings string.

**When to use:** Formatters for tools that report token metadata (`build_context`, `explain_codebase`, `trace_flow`).

**Trade-offs:** Formatter needs metadata passed in. Handler stays clean — pass the whole result object, formatter extracts what it needs.

```typescript
export function formatContext(result: ContextResult, opts: { toolName: string }): string {
  const savings = formatTokenSavings({
    tokensSent: result.metadata.tokensSent,
    estimatedWithout: result.metadata.estimatedWithoutBraincache,
    reductionPct: result.metadata.reductionPct,
    filesInContext: result.metadata.filesInContext,
  });
  return `brain-cache / ${opts.toolName}\n\n${result.content}\n\n---\n${savings}`;
}
```

---

## New vs Modified Components

### New or Modified

| Component | Change | Risk |
|-----------|--------|------|
| `src/lib/format.ts` | Add `formatSearchResults`, `formatContext`, `formatTraceFlow`, `formatDoctorOutput`, `formatIndexResult`. Keep existing `formatTokenSavings` unchanged. | LOW — pure functions, fully testable |
| `src/mcp/index.ts` | Replace `JSON.stringify(result)` and ad-hoc template literals with `format*(result)` calls in 6 tool handlers. Add import. | LOW — mechanical substitution; no workflow changes |

### Unchanged

Everything else: workflows, services, lib/types.ts, lib/config.ts, cli/, tests/ (except new formatter tests).

---

## Build Order

Two phases. Each is independently deliverable.

**Phase 1 — Formatter Functions** (no behavior change, all in lib/)
1. Extend `src/lib/format.ts` — add `formatSearchResults`, `formatContext`, `formatTraceFlow`, `formatDoctorOutput`, `formatIndexResult`
2. Write `tests/lib/format.test.ts` — unit test each formatter with representative inputs

**Phase 2 — Wire MCP Handlers**
3. Modify `src/mcp/index.ts` — replace inline serialization with `format*()` calls in all 6 handlers
4. Update `tests/mcp/server.test.ts` — adjust assertions from JSON string matching to formatted string matching

Phase 1 can be reviewed, tested, and merged independently. Phase 2 is mechanical wiring — low risk because all complex logic is in Phase 1.

**Dependency note:** Phase 2 has a hard dependency on Phase 1 being complete. Within Phase 1, the 5 new formatter functions are independent of each other and can be written in any order.

---

## Anti-Patterns

### Anti-Pattern 1: Formatting Logic in Workflow Return Values

**What people do:** Have `runSearch()` return `{ chunks, formattedText }` so the MCP handler just passes through `formattedText`.

**Why it's wrong:** Workflows are shared between CLI and MCP. CLI output uses ANSI colours and terminal-width wrapping. MCP output uses plain markdown. A workflow that returns pre-formatted text cannot serve both callers correctly.

**Do this instead:** Workflow returns `RetrievedChunk[]`. CLI formats for terminal. MCP handler calls `formatSearchResults()` from `lib/format.ts`.

### Anti-Pattern 2: One Monolithic Formatter Function

**What people do:** `formatMcpResponse(toolName: string, result: unknown): string` with a switch on `toolName`.

**Why it's wrong:** Loses type safety entirely. `result: unknown` forces type casting inside. Difficult to test each tool's output independently. The switch will accumulate unrelated logic as tools change.

**Do this instead:** One named function per tool. `formatSearchResults(chunks, query)` is fully typed. `formatTraceFlow(result, entrypoint)` is fully typed. Each is tested independently.

### Anti-Pattern 3: Formatter as a Service with State or Dependencies

**What people do:** Create `src/services/formatter.ts` that imports from services or uses config.

**Why it's wrong:** `services/` components should not have presentation concerns. Presentation is a lib-layer concern. A formatter that depends on `configLoader` or `logger` becomes hard to test and violates the service boundary.

**Do this instead:** `src/lib/format.ts` — pure functions, no imports from services or workflows.

### Anti-Pattern 4: Changing Workflow Return Types for Presentation

**What people do:** Add a `formattedText?: string` field to `ContextResult` or `TraceFlowResult`.

**Why it's wrong:** Contaminates data types with presentation concerns. The types are used by CLI, tests, and workflow-to-workflow calls — all of which should not see formatting fields.

**Do this instead:** `ContextResult` stays as-is. `formatContext(result)` reads from it in `mcp/index.ts`.

---

## Integration Points

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|-------------|-------|
| `mcp/index.ts` → `lib/format.ts` | Direct import of pure functions | Formatter has no deps beyond `lib/types.ts` |
| `lib/format.ts` → `lib/types.ts` | Type imports only | `RetrievedChunk`, `ContextResult`, `TraceFlowResult` already exist |
| `lib/format.ts` → `lib/format.ts` | `formatContext()` calls `formatTokenSavings()` internally | Internal composition — acceptable within same file |
| Workflows → `lib/format.ts` | None — workflows do not import formatters | This boundary must not exist |

### What Does Not Change

- Workflow return types (`ContextResult`, `TraceFlowResult`, `RetrievedChunk[]`) — unchanged
- Service layer — entirely unaffected
- CLI formatting — separate concern; this milestone does not touch cli/
- Test fixtures for workflows — unchanged; formatter tests are new, separate files

---

## Sources

- Direct codebase inspection: `/workspace/src/mcp/index.ts` (all 6 tool handlers, current output patterns)
- Direct codebase inspection: `/workspace/src/lib/format.ts` (existing `formatTokenSavings`)
- Direct codebase inspection: `/workspace/src/lib/types.ts` (`ContextResult`, `TraceFlowResult`, `RetrievedChunk`)
- Direct codebase inspection: `/workspace/src/workflows/search.ts`, `traceFlow.ts`, `buildContext.ts`, `explainCodebase.ts` (workflow return types confirmed)
- v2.0 ARCHITECTURE.md (previous milestone research — foundational patterns preserved)

---
*Architecture research for: brain-cache v2.1 Presentation Magic — unified formatting layer integration with existing workflows-first architecture*
*Researched: 2026-04-03*
