---
phase: 46-missing-features
plan: 01
subsystem: indexing
tags: [markdown, doc-chunker, crawler, marked]
---

# Plan 46-01 Summary

## Outcome

Documentation file indexing for `.md`, `.txt`, and `.rst` is implemented: `marked` lexer drives `##`-boundary Markdown sections with heading breadcrumbs in `scope`, YAML frontmatter stripping, paragraph sub-chunking via `DOC_CHUNK_SIZE_THRESHOLD` (1500 Anthropic tokens), and plain-text chunking on double newlines. The crawler includes the new extensions; `chunkFile` routes unknown grammars to `chunkDocFile` for those extensions.

## Key changes

- Added `src/services/docChunker.ts` (`chunkDocFile`, internal Markdown/plain helpers).
- Added `DOC_CHUNK_SIZE_THRESHOLD` in `src/lib/config.ts`.
- Wired `src/services/chunker.ts` and `src/services/crawler.ts`; tests in `tests/services/docChunker.test.ts`, updated `chunker.test.ts` and `crawler.test.ts`.
- Dependency: `marked`.

## Verification

- `npx vitest run` — green
- `npm run build` — green
