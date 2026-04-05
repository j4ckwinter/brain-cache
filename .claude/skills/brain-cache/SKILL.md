---
name: brain-cache
description: "Local codebase embeddings that save tokens and money. Use brain-cache MCP tools instead of reading files or grepping — they return better results with fewer tokens sent to Claude."
allowed-tools: Bash Read Grep
---

## What brain-cache does

brain-cache indexes your codebase locally using Ollama embeddings — no data leaves your machine. When you need to understand code, it retrieves only the relevant parts and fits them to a token budget before sending anything to Claude. This means Claude sees better, more focused context while you spend fewer tokens per query.

Use brain-cache tools before reading files or using Grep/Glob for codebase questions. They return better, token-efficient results.

## Tool routing

| Query type | Tool | NOT this |
|-----------|------|---------|
| Locate a function, type, or symbol | `search_codebase` | `build_context` |
| Understand how specific code works across files | `build_context` | file reads |
| Diagnose brain-cache failures | `doctor` | -- |
| Reindex the project | `index_repo` | -- |

## search_codebase (locate code)

Call `mcp__brain-cache__search_codebase` to find functions, types, definitions, or implementations by meaning rather than keyword match.

Use for: "Where is X defined?", "Find the auth middleware", "Which file handles request validation?"

Do NOT use for understanding how code works — use `build_context` once you have located the symbol.

## build_context (understand behavior)

Call `mcp__brain-cache__build_context` with a focused question about how specific code works. It retrieves semantically relevant code, deduplicates results, and fits them to a token budget.

Use for: "How does X work?", "What does this function do?", debugging unfamiliar code paths.

Do NOT use for locating symbols — use `search_codebase` first to find where code lives.

Do NOT use just to get a file overview — ask a specific behavioral question.

## index_repo (reindex)

Call `mcp__brain-cache__index_repo` only when the user explicitly asks to reindex, or after major code changes such as a large refactor or pulling a significant upstream diff.

Do not call proactively. Do not call at the start of each session.

## doctor (diagnose issues)

Call `mcp__brain-cache__doctor` when any brain-cache tool fails or returns unexpected results. It checks index health and Ollama connectivity and tells you what to fix.

## Status line

brain-cache displays cumulative token savings in the Claude Code status bar. After tool calls you will see `brain-cache down-arrow{pct}% {n} saved` — this confirms cost savings are working. If the status bar shows idle, no tools have been called yet in the current session.

## Enforcement hooks

brain-cache installs PreToolUse hooks into `~/.claude/settings.json` via `brain-cache init`. These hooks fire automatically when Claude reaches for one of four tools that brain-cache replaces: `Grep`, `Glob`, `Read`, or `Agent`. When triggered, each hook injects a one-line reminder into Claude's context suggesting the appropriate brain-cache tool to use instead.

The hooks do not block tool calls. They are advisory — a nudge, not a gate. If brain-cache tools are unavailable (index not built, Ollama down), Claude can still fall back to the standard tools.

To install hooks: run `brain-cache init`. Running it multiple times is safe — existing hooks are not duplicated.
