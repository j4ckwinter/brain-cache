export const CLAUDE_MD_SECTION = `
## Brain-Cache MCP Tools

When answering questions about the codebase, prefer using brain-cache tools before reading files directly.

### build_context (use for understanding)

Call \`mcp__brain-cache__build_context\` with the user's question to retrieve semantically relevant code from across the repo. It deduplicates results and fits them to a token budget.

Works well for questions like:
- "How does X work?" / "Explain X end to end"
- "Walk me through the flow of X"
- "What does this page/feature/component do?"
- "Explain the architecture" / "How is the project structured?"
- "What happens when Y is called?"
- Any question that requires understanding code across multiple files
- Debugging unfamiliar code paths or understanding error flows

This typically returns better results with fewer tokens than manually reading files.

### search_codebase (use for locating)

Call \`mcp__brain-cache__search_codebase\` to find functions, types, definitions, or implementations by meaning rather than keyword match.

### doctor (use for diagnosing)

Call \`mcp__brain-cache__doctor\` when any brain-cache tool fails or returns unexpected results.
`;
