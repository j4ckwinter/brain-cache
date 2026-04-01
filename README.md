# brain-cache

> Your local GPU finally has a job.

brain-cache is a local AI runtime that sits between your codebase and Claude. It runs embeddings, retrieval, and context building on your machine — so Claude only sees what actually matters. Fewer tokens. Better answers. Your GPU earning its keep.

## What it does

You ask a question. brain-cache:

1. Embeds your query locally via Ollama (fast, free, no API calls)
2. Retrieves the most relevant code chunks from its local vector index
3. Trims and deduplicates the context to fit a tight token budget
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
| `brain-cache init` | Set up brain-cache in the current directory and pull the embedding model |
| `brain-cache index` | Crawl, chunk, and embed your codebase into a local vector store |
| `brain-cache search <query>` | Retrieve relevant code chunks locally (no Claude call) |
| `brain-cache context <query>` | Preview the context that would be sent to Claude |
| `brain-cache ask <question>` | Full pipeline: retrieve context, call Claude, get an answer |
| `brain-cache status` | Show index stats, model info, and token savings to date |
| `brain-cache doctor` | Diagnose connection issues with Ollama, LanceDB, and the Anthropic API |

## How the token savings work

Every `ask` response includes a savings report:

```
🧠 brain-cache optimisation

Tokens sent to Claude:   1,240
Without brain-cache:     18,600
Reduction:               93%
```

Token counts are calculated locally before anything is sent to Claude — no surprise overages.

## MCP integration (Claude Code)

brain-cache ships an MCP server that exposes its tools directly inside Claude Code. Claude can call them without you manually copying context.

Add this to your `.mcp.json`:

```json
{
  "mcpServers": {
    "brain-cache": {
      "command": "brain-cache",
      "args": ["mcp"]
    }
  }
}
```

This gives Claude Code access to `index_repo`, `search_codebase`, `build_context`, and `doctor` as native tools.

## Supported languages

brain-cache uses tree-sitter for AST-aware chunking, which means it understands your code structure rather than just slicing by line count.

Currently supported: TypeScript, JavaScript, Python, Rust, Go

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

## Development

```bash
npm run build    # Compile to dist/
npm run link     # Register brain-cache in your shell (once after first clone)
npm run dev      # Run CLI directly with tsx (no build step needed)
npm test         # Run test suite (vitest)
```

## License

MIT
