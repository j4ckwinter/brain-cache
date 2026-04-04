export const CLAUDE_MD_SECTION = `
## Brain-Cache MCP Tools

Use brain-cache tools before reading files or using Grep/Glob for codebase questions.

| Query type | Tool | NOT this |
|-----------|------|---------|
| Locate a function, type, or symbol | \`search_codebase\` | \`build_context\` |
| Understand how specific code works across files | \`build_context\` | file reads |
| Diagnose brain-cache failures | \`doctor\` | -- |
| Reindex the project | \`index_repo\` | -- |

### search_codebase (locate code)

Call \`mcp__brain-cache__search_codebase\` to find functions, types, definitions, or implementations by meaning rather than keyword match.

Do NOT use for understanding how code works — use build_context once you have located the symbol.

### build_context (understand specific behavior)

Call \`mcp__brain-cache__build_context\` with a focused question about how specific code works. It retrieves semantically relevant code, deduplicates results, and fits them to a token budget.

Use for: "How does X work?", "What does this function do?", debugging unfamiliar code paths.

### doctor (diagnose issues)

Call \`mcp__brain-cache__doctor\` when any brain-cache tool fails or returns unexpected results.

### index_repo (reindex)

Call \`mcp__brain-cache__index_repo\` only when the user explicitly asks to reindex, or after major code changes. Do not call proactively.
`;
