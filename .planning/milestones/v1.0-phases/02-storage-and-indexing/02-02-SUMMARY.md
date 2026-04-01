---
phase: 02-storage-and-indexing
plan: 02
subsystem: indexing
tags: [tree-sitter, chunker, ast, typescript, javascript, python, go, rust, cjs-esm-shim, createRequire]

dependency_graph:
  requires:
    - phase: 02-01
      provides: CodeChunkSchema (src/lib/types.ts), tree-sitter packages installed
  provides:
    - chunkFile (src/services/chunker.ts)
    - LANGUAGE_MAP (src/services/chunker.ts)
    - CHUNK_NODE_TYPES (src/services/chunker.ts)
  affects:
    - 02-03 (embedder calls chunkFile to get CodeChunk objects for embedding)
    - 02-04 (runIndex workflow uses chunkFile in the crawl->chunk->embed->store pipeline)

tech-stack:
  added: []
  patterns:
    - "CJS/ESM shim: createRequire(import.meta.url) to load tree-sitter native addons in ESM project"
    - "Recursive generator walkNodes() for AST traversal"
    - "Arrow function depth filter: depth > 5 skips nested callbacks, <= 5 admits top-level/exported"
    - "File-type fallback chunk when no semantic nodes extracted"

key-files:
  created:
    - src/services/chunker.ts
    - tests/services/chunker.test.ts
  modified: []

key-decisions:
  - "Arrow function depth threshold of 5: top-level export arrow_function is at depth 4 (root > export_statement > lexical_declaration > variable_declarator > arrow_function); nested callbacks are depth 6+"
  - "Both class and its methods extracted as separate chunks — plan says 'do not skip the class if it contains methods'"
  - "classifyChunkType maps method_definition/method_declaration to 'method', class nodes to 'class', everything else to 'function'"

patterns-established:
  - "createRequire shim: all tree-sitter usage goes through chunker.ts; no other file imports tree-sitter directly"
  - "AST chunk id format: ${filePath}:${node.startPosition.row} — unique for indexing"
  - "1-based line numbers: startLine = node.startPosition.row + 1 (tree-sitter uses 0-based rows)"

requirements-completed:
  - IDX-03

duration: 6min
completed: 2026-03-31
---

# Phase 2 Plan 2: AST-Aware Chunker Service Summary

**Tree-sitter AST chunker with CJS/ESM shim parsing TS/JS/Python/Go/Rust at function/class/method boundaries, producing CodeChunk objects with file-type fallback for type-only files.**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-03-31T10:43:14Z
- **Completed:** 2026-03-31T10:49:00Z
- **Tasks:** 2 (combined into TDD flow)
- **Files modified:** 2

## Accomplishments

- AST-aware chunker service using tree-sitter CJS/ESM shim via `createRequire(import.meta.url)`
- Chunking support for 5 languages: TypeScript, JavaScript, Python, Go, and Rust
- Exported `LANGUAGE_MAP` (12 extensions), `CHUNK_NODE_TYPES` (4 language categories), `chunkFile()` function
- Arrow function filter preserving top-level/exported arrow functions while skipping nested callbacks
- File-type fallback chunk for type-only TypeScript files (interfaces, type aliases with no extractable AST nodes)
- 27 new tests; full suite passes at 109 tests

## Task Commits

Each task was committed atomically:

1. **Task 1 RED - Failing chunker tests** - `64dd2f5` (test)
2. **Task 1 GREEN - Chunker implementation** - `48000b4` (feat)

_Note: Tasks 1 and 2 were combined — tests created as TDD RED, implementation as TDD GREEN. Arrow function depth threshold auto-fixed in same commit as GREEN (Rule 1 — initial depth <= 2 was wrong for exported arrow at depth 4)._

## Files Created/Modified

- `src/services/chunker.ts` — AST chunker service with CJS/ESM shim, LANGUAGE_MAP, CHUNK_NODE_TYPES, chunkFile()
- `tests/services/chunker.test.ts` — 27 tests covering all 5 languages, fallback, unsupported extensions

## Decisions Made

- **Arrow function depth threshold of 5:** Discovered via AST inspection that `export const fn = () => ...` produces an arrow_function at depth 4 from root (root > export_statement > lexical_declaration > variable_declarator > arrow_function). Nested callbacks (e.g., inside `forEach`) are at depth 6+. Threshold of 5 correctly admits top-level/exported and rejects nested callbacks.
- **Combined Tasks 1 and 2 into single TDD flow:** Plan explicitly noted they could be combined. Tests were written first (RED), implementation second (GREEN), as the TDD protocol requires.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Arrow function depth threshold was wrong (depth <= 2 rejected top-level exports)**
- **Found during:** Task 1 GREEN — test "extracts exported arrow function (top-level)" failed
- **Issue:** Initial implementation used `depth > 2` but `export const add = (a, b) => ...` places arrow_function at depth 4 in the TypeScript AST
- **Fix:** Ran AST inspection to find actual depth of exported arrow functions (depth 4) vs nested callbacks (depth 6). Changed threshold to `depth > 5`.
- **Files modified:** src/services/chunker.ts
- **Verification:** All 27 tests pass including the arrow function test
- **Committed in:** 48000b4 (Task 1 GREEN commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 — logic error in arrow function depth filter)
**Impact on plan:** Necessary correctness fix. No scope creep.

## Issues Encountered

- The `npx tsx -e` inline eval flag uses CJS mode and cannot import ESM files via `createRequire`. The smoke test was verified correctly by writing to a `.mts` temp file and running via `npx tsx`. The vitest tests (which use ESM) pass correctly and are the authoritative verification.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `chunkFile(filePath, content)` is ready for use in embedder and indexer pipeline (Plans 02-03, 02-04)
- `LANGUAGE_MAP` is exported and can be inspected for language support coverage
- `CHUNK_NODE_TYPES` is exported for any future filtering or extension
- Full test suite green (109 tests)

---
*Phase: 02-storage-and-indexing*
*Completed: 2026-03-31*
