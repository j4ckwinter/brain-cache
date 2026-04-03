export const CLAUDE_MD_SECTION = `
## Brain-Cache MCP Tools

Use brain-cache tools before reading files or using Grep/Glob for codebase questions.

| Query type | Tool | NOT this |
|-----------|------|---------|
| Locate a function, type, or symbol | \`search_codebase\` | \`build_context\` |
| Understand how specific code works across files | \`build_context\` | file reads |
| Trace a call path across files | \`trace_flow\` | \`build_context\` |
| Explain project architecture or structure | \`explain_codebase\` | \`build_context\` |
| Diagnose brain-cache failures | \`doctor\` | -- |
| Reindex the project | \`index_repo\` | -- |

### search_codebase (locate code)

Call \`mcp__brain-cache__search_codebase\` to find functions, types, definitions, or implementations by meaning rather than keyword match.

### build_context (understand specific behavior)

Call \`mcp__brain-cache__build_context\` with a focused question about how specific code works. It retrieves semantically relevant code, deduplicates results, and fits them to a token budget.

Use for: "How does X work?", "What does this function do?", debugging unfamiliar code paths.

Do NOT use for architecture overviews (use explain_codebase) or call-path tracing (use trace_flow).

### trace_flow (trace call paths)

Call \`mcp__brain-cache__trace_flow\` to trace how a function call propagates through the codebase. Returns structured hops showing the call chain across files.

Use for: "How does X flow to Y?", "Trace how X calls Y across files", "What happens when X is called?", "Call path from X to Y".

Use trace_flow instead of build_context when the question is about call propagation or execution flow across files.

### explain_codebase (architecture overview)

Call \`mcp__brain-cache__explain_codebase\` to get a module-grouped architecture overview. No follow-up question needed.

Use for: "Explain the project architecture", "How is this project structured?", "What does this project do?", "Give me an overview of the codebase".

Use explain_codebase instead of build_context when the question is about overall structure or getting oriented.

### doctor (diagnose issues)

Call \`mcp__brain-cache__doctor\` when any brain-cache tool fails or returns unexpected results.

### index_repo (reindex)

Call \`mcp__brain-cache__index_repo\` only when the user explicitly asks to reindex, or after major code changes. Do not call proactively.
`;
