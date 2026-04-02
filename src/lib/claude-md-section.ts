export const CLAUDE_MD_SECTION = `
## Brain-Cache MCP Tools

**IMPORTANT: Use brain-cache tools as your FIRST action before reading files or using Grep/Glob.**

### build_context (use for understanding)

Call \`mcp__brain-cache__build_context\` with the user's question BEFORE reading individual files. This retrieves semantically relevant code from across the entire repo, deduplicates it, and returns a token-budgeted context block.

**Always use for questions like:**
- "How does X work?" / "Explain X end to end"
- "Walk me through the flow of X"
- "What does this page/feature/component do?"
- "Explain the architecture" / "How is the project structured?"
- "What happens when Y is called?"
- Any question that requires understanding code across multiple files
- Debugging unfamiliar code paths or understanding error flows

**Do NOT skip this tool and jump to reading files.** build_context returns better results with fewer tokens than manually reading files.

### search_codebase (use for locating)

Call \`mcp__brain-cache__search_codebase\` instead of Grep or Glob when locating functions, symbols, types, definitions, or implementations. It uses semantic search — finds code by meaning, not just keyword match.

### doctor (use for diagnosing)

Call \`mcp__brain-cache__doctor\` first when any brain-cache tool fails or returns unexpected results.
`;
