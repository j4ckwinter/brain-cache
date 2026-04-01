# brain-cache

> Your local GPU finally has a job.

brain-cache is a local AI runtime that sits between your codebase and Claude. It runs embeddings, retrieval, and context building on your machine — so Claude only sees what actually matters. Fewer tokens. Better answers. Your GPU earning its keep.

## What it does

You ask a question. brain-cache:

1. Embeds your query locally via Ollama (fast, free, no API calls)
2. Retrieves the most relevant code chunks from its local vector index
3. Selects, prioritises, deduplicates, and compresses the most relevant code into a tight token budget
4. Hands Claude a clean, minimal context — not your entire repo

The result: Claude gives you a sharper answer, and your API bill stops looking like a mortgage payment.

## Requirements

- [Node.js](https://nodejs.org/) 22.x
- [Ollama](https://ollama.com/) running locally with an embedding model pulled:
  ```bash
  ollama pull nomic-embed-text
  ```
- An Anthropic API key (for the `ask` command)

No GPU? No problem. brain-cache falls back to CPU automatically. It's slower, but it works.

## Installation

```bash
npm install -g brain-cache
```

Verify it installed correctly:

```bash
brain-cache --help
```

Or run from source:

```bash
git clone <repo>
cd brain-cache
npm install
npm run build
npm run link     # registers the `brain-cache` command in your shell
```

> `npm run link` runs `npm link` under the hood. It symlinks `dist/cli.js` into your global bin directory so `brain-cache` is available anywhere. Run it once after the initial clone. After that, `npm run build` is enough to pick up changes.

## Environment setup

The `ask` command needs an Anthropic API key to call Claude:

```bash
export ANTHROPIC_API_KEY=your_api_key
```

Add this to your shell profile (`~/.zshrc`, `~/.bashrc`) to persist it across sessions.

Local-only commands (`init`, `index`, `search`, `context`, `doctor`) work without it.

## Getting started

Three commands to go from zero to answers:

```bash
# 1. Initialize brain-cache in your project
brain-cache init

# 2. Index your codebase (first run takes a minute — grab a coffee)
brain-cache index

# 3. Ask a question
brain-cache ask "How does the authentication middleware work?"
```

That's it. brain-cache handles the retrieval, Claude handles the reasoning.

## CLI commands

| Command | What it does |
|---------|-------------|
| `brain-cache init` | Detect hardware, pull embedding model, create config directory |
| `brain-cache index [path]` | Crawl, chunk, embed, and store your codebase into a local vector store |
| `brain-cache search <query>` | Retrieve relevant code chunks locally (no Claude call) |
| `brain-cache context <query>` | Preview the context that would be sent to Claude |
| `brain-cache ask <question>` | Full pipeline: retrieve context, call Claude, get an answer |
| `brain-cache status [path]` | Show index stats, model info, and files indexed |
| `brain-cache doctor` | Diagnose connection issues with Ollama, LanceDB, and the Anthropic API |

### Flags

**`brain-cache index [path]`**
- `-f, --force` — Force full reindex, ignoring cached file hashes (re-embeds everything)

**`brain-cache search <query>`**
- `-n, --limit <n>` — Maximum number of results (default: 10)
- `-p, --path <path>` — Project root directory

**`brain-cache context <query>`**
- `-n, --limit <n>` — Maximum number of search results (default: 10)
- `-b, --budget <tokens>` — Token budget for assembled context (default: 4096)
- `-p, --path <path>` — Project root directory

**`brain-cache ask <question>`**
- `-b, --budget <tokens>` — Token budget for context retrieval (default: 4096)
- `-p, --path <path>` — Project root directory

## How the token savings work

Every `ask` response includes a savings report:

```
brain-cache: context assembled (1,240 tokens, 93% reduction)

  Tokens sent to Claude:     1,240
  Estimated without brain-cache: ~18,600
  Reduction:                  93%
  Model:                      claude-sonnet-4-20250514
```

Token counts are calculated locally before anything is sent to Claude — no surprise overages.

## What shipped in v1.1 (Hardening)

- **Incremental indexing** — only re-embeds new and changed files (SHA-256 content hashing); unchanged files are skipped entirely
- **`--force` flag** — bypass incremental diffing for a full reindex when you need a clean slate
- **Concurrent file I/O pipeline** — up to 20 files processed in parallel; streaming embed keeps memory flat
- **Ollama process security** — pre-spawn duplicate detection, PID tracking, orphan cleanup, and a remote host guard that prevents spawning against non-localhost Ollama instances
- **Zero `any` types** — production code is fully type-safe; all implicit anys eliminated
- **Error handling** — workflows throw instead of calling `process.exit`, making them composable and testable
- **269 tests passing**

## Known limitations

- **No reranking** — retrieval is pure vector similarity; a reranking pass to refine results is planned but not yet implemented
- **Index staleness** — after code changes, you need to re-run `brain-cache index` to pick up new content (file-watch mode is on the roadmap)
- **No context compression** — context is deduplicated and trimmed, but not yet semantically compressed (e.g., summarising large functions)
- **Single embedding model** — currently hardcoded to `nomic-embed-text`; model selection is planned

## MCP integration (Claude Code)

brain-cache ships an MCP server that exposes its tools directly inside Claude Code. Claude can call them without you manually copying context.

The MCP server is a separate compiled entry point at `dist/mcp.js`. Add this to your `.mcp.json` (substituting the actual path to your brain-cache installation):

```json
{
  "mcpServers": {
    "brain-cache": {
      "command": "node",
      "args": ["/absolute/path/to/brain-cache/dist/mcp.js"]
    }
  }
}
```

This gives Claude Code access to these tools:

| Tool | What it does |
|------|-------------|
| `index_repo` | Index a codebase — parse, chunk, embed, store in LanceDB. Accepts `force: true` for full reindex. |
| `search_codebase` | Search the indexed codebase with a natural language query, returns top-N chunks with similarity scores |
| `build_context` | Build a deduplicated, token-budgeted context block ready for inclusion in a Claude prompt |
| `doctor` | Return system health: Ollama status, index freshness, model availability, VRAM info |

## Supported languages

brain-cache uses tree-sitter for AST-aware chunking, which means it understands your code structure rather than just slicing by line count.

| Language | Extensions |
|----------|-----------|
| TypeScript | `.ts`, `.tsx` |
| JavaScript | `.js`, `.jsx` |
| Python | `.py`, `.pyi` |
| Go | `.go` |
| Rust | `.rs` |

## Architecture (for the curious)

```
Your question
     |
     v
Ollama (local embed)
     |
     v
LanceDB (vector search) --> Relevant chunks
     |
     v
Context builder (deduplicate, prioritize, trim to budget)
     |
     v
Claude (just the good stuff)
     |
     v
Answer + token savings report
```

All the heavy lifting happens on your machine. Claude gets a clean brief, not a data dump.

Because Claude receives only the most relevant code — not your entire repository — answers are more accurate, more consistent, and grounded in actual implementation details.

## Claude interaction

brain-cache doesn't just send context to Claude — it sends a system prompt that enforces grounded, accurate answers:

- **Answer strictly from context** — Claude is instructed to use only the provided code, not general knowledge
- **No hallucination** — if the context doesn't contain enough information, Claude says so rather than guessing
- **Code-level precision** — answers reference specific files and functions from the retrieved context

This means every `ask` response is constrained to what brain-cache actually found in your codebase. No vague generalities, no invented implementation details.

## Development

```bash
npm run build    # Compile to dist/
npm run link     # Register brain-cache in your shell (once after first clone)
npm run dev      # Run CLI directly with tsx (no build step needed)
npm test         # Run test suite (vitest) — 269 tests
```

## License

MIT
