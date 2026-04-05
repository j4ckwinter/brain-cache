# brain-cache

> Your local GPU finally has a job.

brain-cache is a local AI runtime that sits between your codebase and Claude. It runs embeddings and retrieval on your machine — so Claude only sees what actually matters. Fewer tokens. Better answers. Your API bill stops looking like a mortgage payment.

![brain-cache only sends the parts of your codebase that matter — not everything.](assets/brain-cache.svg)

---

## How it works

1. Embeds your query locally via Ollama (fast, free, no API calls)
2. Retrieves the most relevant code chunks from its local vector index
3. Trims and deduplicates the context to fit a tight token budget
4. Hands Claude a clean, minimal context — not your entire repo

---

## Use inside Claude Code (MCP)

The primary way to use brain-cache is as an MCP server. Run `brain-cache init` once — it auto-configures `.mcp.json` in your project root so Claude Code connects immediately. No manual JSON setup needed.

Claude then has access to:

- **`build_context`** — Assembles relevant context for any question. Use instead of reading files.
- **`search_codebase`** — Finds functions, types, and symbols by meaning, not keyword. Use instead of grep.
- **`index_repo`** — Rebuilds the local vector index.

Also included: **`doctor`** — diagnoses index health and Ollama connectivity.

No copy/pasting code into prompts. No manual file opens. Claude knows where to look.

---

## Example

```
> "How does the auth middleware work?"

brain-cache: context assembled (74 tokens, 97% reduction)

Tokens sent to Claude:     74
Estimated without:         ~2,795
Reduction:                 97%
```

Claude gets only what matters — answers are sharper and grounded.

---

## Quick start

**Step 1: Install**

```
npm install -g brain-cache
```

**Step 2: Init and index your project**

```
brain-cache init
brain-cache index
```

`brain-cache init` sets up your project: configures `.mcp.json` so Claude Code connects to brain-cache automatically, appends MCP tool instructions to `CLAUDE.md`, installs the brain-cache skill to `.claude/skills/brain-cache/SKILL.md`, and installs a status line in Claude Code that shows cumulative token savings. Runs once; idempotent.

**Step 3: Use Claude normally**

brain-cache tools are called automatically. You don't change how you work — the context just gets better.

> **Advanced:** `init` creates `.mcp.json` automatically. If you need to customise it manually, the expected shape is:
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

## Install as Claude Code skill

brain-cache ships as a Claude Code skill. After `brain-cache init`, the skill is
installed at `.claude/skills/brain-cache/SKILL.md` in your project. Claude
automatically learns when and how to use brain-cache tools.

To install manually, copy the `.claude/skills/brain-cache/` directory into your
project root.

---

## Status line

After `brain-cache init`, the status line in Claude Code's bottom bar shows your cumulative token savings session by session. You see the reduction without doing anything different.

---

## Tuning how much Claude uses brain-cache

`brain-cache init` adds a section to your project's `CLAUDE.md` with clear instructions to use brain-cache tools first. This works well for most users.

If you want to go further, you can strengthen the language yourself. For example:

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
brain-cache index                     Build/rebuild the vector index
brain-cache search "auth middleware"  Manual search (useful for debugging)
brain-cache context "auth flow"       Manual context building (useful for debugging)
brain-cache ask "how does auth work?" Direct Claude query via CLI
brain-cache status                    Show index and system status
brain-cache doctor                    Check system health
```

---

## Token savings

Every call shows exactly what was saved:

```
context: 1,240 tokens (93% reduction)
```

Less noise — better reasoning — cheaper usage.

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

---
