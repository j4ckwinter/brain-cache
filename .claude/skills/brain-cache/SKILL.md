---
name: brain-cache
description: "Retrieve focused codebase context using local embeddings. Use brain-cache MCP tools before reading files or grepping for codebase questions."
allowed-tools: Bash Read Grep
---

## What brain-cache does

brain-cache indexes your codebase locally using Ollama embeddings. Search and context assembly run locally; retrieved context is returned to Claude through MCP. The `ask` CLI command sends retrieved context to the Anthropic API.

Context budgets use an offline token estimate, not an exact count for modern Claude models. Savings compare retrieved context with a modeled grep/read baseline; they do not measure billing savings.

Use brain-cache tools before reading files or using Grep/Glob for codebase questions. Use focused queries to retrieve relevant context.

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

Call `mcp__brain-cache__build_context` with a focused question about how specific code works. It retrieves semantically relevant code, deduplicates results, and fits them to an approximate token budget.

Use for: "How does X work?", "What does this function do?", debugging unfamiliar code paths.

Do NOT use for locating symbols — use `search_codebase` first to find where code lives.

Do NOT use just to get a file overview — ask a specific behavioral question.

## index_repo (reindex)

Call `mcp__brain-cache__index_repo` only when the user explicitly asks to reindex, or after major code changes such as a large refactor or pulling a significant upstream diff.

Do not call proactively. Do not call at the start of each session.

## doctor (diagnose issues)

Call `mcp__brain-cache__doctor` when any brain-cache tool fails or returns unexpected results. It checks index health and Ollama connectivity and tells you what to fix.

## Status line

brain-cache displays estimated cumulative token savings in the Claude Code status bar as `brain-cache → est. saved {n} tokens ({pct}% less)`, with last-call savings when available. These estimates are not measured cost savings.

`idle` means there are no usable positive savings to display. It can appear when stats are missing, invalid, or more than two hours old, or when the estimated savings or rounded percentage is nonpositive. It does not prove that no tools have been called.

## Enforcement hooks

brain-cache installs PreToolUse hooks into `~/.claude/settings.json` via `brain-cache init`. These hooks fire automatically when Claude reaches for one of four tools that brain-cache replaces: `Grep`, `Glob`, `Read`, or `Agent`. When triggered, each hook injects a one-line reminder into Claude's context suggesting the appropriate brain-cache tool to use instead.

The hooks do not block tool calls. They are advisory — a nudge, not a gate. If Ollama is down, retrieval can use keyword fallback against an existing index. If brain-cache tools are unavailable or cannot answer the question, Claude can still use the standard tools.

To install hooks: run `brain-cache init`. Running it multiple times is safe — existing hooks are not duplicated.

## Updating this skill

`brain-cache init` skips an existing `.claude/skills/brain-cache/SKILL.md`. After upgrading, back up this file and compare it with the same path inside the installed brain-cache package. Merge the updated instructions while preserving project-specific changes; re-running `init` alone does not refresh this file.
