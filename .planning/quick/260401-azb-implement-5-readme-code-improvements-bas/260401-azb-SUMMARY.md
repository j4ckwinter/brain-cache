---
phase: quick
plan: 260401-azb
subsystem: workflows, docs
tags: [system-prompt, documentation, readme, claude-api, audit]
dependency_graph:
  requires: []
  provides: [system-prompt-in-ask, readme-known-limitations, readme-context-builder-desc, readme-token-savings, readme-why-better]
  affects: [askCodebase, README]
tech_stack:
  added: []
  patterns: [system-prompt-top-level-parameter]
key_files:
  created: []
  modified:
    - src/workflows/askCodebase.ts
    - README.md
decisions:
  - Used plain string for system prompt (Anthropic SDK accepts string or content block array — string is simpler)
  - Placed SYSTEM_PROMPT constant after DEFAULT_* constants for readability
metrics:
  duration: ~5 minutes
  completed: "2026-04-01T14:57:31Z"
  tasks_completed: 2
  files_modified: 2
---

# Quick Task 260401-azb: Implement 5 README and Code Improvements Summary

**One-liner:** Added a system prompt to Claude API call guiding answer quality, and applied four README documentation improvements from an external audit.

---

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add system prompt to Claude API call | d57c653 | src/workflows/askCodebase.ts |
| 2 | Apply 4 README documentation improvements | b199696 | README.md |

---

## What Was Done

### Task 1: System prompt in Claude API call

Added a `SYSTEM_PROMPT` constant to `src/workflows/askCodebase.ts` and passed it as the `system` parameter to `client.messages.create()`. The prompt instructs Claude to:
- Answer strictly from the provided codebase context
- Avoid hallucinating details not present in context
- Reference specific files and functions when available
- Say "I don't see enough context to answer that" when context is insufficient

### Task 2: Four README improvements

1. **Context builder description** — Line 13 updated from "Trims and deduplicates" to "Selects, prioritises, deduplicates, and compresses" — more accurately reflects the context builder's actual behavior.

2. **Token savings formatting** — Single-line output replaced with a multi-line breakdown showing tokens sent, estimated baseline, reduction percentage, and model name. Matches the actual `stderr` output format in `askCodebase.ts`.

3. **"Why results are better" line** — Added after architecture diagram: "Because Claude receives only the most relevant code — not your entire repository — answers are more accurate, more consistent, and grounded in actual implementation details."

4. **Known Limitations section** — Added before MCP integration section documenting: no reranking, index staleness requiring manual re-index, no semantic compression, and single hardcoded embedding model.

---

## Verification

- `npx vitest run` — 269 tests passed, no regressions
- README.md contains "Known limitations" section — confirmed
- README.md contains "prioritises" — confirmed
- README.md contains "Estimated without" — confirmed
- README.md contains "grounded in actual" — confirmed
- `askCodebase.ts` contains `system: SYSTEM_PROMPT` in `messages.create` call — confirmed

---

## Deviations from Plan

None — plan executed exactly as written.

---

## Self-Check: PASSED

- [x] `src/workflows/askCodebase.ts` exists and contains `system: SYSTEM_PROMPT`
- [x] `README.md` contains all 4 improvements
- [x] Commits d57c653 and b199696 exist
- [x] 269 tests passing (no regressions)
