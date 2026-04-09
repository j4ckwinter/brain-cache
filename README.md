# brain-cache

> Stop sending your entire repo to Claude.

brain-cache is a local context engine for Claude Code. It indexes your codebase using AST-aware chunking and a call graph — so when Claude needs context, it gets the right functions and their dependencies, not a wall of files. Fewer tokens. Better answers. Runs entirely on your machine.

<video src="assets/brain-cache.mp4" width="720" autoplay loop muted playsinline></video>

---

## How it works

Most RAG tools split code by line count. brain-cache parses your source files into ASTs and chunks at function, class, and method boundaries — so a chunk is always a complete, meaningful unit of code, never an arbitrary slice of one.

At index time, brain-cache also extracts call edges and import edges from the AST. At query time, `build_context` uses those edges to expand retrieval one hop out — pulling in not just the code that matches your query, but the functions it calls and the modules it depends on. You get context that's complete, not just similar.

Everything runs locally via Ollama. No embeddings leave your machine. No API calls for retrieval.

---

## Supported languages

Full AST-aware chunking and call graph extraction:

- TypeScript / JavaScript (`.ts`, `.tsx`, `.js`, `.jsx`, `.mts`, `.cts`, `.mjs`, `.cjs`)
- Python (`.py`, `.pyi`)
- Go (`.go`)
- Rust (`.rs`)

Documentation files (`.md`, `.txt`, `.rst`) use a separate doc chunker and are included in retrieval. All other file types are skipped.

---

## Use inside Claude Code (MCP)

The primary way to use brain-cache is as an MCP server. Run `brain-cache init` once — it auto-configures `.mcp.json` in your project root so Claude Code connects immediately. No manual JSON setup needed.

Claude then has access to:

- **`build_context`** — Assembles relevant context for any question. Retrieves semantically similar chunks, then expands one hop along call and import edges to include dependencies. Use instead of reading files.
- **`search_codebase`** — Finds functions, types, and symbols by meaning, not keyword. Chunks at AST boundaries, so results are always complete code units. Use instead of grep.
- **`index_repo`** — Rebuilds the local vector index.

Also included: **`doctor`** — diagnoses index health and Ollama connectivity.

No copy/pasting code into prompts. No manual file opens. Claude knows where to look.

---

## Quick start

**Step 1: Install**

```
npm install -g brain-cache
```

Or as a project dev dependency:

```
npm install -D brain-cache
```

**Step 2: Init and index your project**

```
brain-cache init
brain-cache index
```

`brain-cache init` wires everything up: configures `.mcp.json` so Claude Code connects automatically, appends tool instructions to `CLAUDE.md`, installs the brain-cache skill to `.claude/skills/brain-cache/SKILL.md`, adds a status line showing cumulative token savings, and installs PreToolUse hooks that remind Claude to use brain-cache tools first. Runs once; idempotent.

**Step 3: Use Claude normally**

brain-cache tools are called automatically. You don't change how you work — the context just gets better.

> **Advanced:** `init` creates `.mcp.json` automatically. If you need to customise it manually, the expected shape is:
>
> ```json
> {
>   "mcpServers": {
>     "brain-cache": {
>       "command": "brain-cache",
>       "args": ["mcp"]
>     }
>   }
> }
> ```

---

## Keeping the index fresh

`brain-cache index` runs incrementally by default — unchanged files are skipped, so re-indexing a large repo after a few edits takes seconds, not minutes.

For continuous sync, `brain-cache watch` runs a debounced incremental re-index on every file save. Note: file watchers may be flagged by enterprise EDR tools (Cortex XDR, CrowdStrike, etc.) due to their behavioural profile. If you're on a managed machine, incremental indexing via `brain-cache index` is the safer default.

---

## Install as Claude Code skill

brain-cache ships as a Claude Code skill. After `brain-cache init`, the skill is installed at `.claude/skills/brain-cache/SKILL.md` in your project. Claude automatically learns when and how to use brain-cache tools.

To install manually, copy the `.claude/skills/brain-cache/` directory into your project root.

---

## Status line

After `brain-cache init`, the status line in Claude Code's bottom bar shows your cumulative token savings session by session. You see the reduction without doing anything different.

---

## PreToolUse hooks

`brain-cache init` installs advisory hooks into Claude Code (`~/.claude/settings.json`) that fire before certain tools. They remind Claude to try brain-cache first — but never block execution.

| Tool triggered | Reminder                                                                |
| -------------- | ----------------------------------------------------------------------- |
| Grep           | Try `search_codebase` to find code by meaning instead of regex          |
| Glob           | Try `search_codebase` to locate files by meaning instead of pattern     |
| Read           | Try `build_context` to get relevant code instead of reading whole files |
| Agent          | Try `build_context` or `search_codebase` before spawning a sub-agent    |

Hooks are idempotent — re-running `init` updates brain-cache hooks without touching any other hooks you have configured.

---

## Tuning how much Claude uses brain-cache

`brain-cache init` adds a section to your project's `CLAUDE.md` with clear instructions to use brain-cache tools first. This works well for most users.

If you want to go further, you can strengthen the language yourself:

```
ALWAYS use brain-cache build_context before reading files or using Grep/Glob.
Do not skip brain-cache tools — they return better results with fewer tokens.
```

Or soften it if you prefer Claude to decide on its own. It's your `CLAUDE.md` — edit it to match how you want to work.

---

## CLI commands

The CLI is the setup and admin interface. Use it to init, index, debug, and diagnose — not as the primary interface.

```
brain-cache init                      Initialize brain-cache in a project
brain-cache index                     Build/rebuild the vector index (incremental by default)
brain-cache watch [path]              Watch project and run debounced incremental re-index on save
brain-cache search "auth middleware"  Manual search (useful for debugging)
brain-cache context "auth flow"       Manual context building (useful for debugging)
brain-cache ask "how does auth work?" Direct Claude query via CLI
brain-cache status                    Show index and system status
brain-cache clean                     Remove .brain-cache/ index directories
brain-cache doctor                    Check system health
```

---

## Requirements

- Node.js >= 22
- Ollama running locally (`nomic-embed-text` model recommended)
- Anthropic API key (for `ask` command only)

---

## If this is useful

Give it a star — or try it on your repo and let me know what breaks.

---

## License

MIT — see LICENSE for details.
