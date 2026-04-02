---
phase: quick-260401-t4n
plan: 01
subsystem: mcp
tags: [mcp, tool-descriptions, ux, dx]
requires: []
provides: [improved-mcp-tool-selection]
affects: [src/mcp/index.ts]
tech-stack-added: []
tech-stack-patterns: []
key-files-created: []
key-files-modified: [src/mcp/index.ts]
key-decisions:
  - "build_context description leads with explicit trigger phrases to drive automatic tool selection for explanatory/architectural questions"
  - "search_codebase description clearly differentiates as a locator tool and redirects to build_context for deeper questions"
metrics:
  duration: "51 seconds"
  completed: "2026-04-02"
  tasks_completed: 1
  files_modified: 1
---

# Quick 260401-t4n: Improve MCP build_context Description Summary

**One-liner:** Rewrote `build_context` and `search_codebase` MCP descriptions to drive automatic tool selection for explanatory and architectural questions.

---

## What Was Done

Updated ONLY the `description` strings for two tools in `src/mcp/index.ts`. No logic, schema, or behavior changes.

### build_context (Tool 3)

New description:
- Leads with explicit trigger phrases: "how does X work", "explain the architecture", "what happens when Y", multi-file reasoning questions
- States the value proposition: semantic retrieval across the entire repo, deduplication, token-budgeted context assembly — more accurate and efficient than naive file reads
- Includes use-before-answering guidance: "Use this before answering to ensure your response is grounded in actual code rather than assumptions"
- Lists ideal use cases: explaining systems, understanding workflows and data flow, architectural questions, multi-file reasoning, debugging unfamiliar code paths
- Retains prerequisite note (requires index_repo)

### search_codebase (Tool 2)

New description:
- Positions clearly as a locator tool: finds WHERE code lives (functions, symbols, definitions, implementations, type declarations)
- Differentiates from build_context: "For understanding HOW code works or answering questions that span multiple files, use build_context instead"
- States the semantic advantage over grep
- Retains prerequisite note (requires index_repo)

---

## Tasks

| # | Name | Status | Commit |
|---|------|--------|--------|
| 1 | Rewrite build_context and search_codebase descriptions | Complete | 66687ac |

---

## Verification

- `npx tsc --noEmit` — passes (no type errors)
- `grep -c "Prefer this tool" src/mcp/index.ts` — returns 1
- `grep -c "locator tool" src/mcp/index.ts` — returns 1
- `grep -c "grounded in actual code" src/mcp/index.ts` — returns 1
- `grep -c "build_context instead" src/mcp/index.ts` — returns 1
- `git diff src/mcp/index.ts` — only description strings changed

---

## Deviations from Plan

None — plan executed exactly as written.

---

## Known Stubs

None.

---

## Self-Check: PASSED

- [x] `src/mcp/index.ts` modified: FOUND
- [x] Commit 66687ac: FOUND
- [x] "Prefer this tool" present in file: 1 match
- [x] "locator tool" present in file: 1 match
- [x] TypeScript compiles without errors
