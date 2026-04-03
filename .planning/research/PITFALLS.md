# Pitfalls Research

**Domain:** Unified Presentation Layer for MCP Tools (brain-cache v2.1)
**Researched:** 2026-04-03
**Confidence:** HIGH (primary pitfalls confirmed via Anthropic engineering docs, MCP specification, GitHub issues, and official guidance; secondary pitfalls from multiple independent sources)

---

## Critical Pitfalls

### Pitfall 1: Formatting Codes Are Tokens — ANSI and Unicode Decoration Wastes Context Budget

**What goes wrong:**
ANSI escape sequences (`\x1b[38;2;255;136;0m`, `\x1b[0m`, etc.) and Unicode box-drawing characters are tokenized character-by-character as regular text. A real-world case (GitHub issue #15718 in the Claude Code repo) showed a tool result where actual content was ~6k tokens but ANSI decoration added another ~7k tokens — 50–80% of the total context consumed by visual chrome that provides zero semantic value to the LLM. For brain-cache, which runs 6 tools in multi-step workflows, this compounds: 7 chained tool calls with 2x token inflation could easily consume 50k+ tokens on decoration alone.

**Why it happens:**
Developers design the presentation layer for human readability in a terminal. A colorized, box-bordered output looks polished in screenshots and demos. The mistake is treating the terminal display as the primary consumer. The actual primary consumer is Claude, which sees every escape sequence as opaque token noise.

**How to avoid:**
- Never include ANSI escape sequences in MCP tool `text` content. The MCP server sends over stdio and Claude receives the raw bytes.
- Use markdown formatting (`**bold**`, `##` headers, `` `code` ``) instead of ANSI color codes. Claude is trained on markdown and processes it semantically, not as decoration.
- If you want a polished terminal experience for CLI commands, keep the ANSI formatting in the CLI rendering layer only — not in the MCP tool handler.
- The MCP specification's `structuredContent` field (introduced in the 2025-06-18 spec) can carry display-only content separately from LLM context content, but this separation is not yet reliably implemented in all clients. Do not depend on it in v2.1.
- Run a token count before and after any formatting change. `@anthropic-ai/tokenizer` is already in the stack.

**Warning signs:**
- Tool output contains `\x1b[` in the text content
- Token count for a tool result is more than 1.3x the semantic content estimate
- Claude responses reference "formatting codes" or treat escape sequences as literal text

**Phase to address:**
Formatting foundation phase. Establish a no-ANSI rule in the shared presenter and enforce it with a lint check or test assertion before any tool-specific formatting is added.

---

### Pitfall 2: Changing Existing Tool Output Shapes Breaks Claude's Learned Routing Behavior

**What goes wrong:**
Claude Code sessions build up implicit knowledge of tool outputs through conversation history. If `search_codebase` currently returns raw JSON (`[{"filePath": "...", "score": 0.8, ...}]`) and v2.1 wraps it in a prose header followed by a structured section, Claude's pattern-matching for downstream references to search results will fail. Field names embedded in prose summaries are harder to extract than field names in JSON. More critically, if the existing tests or CLAUDE.md routing guidance reference specific output fields by name, those references break silently — the tool still returns `isError: false` but the content contract has changed.

**Why it happens:**
Presentation changes feel cosmetic. "I'm just adding a header" seems safe. But for an LLM consumer, structure IS the contract. Switching from `JSON.stringify(chunks)` to a formatted string means Claude can no longer programmatically access `result.chunks[0].filePath` — it must now parse prose to extract that value, which introduces fragility.

**Why it happens (specifically in brain-cache):**
Looking at the current MCP handlers: `search_codebase` returns `JSON.stringify(chunks)`, `doctor` returns `JSON.stringify(health)`, `trace_flow` returns `JSON.stringify(result)`. These are parseable structures. `build_context` returns `JSON.stringify({...result, tokenSavings: formatTokenSavings(...)})` — already mixed (structured data plus formatted string appended). `explain_codebase` is already formatted prose (`# Codebase Architecture Overview\n\n${result.content}\n\n---\n${tokenSavings}`). The inconsistency is already there; unifying without breaking means auditing what each consumer actually does with the output.

**How to avoid:**
- Audit what Claude actually does with each tool's output before changing its shape. For `search_codebase`, Claude uses `filePath` to decide which files to read — if that becomes a prose description of a file path rather than a JSON key, file reads will fail.
- Preserve all existing JSON-parseable fields. Adding a formatted header on top of the JSON is safer than replacing JSON with formatted text.
- Never rename fields in tool output. `filePath` → `file_path` is a breaking change.
- Update CLAUDE.md routing guidance in the same commit that changes the output format, so they stay in sync.
- Add a snapshot test for each tool's output shape and run it against the actual workflow before shipping.

**Warning signs:**
- Claude fails to extract a file path from a search result after the formatting change
- Claude Code tries to `JSON.parse` the text content of a formatted result
- Claude response says "I couldn't determine which file to read" when the file was in the search results

**Phase to address:**
First phase of the milestone — define the output contract for each tool explicitly before writing any formatter, so the contract can be preserved throughout.

---

### Pitfall 3: Over-Formatting for the Wrong Audience — Visual Chrome That Confuses Rather Than Helps LLM Reasoning

**What goes wrong:**
Presentation layers designed to make outputs "readable" for humans often introduce structural noise that interferes with LLM reasoning. Common examples: decorative ASCII separators (`---`, `===`, `***`), repeated section labels that don't carry new information (`### Results`, `### Summary`, `### Details` as boilerplate), excessive nesting (headers inside headers inside boxes), and padded column alignment using spaces (`label:                    value`). The Anthropic engineering guide explicitly warns: tools should "return only high signal information" and avoid "formatting noise that confuses agents."

**Why it happens:**
The developer runs the tool in a terminal, sees the output, and applies human visual design intuitions — "I need to visually separate these sections." An LLM doesn't scan visually; it processes tokens sequentially. Visual structure from whitespace and lines consumes tokens without providing semantic signal.

**How to avoid:**
- Test every formatted output by reading it as a sequence of tokens, not a visual layout. Ask: does this token sequence help Claude locate the answer faster, or does it just look nice?
- Use semantic structure: a `## Hops (3 total)` header signals semantic content. A `--- --- ---` separator between hops signals nothing; delete it.
- Column-aligned text using `padEnd()` (as `formatTokenSavings` currently does) looks good in a monospace terminal but becomes meaningless token padding in LLM context. Replace with `label: value` on separate lines or a clean prose summary.
- Reserve markdown formatting for semantic distinctions: code blocks for code snippets, bold for the most important item in a section, headers for genuine section boundaries. Do not use formatting purely for visual spacing.
- The rule: if removing a formatting element doesn't lose any information, remove it.

**Warning signs:**
- Token count increases by more than 15% after adding a "presentation" header to existing JSON output
- The formatted output has more decoration lines than data lines
- Claude's response uses phrases like "according to the formatted output above" rather than directly referencing the content — signal that it's treating the format as opaque

**Phase to address:**
Foundation phase — establish the formatting principles document before any tool-specific formatter is written. Define what counts as "semantic structure" vs. "visual chrome" and apply consistently.

---

### Pitfall 4: Rigid Templates That Produce Redundant or Misleading Output for Variable-Length Results

**What goes wrong:**
A templated section like `## Top Results (10 results)` works when there are 10 results. When the query returns 1 result, it becomes `## Top Results (1 results)` — not broken, but awkward. When it returns 0 results, `## Top Results (0 results)\n\n_No results found._` forces Claude to process a section header, a count, and a prose disclaimer for what should be a single signal: no match. More dangerously, rigid templates applied to `trace_flow` output when the trace finds no hops will emit a full structured frame with empty sections, which Claude may interpret as a partial result rather than a clean negative signal.

**Why it happens:**
Templates are written for the happy path. The common case (10 results, 5 hops) shapes the template. Edge cases (0, 1, partial) are handled as afterthoughts by inserting `_No results found._` inside an otherwise structured section.

**How to avoid:**
- For zero-result cases, return a single clear statement without section scaffolding: `No matching symbols found for "${query}" in the indexed codebase.` Do not wrap it in a section header.
- For single-result cases, suppress count suffixes and plural/singular handling — just render the result.
- Build edge-case rendering paths into the presenter alongside the normal path, not as fallbacks inside template strings.
- Test every template against input sets of 0, 1, N, and N+1 (above any hard limit) before shipping.

**Warning signs:**
- Templates contain `${count} result${count !== 1 ? 's' : ''}` inline string logic — signals the template wasn't designed for edge cases
- Zero-result output has more tokens than a single-result output
- Claude responds with uncertainty ("it seems there may be results...") when the result was actually empty

**Phase to address:**
Each tool-specific formatter phase. Define the zero/one/many rendering contract for each tool before writing the formatter logic.

---

### Pitfall 5: The Presentation Layer Becomes a Second Source of Truth — Diverging From Workflow Return Types

**What goes wrong:**
The workflows return typed TypeScript interfaces: `TraceFlowResult` has `hops[]` and `metadata`. `ContextResult` has `content`, `chunks`, and `metadata`. If a presentation layer transforms these into prose descriptions without preserving the structured data, the text becomes the only form of the data. When a bug report says "the hop depth is wrong," there's no machine-readable form to diff — only formatted text. Worse, if the formatter is updated independently of the workflow types, it will silently skip new fields added to the return type that weren't in the original template.

**Why it happens:**
Presenters are often written once and not maintained in sync with the types they format. TypeScript's type system doesn't enforce that a formatter handles every field of a union or interface.

**How to avoid:**
- The formatter for each tool must accept the exact TypeScript return type of the workflow (`TraceFlowResult`, `ContextResult`, etc.) as its input, not a loosened `any` or a destructured subset. TypeScript will then surface missing fields when the return type evolves.
- Write formatter unit tests that instantiate the full return type and assert the output contains every top-level field's value. When a new field is added to the return type, the test will fail, forcing the formatter to be updated.
- Do not convert structured metadata to prose summaries. `metadata.totalHops: 4` should appear as a parseable value, not buried in "The trace followed 4 hops across the codebase."

**Warning signs:**
- Formatter functions accept `any` or `Record<string, unknown>` instead of the typed workflow result
- Adding a new field to `TraceFlowResult` requires no formatter change (it should)
- Post-migration, Claude cannot tell you the `seedChunkId` from a trace result because it was formatted away

**Phase to address:**
Foundation phase — define the formatter interface before implementation. Each formatter must be typed to its workflow output type.

---

### Pitfall 6: Token Savings Metadata Displayed Redundantly Across Every Tool Call Wastes Context

**What goes wrong:**
`build_context` and `explain_codebase` already append a token savings block to every response. If the unified presentation layer adds this block to all 6 tools, every tool call in a multi-step workflow adds the same accounting footer. In a 7-call workflow, that's 7 instances of `Tokens sent to Claude: X\nEstimated without: ~Y (Z files + overhead)\nReduction: N%`. The `formatTokenSavings` function currently uses `padEnd(27)` column alignment — padding that consumes tokens without adding information. At 6 tools × average 40 tokens per savings block = 240 tokens per workflow just on accounting metadata.

**Why it happens:**
The token savings block is a core value signal of brain-cache — "look how much context we saved." It gets added to every tool that does retrieval, because every retrieval is a savings opportunity. The mistake is confusing "available to compute" with "useful to report on every call."

**How to avoid:**
- Only include token savings metadata in tools where it's meaningful and non-obvious: `build_context` and `explain_codebase`. Tools like `index_repo` and `doctor` have no retrieval savings to report.
- `search_codebase` returns raw chunks; the "savings" framing is misleading (the user asked for results, not context reduction). Do not add savings metadata to it.
- `trace_flow` has `metadata.localTasksPerformed` already — this is the appropriate place for local computation reporting. Do not duplicate it with a token savings block.
- Replace `padEnd(27)` column alignment with plain `label: value` pairs. The alignment is a terminal formatting artifact that wastes tokens in LLM context.
- If savings metadata is included, it must be at the end of the response and clearly labeled as metadata so Claude can deprioritize it when extracting the primary result.

**Warning signs:**
- Savings footer appears in `doctor` output (no retrieval happened)
- Token count for `index_repo` success response increases after the presentation layer ships
- Claude includes token savings numbers in its reasoning about code structure

**Phase to address:**
Foundation phase — decide the token savings policy (which tools, what format, where in the response) before any per-tool formatter is written.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Apply the same template to all tools regardless of output type | Single code path, fast to build | Trace output looks like search output looks like doctor output — no tool identity, harder for Claude to parse | Never — tool identity is the goal |
| Use `padEnd()` for column alignment in formatted strings | Pretty terminal output | Adds silent token waste proportional to the label length; content collapses in non-monospace contexts | Never in MCP output — CLI renderers only |
| Add ANSI colors to MCP tool text content | Colorized output in Claude Code terminal | Up to 80% token inflation on decoration; breaks in non-terminal clients; security surface (Trail of Bits) | Never — use markdown instead |
| Format the raw workflow result directly in the MCP handler | Keeps `mcp/index.ts` self-contained | No type-safe boundary between presenter and workflow; formatter not testable in isolation | Never — presenters belong in `src/lib/` |
| Skip edge case testing (0 results, empty trace) | Faster initial implementation | Edge case templates emit noisy structured frames for empty data; Claude misreads as partial results | Never |
| Export both formatted text and structured JSON in every tool response | Maximum flexibility | Doubles token count on every call; structured JSON already in the workflow result | Only if `structuredContent` field is reliably supported by the Claude Code client (currently not confirmed) |
| Maintain formatting logic inline in each tool handler | No abstraction needed | Each tool diverges; a change to the shared header requires editing 6 files | Never — defeats the entire purpose of a unified presentation layer |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| MCP stdio transport | Include ANSI escape codes in `content[].text` | ANSI sequences are tokenized as raw bytes; use markdown formatting only |
| `formatTokenSavings` (existing) | Reuse as-is in the new unified presenter | The current `padEnd(27)` column alignment wastes tokens; redesign as plain `label: value` pairs before importing into the presenter |
| TypeScript formatter typing | Accept `any` to handle all tool result shapes | Accept the specific workflow return type interface per formatter; TypeScript's exhaustiveness catches schema drift |
| MCP `structuredContent` field | Use to separate display output from LLM context | Claude Code client support for `structuredContent` is not yet confirmed stable; do not depend on it as the primary separation mechanism in v2.1 |
| Zod v4 validation of tool inputs | Presenter is on the output side, not input side | Zod is not relevant to the presenter; do not add schema validation to the output formatting path — it's unnecessary overhead |
| `src/mcp/index.ts` (tool handlers) | Add formatting logic directly in the handler | Formatting logic belongs in `src/lib/presenter.ts` (or equivalent); handlers call the presenter, not the other way around |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Template rendering on the hot path for every tool call | Latency added to every `search_codebase` invocation | Formatting should be string concatenation only, no async operations, no I/O, no computation | Any time string interpolation is replaced with async work |
| Token counting the formatted output on every call (to verify savings) | `@anthropic-ai/tokenizer` adds ~20ms per call | Token counting is already done in the workflow layer; do not add a second count in the presenter | Immediately — every call adds tokenizer overhead |
| Building the formatted output with repeated string concatenation inside loops | Memory allocations proportional to result count | Use array join pattern (`lines.push(...); return lines.join('\n')`) | Any `trace_flow` result with 10+ hops |
| Re-formatting the same output multiple times (e.g., once for logging, once for the MCP response) | CPU overhead, inconsistent output in logs vs. MCP | Format once, store in a variable, reuse | Any tool that logs its output |

---

## "Looks Done But Isn't" Checklist

- [ ] **No ANSI in MCP content:** Grep the presenter and all tool handlers for `\x1b[` — zero matches required before shipping.
- [ ] **Token count baseline established:** Run each of the 6 tools against a representative query, record the token count of the raw output, record the token count of the formatted output. Formatted output must be within 20% of raw output token count or justify the increase with semantic value.
- [ ] **Existing JSON fields preserved:** For `search_codebase` and `trace_flow` (currently returning `JSON.stringify`), verify that all top-level fields (`filePath`, `score`, `content`, `hops`, `metadata`) are accessible in the new formatted output — either as JSON or as clearly labeled values Claude can parse.
- [ ] **Zero-result rendering tested:** Call each tool with a query guaranteed to return empty results. Verify the output is a clean single-line statement, not a structured frame with empty sections.
- [ ] **Formatter typed to workflow return type:** Each formatter function must accept the exact TypeScript interface of its tool's workflow return value — no `any`, no `object`.
- [ ] **Token savings only where meaningful:** Verify savings metadata appears in `build_context` and `explain_codebase` only. Check `doctor`, `index_repo`, `search_codebase`, and `trace_flow` — no savings footer.
- [ ] **Presenter is isolated and testable:** Import the presenter in a unit test with a mock workflow result. Format it. Assert the output. No MCP SDK dependency required to test the formatter.
- [ ] **CLAUDE.md routing guidance updated:** After output formats change, verify the CLAUDE.md tool routing table and tool descriptions remain accurate. Stale descriptions cause routing regressions.

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| ANSI codes shipped in MCP text content | LOW | Grep for `\x1b[` in output layer; strip all ANSI; no workflow changes needed |
| Existing JSON contract broken (field removed or renamed) | HIGH | Roll back formatter change; audit what Claude's downstream behavior depends on; rebuild formatter preserving fields |
| Token count inflated 2x by decoration | LOW–MEDIUM | Profile which formatting elements add the most tokens (headers, separators, metadata footers); strip decorative elements first; measure again |
| Formatter diverged from workflow type after type change | LOW | Add TypeScript strict check; formatter will fail to compile; fix the formatter to handle new fields |
| Token savings metadata appearing on every tool call | LOW | Move savings block to opt-in or restrict to build_context and explain_codebase; one config change |
| Rigid template produces confusing output for empty results | LOW | Add zero-result branch to each formatter; returns a clean fallback string instead of the structured template |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| ANSI codes waste 50–80% of tokens | Formatting foundation (Phase 1) | Grep for `\x1b[` in all presenter output; token count delta < 20% |
| Output shape change breaks existing contract | Contract audit (Phase 1) | Snapshot test: existing tool outputs before and after the presentation layer; field names unchanged |
| Visual chrome confuses LLM reasoning | Formatting principles definition (Phase 1) | Manual: ask Claude to extract a specific field from each tool's output; measure success rate |
| Rigid templates fail at 0 or 1 results | Per-tool formatter phases | Edge case tests: 0 results, 1 result, N results for every tool formatter |
| Formatter diverges from workflow types | Foundation / type-safe presenter interface | TypeScript compile: formatter typed to workflow return type; adding new field to type causes build failure |
| Token savings metadata redundancy | Foundation — savings policy decision | Count tokens in a 6-tool workflow; savings metadata tokens < 5% of total |

---

## Phase-Specific Warnings

| Phase / Topic | Likely Pitfall | Mitigation |
|---------------|----------------|------------|
| Presentation foundation / shared presenter | Using `padEnd()` or ANSI from existing `formatTokenSavings` | Redesign the savings format to plain `label: value` before including it in the shared presenter |
| `search_codebase` formatter | Replacing JSON output with prose breaks Claude's file path extraction | Preserve all JSON fields; add a formatted header only; keep the structured data accessible |
| `trace_flow` formatter | Hop list rendered as prose loses structural hop ordering | Render hops as an ordered list with consistent field labels; never convert hop data to a prose summary |
| `explain_codebase` formatter | Already partially formatted (prose + `---` footer); unifying may over-format | Audit existing format first; the goal is consistency, not more structure — may require simplification, not addition |
| `doctor` formatter | Temptation to add status icons (`✓`, `✗`) using Unicode | Unicode symbols are fine; ANSI color codes around them are not — `[ok]` not `\x1b[32m[ok]\x1b[0m` |
| `build_context` formatter | Token savings footer already using padded alignment | Replace `padEnd` formatting with plain key-value before the unified presenter ships; measure token delta |
| All tools | Adding section scaffolding to zero-result responses | Zero-result output must be a single sentence, not a structured empty frame |

---

## Sources

- Anthropic Engineering — Writing Effective Tools for AI Agents (https://www.anthropic.com/engineering/writing-tools-for-agents) — "return only high signal information back to agents"; "avoid formatting noise that confuses agents"
- Anthropic Engineering — Effective Context Engineering for AI Agents (https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) — progressive disclosure, tool result clearing, information density principles
- GitHub (claude-code#15718) — MCP Tools: Support display/context separation to save 50-80% tokens on formatted output (https://github.com/anthropics/claude-code/issues/15718) — real-world ANSI token waste measurement (6k content + 7k ANSI = 13k total)
- Trail of Bits — Deceiving users with ANSI terminal codes in MCP (https://blog.trailofbits.com/2025/04/29/deceiving-users-with-ansi-terminal-codes-in-mcp/) — ANSI in MCP output confirmed security surface and tokenization problem
- MCP Specification 2025-06-18 — Tools (https://modelcontextprotocol.io/specification/2025-06-18/server/tools) — `structuredContent` field for separating display from LLM context; backward compatibility requirement
- DEV Community / AWS Heroes — MCP Tool Design: Why Your AI Agent Is Failing (https://dev.to/aws-heroes/mcp-tool-design-why-your-ai-agent-is-failing-and-how-to-fix-it-40fc) — schema contract problems, description quality impact on routing accuracy
- Nordic APIs — The Weak Point in MCP Nobody's Talking About: API Versioning (https://nordicapis.com/the-weak-point-in-mcp-nobodys-talking-about-api-versioning/) — output contract breaking when formatting changes
- Medium / Joe Njenga — Claude Code cuts MCP context bloat by 46.9% with Tool Search (https://medium.com/@joe.njenga/claude-code-just-cut-mcp-context-bloat-by-46-9-51k-tokens-down-to-8-5k-with-new-tool-search-ddf9e905f734) — tool definition token overhead context

---
*Pitfalls research for: brain-cache v2.1 Presentation Magic milestone*
*Researched: 2026-04-03*
