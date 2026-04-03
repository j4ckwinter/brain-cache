# Stack Research

**Domain:** MCP Tool Output Presentation Layer (brain-cache v2.1 Presentation Magic)
**Researched:** 2026-04-03
**Confidence:** HIGH

---

## Scope

This document covers only stack additions and changes needed for v2.1. It does not re-research the validated base stack (Node.js 22, TypeScript, Commander, Ollama, LanceDB, MCP SDK, pino, zod v4, tree-sitter, chokidar). Those are locked.

**Current state of MCP tool output:** All 6 tools return raw `JSON.stringify()` strings wrapped in `{ type: "text", text: "..." }` MCP content blocks. There is one existing formatting utility (`src/lib/format.ts` → `formatTokenSavings`) using manual string padding. There is no shared presentation abstraction.

**Goal:** Unified, markdown-formatted, scannable output from all 6 tools. Consistent structure, tool-specific identity, cohesion with Claude's response style.

---

## Key Architectural Constraint

MCP tool responses travel over stdio as JSON-RPC. The `text` field is a plain string — no special rendering occurs between the MCP server and Claude. Claude receives the text content and renders it inline in its response.

**This means:**
- Markdown in the `text` field is rendered by Claude natively — headings, code fences, bold, lists all work
- ANSI color codes are NOT appropriate — they appear as raw escape sequences in Claude's context
- The output format should be markdown designed for LLM consumption, not terminal display
- Token efficiency matters — every byte in the response is context Claude must process

---

## Recommended Stack Additions

### Core Technologies

No new framework-level dependencies are needed. The presentation layer is a pure string-construction module.

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `dedent` | 1.7.2 | Strip indentation from template literal strings | The single most useful utility for building multi-line markdown strings in TypeScript without fighting indentation. Tagged template literal API (`dedent\`...\``) — works seamlessly with ESM. 28KB unpacked, zero dependencies, dual ESM/CJS exports with TypeScript declarations. Updated March 2026. |

### Supporting Libraries

No additional supporting libraries are needed beyond `dedent`. The full presentation layer can be built as:

1. A shared `src/lib/presenter.ts` module with tool-specific formatter functions
2. An extended `src/lib/format.ts` with markdown helper primitives (sections, code fences, tables, lists)
3. Zero new npm dependencies beyond `dedent`

The existing `pino` logger is stdout-safe (already writes to stderr only) — no changes needed there.

### Development Tools

No changes to dev tooling. Existing `vitest` + `tsx` covers testing and dev execution of the new presenter module.

---

## Installation

```bash
# Single new runtime dependency
npm install dedent
```

---

## Integration Points with Existing MCP Tool Handlers

All 6 tools live in `src/mcp/index.ts`. The integration pattern is:

```typescript
// Before (current pattern in all 6 tools):
return {
  content: [{ type: "text" as const, text: JSON.stringify(result) }],
};

// After (presentation layer pattern):
import { presentSearchResults } from "../lib/presenter.js";

return {
  content: [{ type: "text" as const, text: presentSearchResults(chunks) }],
};
```

Each tool gets a dedicated `present*` function in `src/lib/presenter.ts`. The `src/lib/format.ts` module houses reusable markdown primitives (section headers, code blocks, tables, horizontal rules) that the `present*` functions compose.

**Tool-specific presenter functions:**

| Tool | Function | Output Identity |
|------|----------|-----------------|
| `search_codebase` | `presentSearchResults(chunks)` | Ranked result list with file paths, scores, and code snippets |
| `build_context` | `presentContext(result)` | Evidence blocks grouped by file, with token savings footer |
| `trace_flow` | `presentFlowTrace(hops)` | Numbered hop chain showing cross-file call propagation |
| `explain_codebase` | `presentArchitectureOverview(overview)` | Module-grouped summary with component boundaries |
| `index_repo` | `presentIndexResult(state)` | One-line status with file/chunk counts |
| `doctor` | `presentHealth(health)` | Structured health check with status indicators |

---

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Template strings | `dedent` | `ts-dedent` v2.2.0 | `ts-dedent` was last published 5 years ago and has no active maintenance. `dedent` is actively maintained (March 2026 release), same API. |
| Template strings | `dedent` | No library (manual `trim()` + string concat) | Manual indentation management in multi-line template literals is fragile and produces ugly source code. A tagged template literal approach is idiomatic TypeScript. |
| Markdown construction | Custom format utilities | `marked` / `markdown-it` | Those are markdown *parsers* (text → HTML). We need markdown *generation* (data → markdown string). No parser is needed — we construct strings directly. |
| Output format | Markdown strings | JSON with `structuredContent` | MCP 2025-06-18 spec introduces `structuredContent` for validated JSON output, but backwards compatibility requires also sending text. For Claude consumption, markdown text in the `content` field is correct and sufficient for all 6 tools. |
| Color utilities | (none) | `picocolors` / `kleur` | ANSI color codes appear as raw escape sequences in Claude's text context — they are not stripped. Colors are appropriate for CLI output (`brain-cache doctor` terminal display) but NOT for MCP tool responses. The CLI already uses pino-pretty for coloring log output. |
| Template engine | (none) | Handlebars / Mustache / Nunjucks | Heavy template engines add runtime overhead, a learning curve, and file-based template management. The presentation layer is 6 functions producing structured markdown — pure TypeScript string construction is simpler, type-safe, and testable without a template engine. |

---

## What NOT to Add

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `picocolors`, `chalk`, `kleur`, any ANSI color library | ANSI escape codes appear as literal `\x1b[32m` characters in Claude's tool response text — they are not rendered as colors. Actively degrades output quality. | Plain markdown formatting only in MCP responses |
| `marked`, `markdown-it`, `remark` | These parse markdown into HTML/AST — the opposite of what is needed. We generate markdown strings, not parse them. | Direct string construction with `dedent` |
| Handlebars, Mustache, EJS, Nunjucks | Template engines add file-system dependencies, partials, helpers, and cache layers. The presentation layer is 6 functions; TypeScript is the template engine. | TypeScript template literals + `dedent` |
| `ink`, `blessed`, `terminal-kit` | React-based or ncurses-style terminal UI frameworks. Completely inappropriate for MCP stdio responses — would produce raw terminal control sequences in Claude's context. | Plain markdown text |
| `cli-table3` or `table` | ASCII table renderers use box-drawing characters that consume tokens wastefully and do not render as tables in Claude's context. Claude understands standard markdown `|col|col|` pipe tables natively. | Markdown pipe tables via string construction |
| `react-markdown`, `@mdx-js/mdx` | JSX-based markdown rendering. Requires React runtime, irrelevant for a Node.js CLI tool producing string output. | Plain string construction |

---

## Stack Patterns by Variant

**For MCP tool responses (consumed by Claude):**
- Use markdown headings (`##`, `###`), code fences (` ```typescript `), pipe tables, and bold for structure
- Use `dedent` for all multi-line template literals to keep source code indentation clean
- No ANSI codes, no box-drawing characters

**For CLI terminal output (consumed by humans in a terminal):**
- Existing pino + pino-pretty handles log output with colors already
- For structured CLI output (e.g., `brain-cache doctor` status), use Unicode symbols (✓, ✗, ⚠) directly — these render correctly in modern terminals and are readable in plain text
- No additional color library needed — the CLI surface area is small

**For error messages in both contexts:**
- Plain text error messages work in both MCP and CLI contexts
- Prefix with a consistent pattern: `brain-cache: <message>` for CLI, structured error section in markdown for MCP

---

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| `dedent` 1.7.2 | Node.js >= 14, ESM and CJS | Dual exports (`import` → `.mjs`, `require` → `.js`). Compatible with `"type": "module"` in project's `package.json`. TypeScript declarations included. |
| `dedent` 1.7.2 | TypeScript 5.x | `.d.mts` declarations for ESM TypeScript consumers. No `@types/dedent` needed. |

---

## Sources

- [MCP Tools spec (2025-06-18)](https://modelcontextprotocol.io/specification/2025-06-18/server/tools) — Confirmed `content[].type: "text"` is the correct unstructured tool response format; `structuredContent` is a new optional field for validated JSON but requires backwards-compatible text mirror — HIGH confidence
- [dedent npm](https://www.npmjs.com/package/dedent) — v1.7.2, dual ESM/CJS exports confirmed via `npm info dedent --json`, updated March 2026 — HIGH confidence
- [ts-dedent npm](https://www.npmjs.com/package/ts-dedent) — v2.2.0, last published 5 years ago — verified stale, not recommended
- [picocolors GitHub](https://github.com/alexeyraspopov/picocolors) — v1.1.1, 7KB, no deps — confirmed appropriate for terminal CLI output only, not MCP responses
- [Webex Developers: LLM-Friendly Content in Markdown](https://developer.webex.com/blog/boosting-ai-performance-the-power-of-llm-friendly-content-in-markdown) — confirms markdown is natively parsed by Claude; headings and structure improve LLM comprehension — MEDIUM confidence
- `/workspace/src/mcp/index.ts` — Direct inspection of current tool response pattern (`JSON.stringify()` in all 6 tools)
- `/workspace/src/lib/format.ts` — Direct inspection of existing formatting utility (manual padding, no markdown)

---

## Complete New Additions Summary

| Package | Action | Version | Reason |
|---------|--------|---------|--------|
| `dedent` | **Add** | 1.7.2 | Tagged template literal dedenting for multi-line markdown string construction. Only new npm dependency. |

**Total new npm dependencies for v2.1: 1 (`dedent`).**

The presentation layer is primarily a new module (`src/lib/presenter.ts`) and extensions to the existing `src/lib/format.ts` — not a dependency acquisition exercise.

---
*Stack research for: brain-cache v2.1 Presentation Magic milestone*
*Researched: 2026-04-03*
