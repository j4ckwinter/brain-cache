---
phase: 05-cli-completion
plan: "01"
subsystem: cli
tags: [cli, status, doctor, tdd, workflows]
dependency_graph:
  requires: []
  provides: [runStatus, model-presence-check-in-runDoctor]
  affects: [src/cli/index.ts, src/workflows/doctor.ts]
tech_stack:
  added: []
  patterns: [stderr-only output, graceful exit with actionable messages, TDD red-green]
key_files:
  created:
    - src/workflows/status.ts
    - tests/workflows/status.test.ts
  modified:
    - src/workflows/doctor.ts
    - src/cli/index.ts
    - tests/workflows/init.test.ts
key_decisions:
  - "runStatus reads profile via readProfile() (global) and index state via readIndexState(projectRoot) — profile is global, index is per-project"
  - "model presence check uses startsWith(embeddingModel) to match versioned tags like mxbai-embed-large:latest"
metrics:
  duration: "14 min"
  completed: "2026-04-01T04:47:57Z"
  tasks_completed: 2
  files_created: 2
  files_modified: 3
requirements_completed: [CLI-03, CLI-04]
---

# Phase 05 Plan 01: Status Command and Doctor Model Check Summary

**One-liner:** `braincache status` reports index stats from LanceDB index_state.json; `braincache doctor` checks model presence via ollama.list() and prints actionable fix commands.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create runStatus workflow and status CLI command (CLI-04) | a25d66d | src/workflows/status.ts, tests/workflows/status.test.ts, src/cli/index.ts |
| 2 | Add model presence check to runDoctor (CLI-03) | a65cf74 | src/workflows/doctor.ts, tests/workflows/init.test.ts |

## What Was Built

### Task 1: runStatus workflow + status CLI command

`src/workflows/status.ts` implements `runStatus(targetPath?: string)`:
- Resolves path with `resolve(targetPath ?? '.')`
- Reads capability profile via `readProfile()` — exits 1 if not found with "Run 'brain-cache init' first"
- Reads index state via `readIndexState(rootDir)` — exits 1 if not found with actionable message
- Prints 7-field report to stderr: path, files indexed, chunks stored, last indexed, embedding model, embedding dimension, VRAM tier
- Zero stdout output

Status command registered in `src/cli/index.ts` with `[path]` optional argument using dynamic import pattern.

5 TDD tests added in `tests/workflows/status.test.ts`, all pass.

### Task 2: runDoctor model presence check

`src/workflows/doctor.ts` updated:
- Added `import ollama from 'ollama'`
- After Ollama status checks, calls `ollama.list()` when running to detect model presence
- Uses `startsWith(embeddingModel)` to match versioned tags (e.g., `mxbai-embed-large:latest`)
- Health report now includes `Model loaded: yes/no`
- When model is missing and Ollama is running, prints actionable fix:
  ```
  Fix: run 'brain-cache init' to pull the model, or:
       ollama pull <embeddingModel>
  ```

2 new tests added to `runDoctor` describe block in `tests/workflows/init.test.ts`.

## Test Results

- `tests/workflows/status.test.ts`: 5/5 pass
- `tests/workflows/init.test.ts`: 26/26 pass (13 runInit + 11 existing runDoctor + 2 new)
- Full suite: 220/220 pass, 15 test files

## Decisions Made

| Decision | Rationale |
|----------|-----------|
| `readProfile()` is global (no path param) | Profile is stored in global `~/.brain-cache/` config dir, not per-project |
| `readIndexState(rootDir)` is per-project | Index state lives in `<projectRoot>/.brain-cache/index_state.json` |
| `startsWith(embeddingModel)` for model match | Ollama model names include `:latest` tag suffix; prefix match handles all tag variants |
| ollama mock as `vi.mock('ollama', ...)` | Ollama is a direct import in doctor.ts; mock must match module ID exactly |

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED
