# Phase 1: Foundation - Research

**Researched:** 2026-03-31
**Domain:** TypeScript project scaffold, pino stderr logging, hardware capability detection (NVIDIA/Apple Silicon), Ollama lifecycle management
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**VRAM Tier Thresholds**
- D-01: 3-tier system: `none/cpu` (no GPU or <2GB VRAM), `standard` (2-6GB, nomic-embed-text 768d), `large` (8GB+, mxbai-embed-large 1024d)
- D-02: Capability profile detected once during `brain-cache init` and cached to disk. Re-detection only via `brain-cache doctor` or explicit refresh.
- D-03: VRAM detection via `nvidia-smi --query-gpu=memory.total` for NVIDIA GPUs, with fallback to "no GPU" tier on non-NVIDIA or missing drivers
- D-04: Apple Silicon (Metal) GPU detection supported via `system_profiler SPDisplaysDataType` on macOS. Unified memory counts toward VRAM tier.

**Degradation Behavior**
- D-05: Ollama not installed = hard block. Print clear install instructions (brew install ollama / curl install script) and exit. brain-cache cannot function without Ollama.
- D-06: Ollama installed but not running = auto-start attempt. Try `ollama serve` in background, wait up to 5 seconds for readiness. If it fails, print "run `ollama serve`" message and exit.
- D-07: Required embedding model not pulled = auto-pull with progress output. Seamless first-run experience.
- D-08: CPU-only machines (no GPU detected) = still run embeddings locally on CPU. Warn user on first run that indexing will be slower without GPU. Do not defer to Claude API.

**Config & Profile Storage**
- D-09: Global config directory: `~/.brain-cache/`. Contains `config.json` (settings) and `profile.json` (capability profile).
- D-10: Profile format: JSON (`~/.brain-cache/profile.json`)
- D-11: Per-project data lives in `.brain-cache/` in the project root. Easy to `.gitignore`.
- D-12: `brain-cache init` is required before other commands work. Commands fail with "Run `brain-cache init` first" if no profile exists. No auto-init.

**Logging Strategy**
- D-13: Default log level: `warn`. Only warnings and errors on stderr during normal operation.
- D-14: Log level controlled via environment variable only: `BRAIN_CACHE_LOG=debug|info|warn|error`. No config file option, no CLI flags.
- D-15: Pino outputs structured JSON to stderr always. No pretty-printing mode. Use `| pino-pretty` in dev if needed.
- D-16: stdout is strictly reserved for MCP stdio transport. Zero non-MCP output on stdout under any circumstances.

**Naming**
- D-17: Project name is `brain-cache` (hyphenated). CLI command: `brain-cache`. Config dir: `~/.brain-cache/`. Project dir: `.brain-cache/`.

### Claude's Discretion
- Detection implementation details (exact parsing of nvidia-smi output, system_profiler fields)
- Profile.json schema design
- Pino configuration specifics (child loggers, serializers, etc.)

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| INF-01 | On first run, detect GPU availability, VRAM amount, and create a capability profile (tier, supported features) | NVIDIA nvidia-smi + Apple Silicon system_profiler detection patterns documented; profile.json schema recommended below |
| INF-02 | Gracefully degrade on machines without GPU — fall back to CPU embeddings | CPU-only tier (`none/cpu`) in VRAM tier system; pino warning pattern for slow-CPU notice documented |
| INF-03 | Embedding model auto-selected based on detected VRAM tier | Tier-to-model mapping table documented; locked by D-01 decisions |
| INF-04 | All logging uses stderr exclusively — stdout reserved for MCP stdio transport | pino `destination(2)` / `process.stderr` pattern verified; env var log level pattern documented |
</phase_requirements>

---

## Summary

Phase 1 establishes the irreversible structural decisions that every subsequent phase builds on: project scaffold, stderr-only logging, hardware capability detection, and Ollama lifecycle management. Getting these wrong (especially stdout contamination) causes silent, hard-to-diagnose failures in Phase 4 MCP transport.

The technical work falls into four distinct areas. First, project scaffold: a TypeScript CLI with Commander, tsup for building, vitest for testing, and strict `"type": "module"` ESM setup. Second, pino logging wired exclusively to `process.stderr` with log level from `BRAIN_CACHE_LOG` env var. Third, hardware detection: NVIDIA via `nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits`, Apple Silicon via `system_profiler SPHardwareDataType -json` to extract total memory, mapping to the three VRAM tiers. Fourth, Ollama lifecycle: detect installed (`which ollama`), detect running (GET `http://localhost:11434`), auto-start with readiness poll, model pull via the `ollama` npm library's streaming pull API.

**Primary recommendation:** Build the capability detection service as a single `src/services/capability.ts` module with pure functions and no side effects. The `brain-cache init` command calls it, writes `~/.brain-cache/profile.json`, and subsequent commands read from that cache. This keeps the detection logic testable in isolation without requiring real hardware.

---

## Project Constraints (from CLAUDE.md)

All actionable directives that the planner must enforce:

| Directive | Constraint |
|-----------|------------|
| Runtime | Node.js 22.x LTS preferred; the dev environment currently has Node 20.20.2 — Wave 0 must add an `.nvmrc` or note the constraint |
| Language | TypeScript 5.x required |
| Vector DB | `@lancedb/lancedb` only — no ChromaDB, no hnswlib, no pgvector |
| Local LLM | `ollama` npm only — no direct HTTP fetch hand-rolling |
| CLI | `commander` only — no oclif, no yargs |
| Logging | `pino` only — no winston, no console.log on stdout under any circumstances |
| Testing | `vitest` only — no jest, no mocha |
| Build | `tsup` for production; `tsx` for dev only |
| Validation | `zod` v4 only (not v3) |
| Forbidden | `langchain`, `llamaindex`, `vercel ai sdk`, `ts-node`, `vectordb` (old LanceDB), `chalk` v5+ in CJS, Postgres, Redis |
| Architecture | `src/workflows/`, `src/services/`, `src/tools/`, `src/cli/`, `src/lib/` strict folder layout |
| Complexity | No over-abstraction, no premature generalization |

---

## Standard Stack

### Core (Phase 1 specific)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `pino` | 10.3.1 | Structured JSON logging to stderr | 5x faster than Winston; JSON by default; `pino.destination(2)` routes cleanly to stderr |
| `commander` | 14.0.3 | CLI command parsing | 500M+ downloads/week; zero startup overhead; clean TypeScript types |
| `tsx` | 4.21.0 | Dev-time TypeScript runner | Replaces ts-node (which has broken ESM support in Node 20+) |
| `tsup` | 8.5.1 | Build/bundle | Produces CJS + ESM + `.d.ts`; handles shebang insertion |
| `vitest` | 4.1.2 | Testing | Native TypeScript + ESM; zero Babel config |
| `typescript` | 6.0.2 | Language | Type-safe; required for MCP tool schemas and LanceDB types in later phases |
| `@types/node` | 25.5.0 | Node.js type definitions | Required for `child_process`, `fs`, `os`, `path` types |

> **Version note:** All versions verified against npm registry on 2026-03-31.

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `pino-pretty` | latest (devDep) | Human-readable pino output | Pipe stderr through it in dev: `brain-cache init 2>&1 \| pino-pretty` — never used in production code |
| `zod` | 4.3.6 | Schema validation | Profile.json validation on load; CLI input validation; required for MCP tool schemas in Phase 4 |

**Installation:**
```bash
npm install pino commander zod
npm install --save-dev typescript tsx tsup vitest @types/node pino-pretty
```

**Version verification:** Verified on 2026-03-31 via `npm view [package] version`.

---

## Architecture Patterns

### Recommended Project Structure
```
brain-cache/
├── src/
│   ├── cli/              # Commander command definitions — thin adapters only
│   │   └── index.ts      # Root program, registers subcommands
│   ├── services/         # Stateless, pure-function business logic
│   │   ├── capability.ts # Hardware detection + capability profile
│   │   ├── ollama.ts     # Ollama lifecycle management (detect, start, pull)
│   │   └── logger.ts     # Pino instance factory — single source of truth
│   ├── workflows/        # Orchestration — calls services in sequence
│   │   └── init.ts       # brain-cache init workflow
│   ├── lib/              # Shared utilities, types, constants
│   │   ├── types.ts      # Shared TypeScript types (CapabilityProfile, VRAMTier, etc.)
│   │   └── config.ts     # Config path constants (~/.brain-cache/)
│   └── tools/            # (Phase 4) MCP tool definitions
├── tests/
│   ├── services/
│   │   ├── capability.test.ts
│   │   └── ollama.test.ts
│   └── workflows/
│       └── init.test.ts
├── dist/                 # tsup output (gitignored)
├── package.json
├── tsconfig.json
├── tsup.config.ts
└── vitest.config.ts
```

### Pattern 1: Stderr-Only Logging with Pino

**What:** All log output goes to stderr (file descriptor 2) via pino's `destination` option. The env var `BRAIN_CACHE_LOG` controls log level at runtime.

**When to use:** Every log statement in the entire codebase. No module may use `console.log` or write to stdout.

**Example:**
```typescript
// Source: pinojs/pino docs/api.md + betterstack guide (verified)
// src/services/logger.ts
import pino from 'pino';

const LOG_LEVEL = process.env.BRAIN_CACHE_LOG ?? 'warn';

export const logger = pino(
  { level: LOG_LEVEL },
  pino.destination(2) // file descriptor 2 = stderr, always
);

// Usage: child loggers for component context
export function childLogger(component: string) {
  return logger.child({ component });
}
```

**Critical:** `pino.destination(2)` ensures stderr even if `process.stderr` is redirected. Do NOT use `console.log`, `console.error`, or `process.stdout.write` anywhere.

### Pattern 2: Hardware Detection with Child Process

**What:** Use `child_process.execFile` (not `exec`) to call `nvidia-smi` and `system_profiler` — `execFile` avoids shell injection and is faster.

**When to use:** During `brain-cache init` and `brain-cache doctor`. Results cached to `~/.brain-cache/profile.json`.

**Example:**
```typescript
// Source: NVIDIA nvidia-smi docs + Node.js child_process docs (verified)
// src/services/capability.ts
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// NVIDIA detection
export async function detectNvidiaVRAM(): Promise<number | null> {
  try {
    // --format=csv,noheader,nounits returns plain integer in MiB
    const { stdout } = await execFileAsync('nvidia-smi', [
      '--query-gpu=memory.total',
      '--format=csv,noheader,nounits'
    ]);
    const mib = parseInt(stdout.trim().split('\n')[0], 10);
    return isNaN(mib) ? null : Math.round(mib / 1024); // convert to GiB
  } catch {
    return null; // nvidia-smi not found or no NVIDIA GPU
  }
}

// Apple Silicon detection — unified memory is total system RAM
export async function detectAppleSiliconVRAM(): Promise<number | null> {
  if (process.platform !== 'darwin') return null;
  try {
    const { stdout } = await execFileAsync('system_profiler', [
      'SPHardwareDataType', '-json'
    ]);
    const data = JSON.parse(stdout);
    // Field: SPHardwareDataType[0].physical_memory e.g. "16 GB"
    const memStr: string = data?.SPHardwareDataType?.[0]?.physical_memory ?? '';
    const match = memStr.match(/^(\d+)\s*GB/i);
    return match ? parseInt(match[1], 10) : null;
  } catch {
    return null;
  }
}
```

**Confidence note:** `SPHardwareDataType[0].physical_memory` field name is MEDIUM confidence — verified from community sources but not official Apple docs. Add a fallback to text parsing if JSON parse fails.

### Pattern 3: VRAM Tier Mapping

**What:** Convert raw GiB to the three-tier enum. This function is pure and easily unit-testable.

```typescript
// src/lib/types.ts
export type VRAMTier = 'none' | 'standard' | 'large';

// src/services/capability.ts
export function classifyVRAMTier(vramGiB: number | null): VRAMTier {
  if (vramGiB === null || vramGiB < 2) return 'none';
  if (vramGiB < 8) return 'standard';   // 2–7 GiB inclusive
  return 'large';                         // 8 GiB+
}

export function selectEmbeddingModel(tier: VRAMTier): string {
  const models: Record<VRAMTier, string> = {
    none:     'nomic-embed-text',  // CPU-safe, smaller
    standard: 'nomic-embed-text',  // 768d, ~500MB VRAM
    large:    'mxbai-embed-large', // 1024d, ~670MB VRAM
  };
  return models[tier];
}
```

### Pattern 4: Ollama Lifecycle Management

**What:** Detect if `ollama` binary exists → detect if server is running → auto-start if not → poll readiness → pull model if missing.

**When to use:** `brain-cache init` workflow, beginning of every embedding operation in later phases.

**Example:**
```typescript
// Source: ollama/ollama GitHub issue #3341 + ollama-js README (verified)
// src/services/ollama.ts
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { spawn } from 'node:child_process';
import ollama from 'ollama';

const execFileAsync = promisify(execFile);

// Step 1: Is ollama binary installed?
export async function isOllamaInstalled(): Promise<boolean> {
  try {
    await execFileAsync('which', ['ollama']); // Unix
    return true;
  } catch {
    // Windows: try 'where ollama'
    try {
      await execFileAsync('where', ['ollama']);
      return true;
    } catch {
      return false;
    }
  }
}

// Step 2: Is ollama server responding?
export async function isOllamaRunning(): Promise<boolean> {
  try {
    // GET http://localhost:11434 returns 200 "Ollama is running" when ready
    const res = await fetch('http://localhost:11434');
    return res.ok;
  } catch {
    return false;
  }
}

// Step 3: Auto-start ollama serve and poll readiness (up to 5s)
export async function startOllama(): Promise<boolean> {
  // Detach: child process outlives the current process
  const child = spawn('ollama', ['serve'], {
    detached: true,
    stdio: 'ignore'
  });
  child.unref();

  // Poll GET / every 500ms for 5 seconds
  for (let i = 0; i < 10; i++) {
    await new Promise(r => setTimeout(r, 500));
    if (await isOllamaRunning()) return true;
  }
  return false;
}

// Step 4: Pull model with streaming progress
export async function pullModelIfMissing(model: string): Promise<void> {
  const list = await ollama.list();
  const exists = list.models.some(m => m.name.startsWith(model));
  if (exists) return;

  // stream: true returns AsyncGenerator of ProgressResponse
  const stream = await ollama.pull({ model, stream: true });
  for await (const progress of stream) {
    // progress.status, progress.completed, progress.total available
    // Write progress to stderr via logger or process.stderr.write
    process.stderr.write(`Pulling ${model}: ${progress.status}\n`);
  }
}
```

### Pattern 5: Profile.json Schema

**What:** Capability profile written by `init`, read by all subsequent commands.

```typescript
// src/lib/types.ts
import { z } from 'zod/v4';  // Note: zod v4 import path

export const CapabilityProfileSchema = z.object({
  version:        z.literal(1),
  detectedAt:     z.string().datetime(),
  vramTier:       z.enum(['none', 'standard', 'large']),
  vramGiB:        z.number().nullable(),
  gpuVendor:      z.enum(['nvidia', 'apple', 'none']),
  embeddingModel: z.string(),
  ollamaVersion:  z.string().nullable(),
  platform:       z.string(),
});

export type CapabilityProfile = z.infer<typeof CapabilityProfileSchema>;
```

### Anti-Patterns to Avoid

- **`console.log` in any module:** Contaminates stdout, breaks MCP stdio in Phase 4. Always use the pino logger instead.
- **`console.error` in any module:** Although this writes to stderr, it bypasses pino's structured JSON and level filtering. Use `logger.error()` instead.
- **Running `nvidia-smi` with `exec` (shell):** Use `execFile` to avoid shell injection and unnecessary shell process overhead.
- **Synchronous file reads in service modules:** Use `fs/promises` exclusively to avoid blocking the event loop.
- **Storing profile in per-project `.brain-cache/`:** Profile is global (hardware doesn't change per project) — goes in `~/.brain-cache/profile.json` per D-09.
- **Auto-init on unknown commands:** D-12 is explicit: no auto-init. Fail with a clear message and exit code 1.
- **Mixing detection logic with CLI output:** Keep `capability.ts` purely functional — it returns data. The `init` workflow or CLI layer decides what to print (to stderr).

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Structured JSON logging to stderr | Custom `console.error(JSON.stringify(...))` wrapper | `pino` with `destination(2)` | pino handles level filtering, serializers, child loggers, async flush, and is 5x faster |
| Schema validation for profile.json | Manual property checks | `zod` v4 schema | Zod gives type inference, parse errors with paths, and safe parse for graceful degradation |
| Ollama model pull | Raw `fetch` to `/api/pull` with streaming | `ollama` npm library | Official library handles streaming, retries, connection pooling, and TypeScript types |
| TypeScript build pipeline | Custom esbuild config | `tsup` | tsup handles shebang insertion, dual CJS/ESM output, `.d.ts` generation, and tree-shaking |
| Dev TypeScript runner | `ts-node` | `tsx` | ts-node has broken ESM support in Node 20+; tsx is the maintained successor |

**Key insight:** This phase is entirely infrastructure — every custom solution competes with a battle-tested library that handles the exact edge cases you'll hit. The value is in the wiring, not the building.

---

## Common Pitfalls

### Pitfall 1: stdout Contamination Before MCP Phase
**What goes wrong:** A `console.log` or `process.stdout.write` call in any shared module corrupts the MCP JSON-RPC stdio transport in Phase 4. This produces silent failures where Claude Code receives garbled tool responses.
**Why it happens:** Developers add debugging output during Phase 1 development and forget to remove it. Or a library dependency writes to stdout.
**How to avoid:** Wire pino to `pino.destination(2)` from day one. Enforce with an ESLint rule: `no-console`. Never use `console.log` or `console.error` anywhere.
**Warning signs:** Any output on stdout during `brain-cache doctor` or other non-init commands.

### Pitfall 2: nvidia-smi Timing Out
**What goes wrong:** `nvidia-smi` hangs or takes 10+ seconds on some machines with driver issues. Detection blocks the entire init flow.
**Why it happens:** Driver not fully loaded, NVML initialization failure on headless servers.
**How to avoid:** Set a timeout on the `execFile` call (2-3 seconds is sufficient). Use the `{ timeout: 3000 }` option in `execFile`. On timeout, fall back to "no GPU" tier and log a warning.
**Warning signs:** `brain-cache init` hanging indefinitely.

### Pitfall 3: Apple Silicon VRAM Field Parsing Failure
**What goes wrong:** `system_profiler SPHardwareDataType -json` field structure differs between macOS versions or the chip-type check for M-series chips fails.
**Why it happens:** `physical_memory` field is in `SPHardwareDataType[0]` on Apple Silicon but the format "16 GB" requires regex parsing. On Intel Macs, there's no unified GPU memory — the field reads RAM, not VRAM.
**How to avoid:** (1) Check if chip type is Apple Silicon before using total RAM as VRAM proxy. The `chip_type` field contains "Apple M" on M-series chips. (2) Fall back to text-format `system_profiler SPHardwareDataType` (without `-json`) if JSON parse fails. (3) On Intel Mac with dedicated GPU, fall back to "none" tier (Intel Macs are not the target demographic).
**Warning signs:** Profile shows wrong tier on Apple Silicon; `vramGiB` is null on M-series Mac.

### Pitfall 4: Ollama Auto-Start Race Condition
**What goes wrong:** `ollama serve` is spawned in background, readiness polling starts too fast, and the 5-second limit expires before Ollama finishes loading large models from disk.
**Why it happens:** Model warm-up (disk → VRAM) can take 13–46 seconds on slower hardware. The readiness poll checks HTTP availability (fast) but not model readiness (slow). For Phase 1, we only need HTTP availability — model warm-up is a Phase 2 concern.
**How to avoid:** Poll `GET http://localhost:11434` for HTTP availability (sufficient for Phase 1). The 5-second limit covers process startup time, not model load time. Document this distinction clearly in the code.
**Warning signs:** Timeout on `brain-cache init` on machines with slow storage.

### Pitfall 5: Zod v4 Import Path
**What goes wrong:** `import { z } from 'zod'` may resolve to v3 if both are present, or fail with v4 because the recommended import changed.
**Why it happens:** Zod v4 changed some import paths and the `zod/v4` subpath export is the canonical v4 import in some configurations.
**How to avoid:** Use `import { z } from 'zod'` — v4 is the default export from the `zod` package when installed as v4.x. Verify with `npm view zod version`.
**Warning signs:** Type errors on `z.enum` or `z.object` not matching v4 API.

### Pitfall 6: Node.js Version Mismatch
**What goes wrong:** CLAUDE.md specifies Node.js 22.x LTS; the dev environment has Node.js 20.20.2. Native strip-types (run TypeScript without a build step) requires Node 22.18+.
**Why it happens:** Dev container built before Node 22 LTS.
**How to avoid:** Add `.nvmrc` with `22` and document in README. For Wave 0, use `tsx` for dev runner and `tsup` for production build — both work on Node 20+. Native strip-types is a nice-to-have, not a requirement.
**Warning signs:** `--strip-types` flag errors on Node 20.

---

## Code Examples

Verified patterns from official sources:

### Logger Factory (single source of truth)
```typescript
// Source: pinojs/pino docs/api.md (verified via WebFetch)
// src/services/logger.ts
import pino from 'pino';

const VALID_LEVELS = ['debug', 'info', 'warn', 'error', 'silent'] as const;
type LogLevel = typeof VALID_LEVELS[number];

function resolveLevel(): LogLevel {
  const env = process.env.BRAIN_CACHE_LOG?.toLowerCase();
  return VALID_LEVELS.includes(env as LogLevel) ? (env as LogLevel) : 'warn';
}

export const logger = pino(
  { level: resolveLevel() },
  pino.destination(2) // stderr, always
);
```

### Profile Read/Write with Zod Validation
```typescript
// src/lib/config.ts
import { homedir } from 'node:os';
import { join } from 'node:path';

export const GLOBAL_CONFIG_DIR = join(homedir(), '.brain-cache');
export const PROFILE_PATH = join(GLOBAL_CONFIG_DIR, 'profile.json');
export const CONFIG_PATH = join(GLOBAL_CONFIG_DIR, 'config.json');

// src/services/capability.ts (profile persistence)
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { CapabilityProfileSchema, type CapabilityProfile } from '../lib/types.js';
import { GLOBAL_CONFIG_DIR, PROFILE_PATH } from '../lib/config.js';

export async function readProfile(): Promise<CapabilityProfile | null> {
  try {
    const raw = await readFile(PROFILE_PATH, 'utf-8');
    return CapabilityProfileSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function writeProfile(profile: CapabilityProfile): Promise<void> {
  await mkdir(GLOBAL_CONFIG_DIR, { recursive: true });
  await writeFile(PROFILE_PATH, JSON.stringify(profile, null, 2), 'utf-8');
}
```

### Commander CLI Wiring
```typescript
// Source: LogRocket TypeScript Commander guide (verified via WebFetch)
// src/cli/index.ts
#!/usr/bin/env node
import { Command } from 'commander';

const program = new Command();

program
  .name('brain-cache')
  .description('Local AI runtime — cache layer for Claude')
  .version('0.1.0');

program
  .command('init')
  .description('Detect hardware, pull embedding model, create config directory')
  .action(async () => {
    const { runInit } = await import('../workflows/init.js');
    await runInit();
  });

program
  .command('doctor')
  .description('Report system health: GPU, VRAM tier, Ollama status')
  .action(async () => {
    const { runDoctor } = await import('../workflows/doctor.js');
    await runDoctor();
  });

program.parse();
```

### tsup Configuration for CLI Binary
```typescript
// tsup.config.ts
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { cli: 'src/cli/index.ts' },
  format: ['esm'],
  target: 'node20',
  outDir: 'dist',
  clean: true,
  dts: true,
  banner: {
    js: '#!/usr/bin/env node',  // shebang for the CLI binary
  },
});
```

### package.json bin field
```json
{
  "name": "brain-cache",
  "version": "0.1.0",
  "type": "module",
  "bin": {
    "brain-cache": "./dist/cli.js"
  },
  "scripts": {
    "dev": "tsx src/cli/index.ts",
    "build": "tsup",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

### Vitest Configuration
```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `ts-node` for TypeScript execution | `tsx` (esbuild-backed) | ~2022 | ts-node broken with ESM in Node 20+; tsx is drop-in replacement |
| `winston` for Node logging | `pino` | ~2019-2021 | 5x faster; JSON-first; better for background services |
| Jest for TypeScript testing | `vitest` | ~2022-2023 | Native ESM; 10-20x faster; no Babel config |
| Zod v3 | Zod v4 | May 2025 | 14x faster parsing; smaller bundle; stable |
| Manual nvidia-smi XML parse | CSV format with `--format=csv,noheader,nounits` | Stable | Much simpler: one integer per line, no XML library needed |

**Deprecated/outdated:**
- `ts-node`: Broken ESM support in Node 20+; use `tsx`
- `vectordb` (old LanceDB package): Replaced by `@lancedb/lancedb`
- Zod v3: Superseded by v4 (stable as of 2025)

---

## Open Questions

1. **Apple Silicon `system_profiler` JSON field for physical_memory**
   - What we know: `SPHardwareDataType[0].physical_memory` returns `"16 GB"` format on M-series Macs (community-verified)
   - What's unclear: Whether `chip_type` field reliably distinguishes Apple Silicon from Intel to know whether to treat RAM as VRAM
   - Recommendation: Parse text output as fallback (`system_profiler SPHardwareDataType` without `-json`), look for "Chip:" line containing "Apple M". If found, use RAM as VRAM proxy. This is LOW confidence — test on actual Apple Silicon hardware during implementation.

2. **Windows support**
   - What we know: CLAUDE.md does not mention Windows; Apple Silicon + NVIDIA are the two GPU targets
   - What's unclear: Whether `which ollama` fallback to `where ollama` for Windows is needed
   - Recommendation: Detect Windows via `process.platform === 'win32'` and use `where` instead of `which`. Low implementation cost, avoids "not found" failures for Windows developers.

3. **Ollama `pull` progress output on stderr**
   - What we know: The `ollama` npm library's `pull({ stream: true })` returns an AsyncGenerator of `ProgressResponse`
   - What's unclear: Whether writing progress directly to `process.stderr.write` is acceptable for Phase 1 (since the logger doesn't have a progress format)
   - Recommendation: For Phase 1, use `process.stderr.write` for model pull progress lines (not JSON log lines). This is the only acceptable stderr non-JSON output since it's during the interactive `init` flow, not in a background daemon context.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | All | ✓ | 20.20.2 (dev env) | — |
| npm | Package management | ✓ | 10.8.2 | — |
| ollama CLI | Capability detection, model pull | ✗ | — | Hard block per D-05; include install instructions in error message |
| nvidia-smi | NVIDIA GPU detection | ✗ | — | Fall back to "no GPU" tier (expected on dev container) |
| system_profiler | Apple Silicon detection | ✗ (Linux container) | — | Fall back to "no GPU" tier (macOS-only) |

**Node.js version note:** Dev environment has Node 20.20.2; CLAUDE.md requires 22.x LTS. Add `.nvmrc` with `22` in Wave 0. All tooling (tsx, tsup, vitest) works on Node 20, so this does not block Phase 1. Native `--strip-types` (requires 22.18+) is not used in this phase.

**Missing dependencies with no fallback:**
- `ollama` binary: Required per D-05. Plans must include an error path that prints install instructions to stderr and exits non-zero.

**Missing dependencies with fallback:**
- `nvidia-smi`: Expected to be absent on most dev machines. Graceful fallback to `none` tier is the designed behavior.
- `system_profiler`: Linux/Windows machines do not have it. `null` return from `detectAppleSiliconVRAM()` falls through to `none` tier.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.1.2 |
| Config file | `vitest.config.ts` (Wave 0 gap — does not exist yet) |
| Quick run command | `npx vitest run --reporter=verbose` |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| INF-01 | `detectNvidiaVRAM()` returns number or null | unit | `npx vitest run tests/services/capability.test.ts` | ❌ Wave 0 |
| INF-01 | `detectAppleSiliconVRAM()` returns number or null | unit | `npx vitest run tests/services/capability.test.ts` | ❌ Wave 0 |
| INF-01 | `classifyVRAMTier()` maps values to correct tier | unit | `npx vitest run tests/services/capability.test.ts` | ❌ Wave 0 |
| INF-01 | `writeProfile()` creates valid JSON at correct path | unit | `npx vitest run tests/services/capability.test.ts` | ❌ Wave 0 |
| INF-01 | `readProfile()` parses and validates profile schema | unit | `npx vitest run tests/services/capability.test.ts` | ❌ Wave 0 |
| INF-02 | `classifyVRAMTier(null)` returns `'none'` | unit | `npx vitest run tests/services/capability.test.ts` | ❌ Wave 0 |
| INF-02 | `selectEmbeddingModel('none')` returns `nomic-embed-text` | unit | `npx vitest run tests/services/capability.test.ts` | ❌ Wave 0 |
| INF-03 | `selectEmbeddingModel('standard')` returns `nomic-embed-text` | unit | `npx vitest run tests/services/capability.test.ts` | ❌ Wave 0 |
| INF-03 | `selectEmbeddingModel('large')` returns `mxbai-embed-large` | unit | `npx vitest run tests/services/capability.test.ts` | ❌ Wave 0 |
| INF-04 | logger writes to stderr (fd 2), not stdout | unit | `npx vitest run tests/services/logger.test.ts` | ❌ Wave 0 |
| INF-04 | `BRAIN_CACHE_LOG=debug` sets logger level to debug | unit | `npx vitest run tests/services/logger.test.ts` | ❌ Wave 0 |
| INF-04 | default log level is `warn` when env var unset | unit | `npx vitest run tests/services/logger.test.ts` | ❌ Wave 0 |

**Note on testing hardware detection:** `detectNvidiaVRAM()` and `detectAppleSiliconVRAM()` must be tested by mocking `child_process.execFile`. Vitest supports `vi.mock('node:child_process')` for this. The tier classification and model selection functions are pure and require no mocking.

**Note on logger stderr test:** To verify pino writes to fd 2, spy on `pino.destination` or capture the destination argument in the logger factory. Avoid testing against actual fd 2 in unit tests — test the configuration, not the I/O.

### Sampling Rate
- **Per task commit:** `npx vitest run tests/services/capability.test.ts tests/services/logger.test.ts`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/services/capability.test.ts` — covers INF-01, INF-02, INF-03
- [ ] `tests/services/logger.test.ts` — covers INF-04
- [ ] `tests/services/ollama.test.ts` — covers Ollama lifecycle (isOllamaInstalled, isOllamaRunning, startOllama)
- [ ] `vitest.config.ts` — test framework config
- [ ] `tsconfig.json` — TypeScript compiler config
- [ ] `tsup.config.ts` — build config
- [ ] `package.json` — project manifest with bin field and scripts
- [ ] `.nvmrc` — Node.js version pin (`22`)
- [ ] Framework install: `npm install --save-dev vitest typescript tsx tsup @types/node`

---

## Sources

### Primary (HIGH confidence)
- pinojs/pino `docs/api.md` (WebFetch from raw.githubusercontent.com) — constructor signature, `destination(2)`, child logger API
- pinojs/pino issues/820 + betterstack guide — stderr destination patterns, env var log level
- ollama/ollama GitHub issue #3341 — readiness polling strategy, endpoint `GET /`
- ollama/ollama-js README (WebFetch) — `pull()` streaming API, `list()` API
- NVIDIA nvidia-smi docs — `--query-gpu=memory.total --format=csv,noheader,nounits` output format
- LogRocket Commander TypeScript guide — bin field, shebang, tsconfig baseline
- npm registry: `npm view [package] version` — all version numbers verified 2026-03-31

### Secondary (MEDIUM confidence)
- community sources on `system_profiler SPHardwareDataType -json` field `physical_memory` — Apple Silicon unified memory
- tsup documentation — CLI shebang via `banner.js` option
- WebSearch: ollama auto-start spawn pattern with `detached: true, stdio: 'ignore'`

### Tertiary (LOW confidence)
- Apple Silicon `chip_type` field in `system_profiler` JSON — field name not confirmed against official Apple docs; flag for validation on real macOS hardware

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all versions verified against npm registry on 2026-03-31
- Architecture: HIGH — patterns align with CLAUDE.md directives and established Node.js CLI conventions
- Pino stderr logging: HIGH — verified from official pino docs
- NVIDIA detection: HIGH — nvidia-smi CSV format is stable and well-documented
- Apple Silicon detection: MEDIUM — field name `physical_memory` is community-verified, not official Apple docs
- Ollama lifecycle: HIGH — verified from ollama/ollama GitHub issues and ollama-js README
- Pitfalls: HIGH — sourced from official docs and known ecosystem issues

**Research date:** 2026-03-31
**Valid until:** 2026-05-01 (stable stack; pino/commander/tsup are slow-moving)
