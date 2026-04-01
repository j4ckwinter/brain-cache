---
phase: 03-retrieval-and-context-assembly
plan: "02"
subsystem: token-counter
tags: [token-counting, context-assembly, budget-enforcement]
dependency_graph:
  requires: [03-01]
  provides: [token-counter-service]
  affects: [03-03]
tech_stack:
  added: []
  patterns: [greedy-fill-budget, tdd-red-green]
key_files:
  created:
    - src/services/tokenCounter.ts
    - tests/services/tokenCounter.test.ts
  modified: []
decisions:
  - "Break on budget exceeded — assembleContext stops at first chunk that would exceed budget (not best-fit packing) for simplicity and determinism"
  - "Separator cost computed per iteration — avoids off-by-one where first chunk has no separator overhead"
metrics:
  duration_minutes: 2
  completed_date: "2026-04-01"
  tasks_completed: 1
  files_created: 2
  files_modified: 0
---

# Phase 03 Plan 02: Token Counter Service Summary

**One-liner:** Local token counter wrapping `@anthropic-ai/tokenizer` with greedy-fill budget assembly using separator-aware cost accounting.

## What Was Built

`src/services/tokenCounter.ts` implements three exports:

- **`countChunkTokens(text)`** — wraps `countTokens` from `@anthropic-ai/tokenizer`; returns 0 for empty strings without calling the tokenizer
- **`formatChunk(chunk)`** — formats a `RetrievedChunk` as `// File: {path} (lines {start}-{end})\n{content}`
- **`assembleContext(chunks, { maxTokens })`** — greedy fill: iterates chunks in caller-supplied order (highest similarity first), counts formatted chunk tokens plus separator cost, stops when next chunk would exceed budget; returns `{ content, chunks, tokenCount }`

`tests/services/tokenCounter.test.ts` has 13 test cases covering all exported functions with `@anthropic-ai/tokenizer` mocked (word count proxy for deterministic assertions).

## TDD Execution

- **RED:** Test file committed (`b3f4489`) — import failed because implementation did not exist
- **GREEN:** Implementation committed (`eeb07e3`) — all 13 tests pass

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — all exported functions are fully implemented.

## Self-Check

- [x] `src/services/tokenCounter.ts` exists and has 4 exports
- [x] `tests/services/tokenCounter.test.ts` exists with 13 test cases (plan required >=7)
- [x] All tests pass: `npm test -- tests/services/tokenCounter.test.ts` exits 0
- [x] Commit `b3f4489` (RED test) confirmed in git log
- [x] Commit `eeb07e3` (GREEN implementation) confirmed in git log
