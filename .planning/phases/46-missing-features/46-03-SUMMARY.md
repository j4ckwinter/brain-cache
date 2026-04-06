---
phase: 46-missing-features
plan: 03
subsystem: retrieval
tags: [ollama, keyword-search, fallback, mcp]
---

# Plan 46-03 Summary

## Outcome

When Ollama is not running, `runSearch` uses `keywordSearchChunks` (full table scan + existing `computeKeywordBoost` scoring) instead of failing. Return type is `SearchResult` `{ chunks, fallback }`. MCP `search_codebase` uses `withGuards` option `allowOllamaDown: true` so the handler runs without Ollama; formatted output prepends a `[FALLBACK]` line when `fallback` is true. `build_context` is unchanged and still requires Ollama via existing guards.

## Key changes

- `src/services/retriever.ts` — exported `extractQueryTokens`, `computeKeywordBoost`, added `keywordSearchChunks`.
- `src/workflows/search.ts` — `isOllamaRunning`, fallback branch, `SearchResult`.
- `src/mcp/guards.ts` — `allowOllamaDown`; `src/mcp/server.ts` — search tool + `buildSearchResponse` fallback prefix.
- Tests: `tests/workflows/search.test.ts`, `tests/mcp/server.test.ts`.

## Verification

- `npx vitest run` — green
- `npm run build` — green
