---
phase: 02-storage-and-indexing
plan: 01
subsystem: storage
tags: [deps, types, crawler, file-walking, gitignore, fast-glob, ignore, lancedb, tree-sitter]
dependency_graph:
  requires: []
  provides:
    - CodeChunkSchema (src/lib/types.ts)
    - IndexStateSchema (src/lib/types.ts)
    - EMBEDDING_DIMENSIONS (src/lib/config.ts)
    - crawlSourceFiles (src/services/crawler.ts)
  affects:
    - 02-02 (chunker depends on CodeChunk type and crawler)
    - 02-03 (embedder depends on EMBED_TIMEOUT_MS, DEFAULT_BATCH_SIZE)
    - 02-04 (lancedb depends on IndexStateSchema, EMBEDDING_DIMENSIONS)
tech_stack:
  added:
    - "@lancedb/lancedb@0.27.1"
    - "apache-arrow@18.1.0"
    - "tree-sitter@0.25.0"
    - "tree-sitter-typescript@0.23.2"
    - "tree-sitter-python@0.25.0"
    - "tree-sitter-go@0.25.0"
    - "tree-sitter-rust@0.24.0"
    - "fast-glob@3.3.3"
    - "ignore@7.0.5"
  patterns:
    - fast-glob with hardcoded ALWAYS_EXCLUDE_GLOBS passed to ignore option
    - ignore package for .gitignore semantics
    - extname() + Set.has() for extension filtering
key_files:
  created:
    - src/services/crawler.ts
    - tests/services/crawler.test.ts
  modified:
    - package.json
    - package-lock.json
    - src/lib/types.ts
    - src/lib/config.ts
decisions:
  - "Used --legacy-peer-deps for tree-sitter-rust@0.24.0 which declares peerOptional tree-sitter@^0.22.1; actual API is compatible with 0.25.0"
  - "apache-arrow pinned to 18.1.0 (within LanceDB peer dep range >=15.0.0 <=18.1.0); @lancedb/lancedb does not re-export Schema/Field types"
metrics:
  duration: "4 minutes"
  completed: "2026-03-31T17:39:22Z"
  tasks: 2
  files: 6
---

# Phase 2 Plan 1: Dependencies, Types, and File Crawler Summary

**One-liner:** Phase 2 foundation: 9 runtime deps installed at pinned versions, CodeChunk/IndexState Zod schemas added, file crawler with gitignore + hardcoded exclusions returns absolute source file paths.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Install Phase 2 deps and extend shared types | 8109cfa | package.json, src/lib/types.ts, src/lib/config.ts |
| 2 (TDD) | Build file crawler service with tests | d223127 (test), 6309750 (impl) | src/services/crawler.ts, tests/services/crawler.test.ts |

## What Was Built

### Dependencies Installed

All Phase 2 runtime dependencies installed at pinned versions per RESEARCH.md and CLAUDE.md:

| Package | Version | Purpose |
|---------|---------|---------|
| @lancedb/lancedb | 0.27.1 | Embedded vector database |
| apache-arrow | 18.1.0 | Arrow schema types for LanceDB |
| tree-sitter | 0.25.0 | AST parser core |
| tree-sitter-typescript | 0.23.2 | TS/JS grammar |
| tree-sitter-python | 0.25.0 | Python grammar |
| tree-sitter-go | 0.25.0 | Go grammar |
| tree-sitter-rust | 0.24.0 | Rust grammar |
| fast-glob | 3.3.3 | File crawling |
| ignore | 7.0.5 | .gitignore parsing |

### Types Added (src/lib/types.ts)

- `CodeChunkSchema`: Zod schema with fields id, filePath, chunkType (enum: function/class/method/file), scope (nullable), name (nullable), content, startLine, endLine
- `CodeChunk`: TypeScript type inferred from schema
- `IndexStateSchema`: Zod schema with fields version (literal 1), embeddingModel, dimension, indexedAt, fileCount, chunkCount
- `IndexState`: TypeScript type inferred from schema

### Config Constants Added (src/lib/config.ts)

- `EMBEDDING_DIMENSIONS`: `{ 'nomic-embed-text': 768, 'mxbai-embed-large': 1024 }`
- `DEFAULT_BATCH_SIZE`: 32
- `EMBED_TIMEOUT_MS`: 120000
- `COLD_START_RETRY_DELAY_MS`: 5000

### Crawler Service (src/services/crawler.ts)

- `SOURCE_EXTENSIONS`: Set of 12 source extensions (.ts, .tsx, .mts, .cts, .js, .jsx, .mjs, .cjs, .py, .pyi, .go, .rs)
- `ALWAYS_EXCLUDE_GLOBS`: 11 hardcoded exclusion patterns (node_modules, .git, dist, build, .next, __pycache__, *.egg-info, lock files, *.min.js)
- `crawlSourceFiles(rootDir)`: Reads optional .gitignore, runs fast-glob, filters by extension and gitignore patterns, returns absolute paths
- Logs crawl result at info level via childLogger('crawler')

## Test Results

```
Tests: 82 passed (73 existing + 9 new crawler tests)
Test Files: 5 passed
Duration: ~400ms
```

Crawler tests cover all 7 specified behaviors:
1. Returns only files with SOURCE_EXTENSIONS
2. Excludes node_modules, .git, dist, build, __pycache__
3. Respects .gitignore patterns
4. Returns absolute paths
5. Returns empty array when no source files
6. Excludes lock files
7. Excludes .min.js files

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] tree-sitter-rust@0.24.0 peerDep conflict**
- **Found during:** Task 1 dependency installation
- **Issue:** `tree-sitter-rust@0.24.0` declares `peerOptional tree-sitter@^0.22.1` which conflicts with `tree-sitter@0.25.0`
- **Fix:** Used `--legacy-peer-deps` flag during npm install. Latest tree-sitter-rust is 0.24.0 and no compatible version exists for 0.25.0. The grammar API is stable across minor versions — actual usage via `createRequire` in chunker.ts (Plan 02-02) will validate compatibility at runtime.
- **Commit:** 8109cfa

**2. [Rule 2 - Missing Info] apache-arrow must be installed separately**
- **Found during:** Task 1 — checking if @lancedb/lancedb re-exports Arrow types
- **Issue:** RESEARCH.md noted this as an open question. Testing confirmed `@lancedb/lancedb` exports only `MakeArrowTableOptions` and `makeArrowTable` — no `Schema`, `Field`, or `FixedSizeList` types.
- **Fix:** Installed `apache-arrow@18.1.0` (pinned to within LanceDB peer dep range `>=15.0.0 <=18.1.0`).
- **Commit:** 8109cfa

## Known Stubs

None. All exports are fully implemented and tested.

## Self-Check: PASSED

- FOUND: src/services/crawler.ts
- FOUND: src/lib/types.ts
- FOUND: src/lib/config.ts
- FOUND: tests/services/crawler.test.ts
- FOUND: .planning/phases/02-storage-and-indexing/02-01-SUMMARY.md
- FOUND commit: 8109cfa (feat: install Phase 2 deps and extend shared types)
- FOUND commit: d223127 (test: add failing tests for crawler service)
- FOUND commit: 6309750 (feat: implement file crawler service)
