# Phase 5: CLI Completion - Research

**Researched:** 2026-03-31
**Domain:** Commander CLI, terminal progress output, human-readable formatting
**Confidence:** HIGH

## Summary

Phase 5 is a thin adapter completion phase. The heavy lifting — workflows, services, data storage — is entirely done in Phases 1-4. All four CLI commands (`init`, `index`, `doctor`, `status`) already have their backing workflows or can be built directly from existing services. What remains is surface polish: progress feedback during indexing, improved formatting for `doctor`, and a new `status` command backed by `readIndexState` + `readProfile`.

The current `src/cli/index.ts` has stubs for `init`, `doctor`, `index`, `search`, and `context`, all wired correctly as thin adapters calling dynamic imports. The gap is that `status` does not exist yet, and the existing commands use bare `process.stderr.write()` lines for progress rather than structured progress output. The `doctor` workflow also currently gates on a saved profile and calls `process.exit(1)` if absent — the requirement says "missing Ollama models produce an actionable fix message, not a stack trace", which is already satisfied, but the formatting can be improved.

**Primary recommendation:** Add `braincache status` as a new CLI command wired to `readIndexState` + `readProfile` services directly (no new workflow needed — it is read-only). Improve `runIndex` progress output and `runDoctor` output in their respective workflow files. All changes are isolated to `src/cli/index.ts`, `src/workflows/index.ts`, and `src/workflows/doctor.ts`.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
All implementation choices are at Claude's discretion — discuss phase was skipped per user setting. Use ROADMAP phase goal, success criteria, and codebase conventions to guide decisions.

### Claude's Discretion
All implementation choices are at Claude's discretion.

### Deferred Ideas (OUT OF SCOPE)
None — discuss phase skipped.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CLI-01 | `braincache init` detects hardware, pulls required Ollama model with progress output, warms the model into VRAM, creates config directory | `runInit()` already does this; progress output for `pullModelIfMissing` exists (line-by-line stderr); model warming is not yet present — `ollama.generate()` or an embed call can warm the model after pull |
| CLI-02 | `braincache index [path]` displays a progress bar during indexing and prints token savings stats on completion | `runIndex()` emits per-batch stderr lines; upgrading to structured progress (%) is a workflow edit; token savings stats require a new calculation at end of `runIndex` |
| CLI-03 | `braincache doctor` outputs human-readable system health; missing Ollama models produce actionable fix messages | `runDoctor()` already renders human-readable output to stderr; need to add model-presence check and fix message for missing model |
| CLI-04 | `braincache status` reports files indexed, chunks stored, last indexed time, and active embedding model | No `status` command exists; implement by reading `readIndexState()` + `readProfile()` directly in the CLI action or a thin new workflow |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `commander` | 14.0.3 | CLI command/argument parsing | Already in use; all commands follow thin-adapter pattern |
| `process.stderr.write` | Node.js built-in | All user-facing output | INF-04 mandates stderr-only for all output except MCP stdout |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `ollama` | 0.6.3 (in deps) | Model warm-up call after pull | Used in `pullModelIfMissing`; `ollama.embed()` as warmup call in init |
| `readIndexState` | internal service | Reading LanceDB index metadata | Used in `status` and `doctor` commands |
| `readProfile` | internal service | Reading capability profile | Used in `status` command |

### No New Dependencies Required
All functionality needed for Phase 5 can be implemented with existing dependencies and Node.js builtins. No additional npm packages are needed.

**Installation:** None required.

## Architecture Patterns

### Recommended Project Structure
No structural changes. All work is within:
```
src/
├── cli/index.ts         # Add status command; CLI is thin adapter only
├── workflows/index.ts   # Improve progress output + add token savings stats
├── workflows/doctor.ts  # Add model presence check + actionable fix messages
└── workflows/init.ts    # Add model warm-up step after pull
```

### Pattern 1: Thin CLI Adapter (Established)
**What:** CLI action functions call dynamic imports of workflows, pass args, and let workflows handle all logic and output.
**When to use:** All CLI commands — business logic NEVER lives in the CLI handler.
**Example:**
```typescript
// Source: src/cli/index.ts (existing pattern)
program
  .command('status')
  .description('Show index stats: files indexed, chunks stored, last indexed time')
  .option('-p, --path <path>', 'Project root directory')
  .action(async (opts: { path?: string }) => {
    const { runStatus } = await import('../workflows/status.js');
    await runStatus(opts.path);
  });
```

### Pattern 2: Status Command (New — Read-Only)
**What:** `runStatus` reads `readIndexState` and `readProfile` — no Ollama call needed.
**When to use:** `braincache status`
**Example:**
```typescript
// Minimal read-only status — no process.exit guards needed for missing index
import { resolve } from 'node:path';
import { readProfile } from '../services/capability.js';
import { readIndexState } from '../services/lancedb.js';

export async function runStatus(targetPath?: string): Promise<void> {
  const rootDir = resolve(targetPath ?? '.');
  const profile = await readProfile();
  const indexState = await readIndexState(rootDir);

  if (profile === null) {
    process.stderr.write("No profile found. Run 'brain-cache init' first.\n");
    process.exit(1);
  }

  if (indexState === null) {
    process.stderr.write(
      `No index found at ${rootDir}. Run 'brain-cache index [path]' first.\n`
    );
    process.exit(1);
  }

  process.stderr.write(
    `brain-cache status\n` +
    `──────────────────\n` +
    `Path:              ${rootDir}\n` +
    `Files indexed:     ${indexState.fileCount}\n` +
    `Chunks stored:     ${indexState.chunkCount}\n` +
    `Last indexed:      ${indexState.indexedAt}\n` +
    `Embedding model:   ${indexState.embeddingModel}\n` +
    `VRAM tier:         ${profile.vramTier}\n`
  );
}
```

### Pattern 3: Progress Output for runIndex
**What:** Replace per-batch `process.stderr.write` lines with percentage-based progress.
**When to use:** During embedding loop in `runIndex`.
**Example:**
```typescript
// Replace the per-batch progress line:
const pct = Math.round((processedCount / allChunks.length) * 100);
process.stderr.write(
  `brain-cache: embedding ${processedCount}/${allChunks.length} chunks (${pct}%)\r`
);
// After loop, print newline to flush the \r line:
process.stderr.write('\n');
```

### Pattern 4: Token Savings Stats in runIndex
**What:** After indexing completes, calculate and print token savings estimate.
**When to use:** End of `runIndex`, just before success summary.
**Note:** `runBuildContext` already has this calculation (sum of file tokens for unique files). `runIndex` should print a simpler version — total tokens in all indexed files vs. average chunk token count * chunk count. This gives the user a sense of compression ratio.
**Example:**
```typescript
// After writeIndexState — simple ratio from stored chunk token count estimate
// Use countChunkTokens from tokenCounter.ts (already a dependency of buildContext.ts)
// Avoid re-reading files here — just report the chunk count as a proxy
process.stderr.write(
  `brain-cache: indexing complete\n` +
  `  Files:        ${files.length}\n` +
  `  Chunks:       ${allChunks.length}\n` +
  `  Model:        ${profile.embeddingModel}\n` +
  `  Stored in:    ${rootDir}/.brain-cache/\n`
);
```
For token savings stats specifically: count total tokens across all source files using `countChunkTokens`, sum chunk token counts, compute ratio. This mirrors `runBuildContext`'s approach.

### Pattern 5: Model Warm-Up in runInit (CLI-01)
**What:** After `pullModelIfMissing`, send one embed call to load the model into VRAM.
**When to use:** After `pullModelIfMissing` in `runInit`.
**Note:** `embedBatchWithRetry` from `src/services/embedder.ts` handles the Ollama 120s timeout and cold-start retry. Calling it with a single "warmup" string after model pull satisfies the "warms the model into VRAM" success criterion.
**Example:**
```typescript
// After pullModelIfMissing:
process.stderr.write(`brain-cache: warming model ${profileWithVersion.embeddingModel} into VRAM...\n`);
const { embedBatchWithRetry } = await import('../services/embedder.js');
await embedBatchWithRetry(profileWithVersion.embeddingModel, ['warmup']);
process.stderr.write('brain-cache: model warm.\n');
```

### Pattern 6: Missing Model Fix Message in runDoctor (CLI-03)
**What:** Add Ollama model list check to `runDoctor` and print actionable fix if model is absent.
**When to use:** After confirming Ollama is running in `runDoctor`.
**Example:**
```typescript
import ollama from 'ollama';
// After Ollama running check:
if (running) {
  const list = await ollama.list();
  const modelPresent = list.models.some((m) => m.name.startsWith(saved.embeddingModel));
  if (!modelPresent) {
    process.stderr.write(
      `\nWarning: embedding model '${saved.embeddingModel}' is not present in Ollama.\n` +
      `Fix: run 'brain-cache init' to pull the model, or:\n` +
      `     ollama pull ${saved.embeddingModel}\n`
    );
  }
}
```

### Anti-Patterns to Avoid
- **Business logic in CLI handlers:** CLI actions call workflow functions only — no direct service calls inside `.action()` callbacks (exception: `status` is so read-only it may be acceptable, but a thin `runStatus` workflow is cleaner and testable).
- **stdout for user-facing output:** All terminal output goes to `stderr`. `stdout` is reserved for MCP transport. This is already enforced by INF-04.
- **Blocking progress bars:** No external progress-bar libraries (e.g., `cli-progress`) — project constraint is no over-abstraction, no new deps. Use `\r` carriage return on stderr for in-place progress.
- **process.exit in CLI adapter layer:** `process.exit` calls belong in workflow functions, not in `.action()` callbacks.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Model warm-up logic | Custom warm-up service | `embedBatchWithRetry` with sentinel text | Already handles 120s timeout + cold-start retry; one string embed achieves VRAM load |
| Token savings calculation | New token counting service | `countChunkTokens` from `tokenCounter.ts` | Already imported by `buildContext.ts`; reuse same function |
| Index metadata reading | New file reader | `readIndexState` from `lancedb.ts` | Already validates Zod schema; returns typed `IndexState` |
| Progress bars | `cli-progress` or similar | `\r` carriage return on stderr | No new deps; simple and sufficient for a dev tool |

**Key insight:** Every service needed for Phase 5 already exists. The phase is exclusively about connecting existing services to the CLI surface with better output formatting.

## Common Pitfalls

### Pitfall 1: stdout vs stderr Output Confusion
**What goes wrong:** Writing progress or status output to `process.stdout.write` instead of `process.stderr.write`.
**Why it happens:** Default `console.log` goes to stdout. Easy mistake when adding quick output.
**How to avoid:** Always use `process.stderr.write` for all terminal output. Tests already assert `stdoutOutput.toHaveLength(0)` — if stdout receives anything, tests fail.
**Warning signs:** MCP server outputs corrupt JSON-RPC messages; test `produces zero output on stdout` fails.

### Pitfall 2: status Workflow Calling process.exit for Missing Index
**What goes wrong:** `runStatus` exits with code 1 when index is missing — this makes `status` non-runnable on a freshly-initialized machine.
**Why it happens:** Copying the guard pattern from `runIndex` without considering that `status` should gracefully report "not indexed yet".
**How to avoid:** `runStatus` should print a clear message like "No index found — run 'brain-cache index [path]' first" and exit 1 only when no profile exists (init not run). Missing index is an informational message, not a fatal error.

### Pitfall 3: \r Progress Overwrite Breaking Test Output Capture
**What goes wrong:** `\r`-based in-place progress works in a real terminal but causes confusing test assertions because `stderrOutput` array accumulates all writes including the `\r` lines.
**Why it happens:** `vi.spyOn(process.stderr, 'write')` captures every write call.
**How to avoid:** Tests for `runIndex` should use `toContain` on joined stderr output, not exact equality — the existing test pattern already does this. New tests for improved progress should check for final summary line presence, not absence of intermediate lines.

### Pitfall 4: Model Warm-Up Adding 13-46 Seconds to init
**What goes wrong:** Cold-starting a model for warm-up feels like a hang.
**Why it happens:** Ollama loads models from disk to VRAM (13-46s for large models).
**How to avoid:** Print a clear "warming model into VRAM..." message before the embed call. `embedBatchWithRetry` has built-in 120s timeout, so this will not hang indefinitely. The status message is the only required mitigation.

### Pitfall 5: Token Savings Stats Requiring File Re-Read
**What goes wrong:** Computing real token savings in `runIndex` requires re-reading all indexed files (same as `runBuildContext`), adding I/O overhead at the end of an already expensive operation.
**Why it happens:** The success criterion says "prints token savings stats on completion".
**How to avoid:** A simpler approach — accumulate total token count per chunk during the chunking pass (using `countChunkTokens` on each chunk's content) and compare against the original file content already read in the chunking loop. This avoids a second read pass.

## Code Examples

Verified patterns from the existing codebase:

### Existing Progress Output Pattern (runIndex)
```typescript
// Source: src/workflows/index.ts lines 109-113
process.stderr.write(
  `brain-cache: embedded ${processedCount}/${allChunks.length} chunks\n`
);
```
Upgrade: replace `\n` with `\r` for in-place progress, add `\n` after loop.

### Existing Doctor Health Report Pattern
```typescript
// Source: src/workflows/doctor.ts lines 39-57
process.stderr.write(
  'brain-cache doctor\n' +
  '──────────────────\n' +
  `Saved profile:     ${PROFILE_PATH}\n` +
  // ...
);
```

### readIndexState Usage
```typescript
// Source: src/workflows/buildContext.ts lines 44-49
const indexState = await readIndexState(rootDir);
if (indexState === null) {
  process.stderr.write(`Error: No index found at ${rootDir}. Run 'brain-cache index' first.\n`);
  process.exit(1);
}
```

### pullModelIfMissing with Progress Callback
```typescript
// Source: src/services/ollama.ts lines 70-96
// onProgress callback: already defaults to stderr output
// Can call without callback for default behavior:
await pullModelIfMissing(embeddingModel);
// Or with custom callback for richer progress:
await pullModelIfMissing(embeddingModel, (status) => {
  process.stderr.write(`  Pulling: ${status}\r`);
});
```

### Dynamic Import Pattern for CLI Commands
```typescript
// Source: src/cli/index.ts lines 11-16 (established pattern)
.action(async () => {
  const { runInit } = await import('../workflows/init.js');
  await runInit();
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `console.log` for CLI output | `process.stderr.write` exclusively | Phase 1 (D-16) | stdout reserved for MCP stdio transport |
| Flat per-batch progress messages | Can upgrade to `\r` in-place percentage | Phase 5 | Better UX, same dependencies |

## Open Questions

1. **Token savings stats format for `braincache index`**
   - What we know: `buildContext.ts` computes `reductionPct` by summing file tokens and comparing to assembled context tokens.
   - What's unclear: `runIndex` doesn't have a query-specific reduction — it just indexes everything. "Token savings" in index context means: how many total tokens are in the codebase vs. how many tokens are in all chunks (compression ratio).
   - Recommendation: Report a "compression ratio" — total raw file tokens / total chunk tokens — as a proxy for token savings. This is honest and computable without per-query context. Example: "Indexed 142 files (48,200 tokens) → 1,204 chunks (31,800 tokens, 34% reduction)".

## Environment Availability

Step 2.6: SKIPPED — Phase 5 is purely code changes with no new external dependencies. All required tools (Ollama, LanceDB, Node.js) are already probed and used in prior phases.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 2.x |
| Config file | vitest.config.ts |
| Quick run command | `npm test -- --reporter=verbose` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CLI-01 | `runInit` warms model after pull | unit | `npm test -- --reporter=verbose tests/workflows/init.test.ts` | ✅ (extend existing) |
| CLI-02 | `runIndex` emits percentage progress + token savings stats | unit | `npm test -- --reporter=verbose tests/workflows/index.test.ts` | ✅ (extend existing) |
| CLI-03 | `runDoctor` includes model presence check with fix message | unit | `npm test -- --reporter=verbose tests/workflows/init.test.ts` | ✅ (extend existing) |
| CLI-04 | `runStatus` reports all 4 fields; exits cleanly when no index | unit | `npm test -- --reporter=verbose tests/workflows/status.test.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npm test`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/workflows/status.test.ts` — covers CLI-04 (new `runStatus` workflow)

*(Existing test files for init.test.ts and index.test.ts cover CLI-01, CLI-02, CLI-03 and will be extended in-place)*

## Sources

### Primary (HIGH confidence)
- `/workspace/src/cli/index.ts` — current CLI structure, all existing commands
- `/workspace/src/workflows/init.ts` — current init workflow (no warm-up step yet)
- `/workspace/src/workflows/index.ts` — current index workflow (bare stderr progress)
- `/workspace/src/workflows/doctor.ts` — current doctor workflow (no model-presence check)
- `/workspace/src/services/lancedb.ts` — `readIndexState` available for status command
- `/workspace/src/services/ollama.ts` — `pullModelIfMissing` progress callback exists
- `/workspace/src/services/embedder.ts` — `embedBatchWithRetry` usable as warm-up call
- `/workspace/.planning/STATE.md` — accumulated decisions, especially D-16 (stderr-only), thin-adapter pattern
- `/workspace/.planning/REQUIREMENTS.md` — CLI-01 through CLI-04 requirements

### Secondary (MEDIUM confidence)
- Commander 14 docs — `program.command().option().action()` patterns (consistent with existing usage)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all dependencies already in use; no new packages
- Architecture: HIGH — existing patterns well established; all services present
- Pitfalls: HIGH — derived from existing code decisions and test patterns in the repo

**Research date:** 2026-03-31
**Valid until:** 2026-04-30 (stable tech — Commander, Node.js, vitest all stable)
