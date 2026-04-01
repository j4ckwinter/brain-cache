---
phase: 01-foundation
plan: 02
subsystem: infra
tags: [ollama, nvidia-smi, system_profiler, capability-detection, vram, embeddings, pino, zod, vitest]

# Dependency graph
requires:
  - phase: 01-01
    provides: "VRAMTier, CapabilityProfile, CapabilityProfileSchema types; GLOBAL_CONFIG_DIR, PROFILE_PATH config constants; childLogger service"
provides:
  - "GPU/VRAM detection for NVIDIA (nvidia-smi) and Apple Silicon (system_profiler)"
  - "VRAM tier classification: none (<2 GiB), standard (2-7 GiB), large (8+ GiB)"
  - "Embedding model auto-selection: nomic-embed-text (none/standard), mxbai-embed-large (large)"
  - "Profile persistence: read/write ~/.brain-cache/profile.json with zod validation"
  - "Ollama lifecycle: isOllamaInstalled, isOllamaRunning, startOllama (auto-start + polling), pullModelIfMissing (stream), getOllamaVersion"
affects: [01-03-init-workflow, all-phases-using-capability-detection, all-phases-using-ollama]

# Tech tracking
tech-stack:
  added: [ollama@0.6.3]
  patterns:
    - "execFileAsync via promisify(execFile) for all child process calls — never exec()"
    - "3-second timeout on all hardware detection commands (nvidia-smi, system_profiler)"
    - "Intel Mac guard: check chip_type contains 'Apple M' before treating physical_memory as VRAM"
    - "Never console.log — pino childLogger or process.stderr.write (interactive progress only)"
    - "zod v4 safeParse for all JSON deserialization from disk"
    - "spawn + unref pattern for detached background processes"

key-files:
  created:
    - src/services/capability.ts
    - src/services/ollama.ts
    - tests/services/capability.test.ts
    - tests/services/ollama.test.ts
  modified:
    - package.json
    - package-lock.json

key-decisions:
  - "execFile (not exec) with promisify for child process calls — avoids shell injection, better error handling"
  - "Intel Mac guard via chip_type check — physical_memory on Intel Mac is system RAM, not VRAM"
  - "startOllama uses 500ms poll interval for 10 attempts (5s total) before giving up"
  - "pullModelIfMissing uses stream: true for real-time progress reporting to stderr"
  - "ollamaVersion set to null in detectCapabilities — caller (init workflow, Plan 03) is responsible for populating it after getOllamaVersion()"

patterns-established:
  - "TDD pattern: write failing tests first (RED), then implement (GREEN) — enforced with vitest"
  - "All hardware detection functions return null on any error (graceful degradation, never throws)"
  - "Service functions are pure where possible (classifyVRAMTier, selectEmbeddingModel) and async where I/O is needed"

requirements-completed: [INF-01, INF-02, INF-03]

# Metrics
duration: 2min
completed: 2026-03-31
---

# Phase 1 Plan 2: Capability Detection and Ollama Lifecycle Summary

**Hardware detection service (NVIDIA + Apple Silicon), VRAM tier classification, embedding model auto-selection, profile persistence, and Ollama lifecycle management — all with graceful CPU fallback**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-31T16:53:32Z
- **Completed:** 2026-03-31T16:56:22Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Capability detection service: NVIDIA VRAM via nvidia-smi, Apple Silicon VRAM via system_profiler JSON, Intel Mac guard via chip_type check, graceful null return on any error
- VRAM tier classification and embedding model selection as pure functions — trivially testable, no side effects
- Profile persistence: write/read `~/.brain-cache/profile.json` with zod v4 schema validation
- Ollama lifecycle management: install check, running check, auto-start with 500ms polling (10 attempts/5s), model pull with stream progress

## Task Commits

Each task was committed atomically:

1. **Task 1: Capability detection service** - `20d1bb5` (feat)
2. **Task 2: Ollama lifecycle service** - `d083529` (feat)

## Files Created/Modified
- `src/services/capability.ts` - GPU/VRAM detection, tier classification, model selection, profile persistence
- `src/services/ollama.ts` - Ollama install/running detection, auto-start, model pull with stream progress
- `tests/services/capability.test.ts` - 24 unit tests (TDD): all classifyVRAMTier, selectEmbeddingModel, detectNvidiaVRAM, detectAppleSiliconVRAM, readProfile, writeProfile, detectCapabilities
- `tests/services/ollama.test.ts` - 11 unit tests (TDD): all isOllamaInstalled, isOllamaRunning, startOllama, pullModelIfMissing, getOllamaVersion
- `package.json` - Added ollama@0.6.3 dependency
- `package-lock.json` - Updated lock file

## Decisions Made
- `execFile` with `promisify` (not `exec`) for all child process calls — avoids shell injection, exact arg control, better error handling
- Intel Mac guard via `chip_type` containing `"Apple M"` — physical memory on Intel Mac is system RAM, not GPU VRAM
- `startOllama` polls every 500ms up to 10 times (5s total) before returning false — per D-06
- `pullModelIfMissing` uses `stream: true` for real-time progress to stderr — per D-07
- `ollamaVersion` left as `null` in `detectCapabilities` return — the init workflow (Plan 03) is responsible for calling `getOllamaVersion()` and populating it in the written profile

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Installed missing ollama npm package**
- **Found during:** Task 2 (Ollama lifecycle service)
- **Issue:** `ollama@0.6.3` not in package.json; test file could not mock it; import would fail at runtime
- **Fix:** Ran `npm install ollama@0.6.3`
- **Files modified:** package.json, package-lock.json
- **Verification:** `ls node_modules/ollama` confirms installed; tests pass
- **Committed in:** `d083529` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Essential — ollama package is a first-class dependency per CLAUDE.md technology stack. No scope creep.

## Issues Encountered
- None — all tests passed on first GREEN run after implementation.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- capability.ts and ollama.ts are the two service modules ready to be wired into the init workflow (Plan 03)
- Plan 03 orchestrates: detectCapabilities() -> writeProfile() -> isOllamaInstalled() -> isOllamaRunning() -> startOllama() if needed -> pullModelIfMissing()
- All error paths return null/false (never throw), so init workflow can make clear decisions on each step
- 35 tests passing: `npx vitest run tests/services/capability.test.ts tests/services/ollama.test.ts`

## Self-Check: PASSED

- FOUND: /workspace/src/services/capability.ts
- FOUND: /workspace/src/services/ollama.ts
- FOUND: /workspace/tests/services/capability.test.ts
- FOUND: /workspace/tests/services/ollama.test.ts
- FOUND: /workspace/.planning/phases/01-foundation/01-02-SUMMARY.md
- FOUND commit 20d1bb5 (capability detection service)
- FOUND commit d083529 (Ollama lifecycle service)
- 35 tests passing (24 capability + 11 ollama)

---
*Phase: 01-foundation*
*Completed: 2026-03-31*
