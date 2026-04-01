# Phase 1: Foundation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-03-31
**Phase:** 01-foundation
**Areas discussed:** VRAM tier thresholds, Degradation behavior, Config & profile storage, Logging strategy

---

## VRAM Tier Thresholds

| Option | Description | Selected |
|--------|-------------|----------|
| 3 tiers | none/cpu (<2GB), standard (2-6GB, nomic-embed-text), large (8GB+, mxbai-embed-large) | ✓ |
| 4 tiers | none/cpu, low (<4GB), mid (4-8GB), high (8GB+) | |
| 2 tiers | cpu-only and gpu | |

**User's choice:** 3 tiers
**Notes:** Maps directly to the two recommended embedding models in the tech stack

| Option | Description | Selected |
|--------|-------------|----------|
| Detect once, cache | Run detection during init, write to config. Re-detect on doctor or explicit refresh | ✓ |
| Detect every time | Check GPU/VRAM/Ollama on every command | |
| Cache with staleness check | Cache but re-detect if older than N hours | |

**User's choice:** Detect once, cache
**Notes:** Faster startup, hardware doesn't change often

| Option | Description | Selected |
|--------|-------------|----------|
| nvidia-smi + fallback | Parse nvidia-smi for NVIDIA, fall back to 'no GPU' otherwise | ✓ |
| Ollama API system info | Ask Ollama for GPU info via its API | |
| You decide | Let Claude pick | |

**User's choice:** nvidia-smi + fallback

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, detect Apple Silicon | Use system_profiler SPDisplaysDataType on macOS | ✓ |
| No, NVIDIA only | Mac users get CPU tier | |
| You decide | Let Claude determine | |

**User's choice:** Yes, detect Apple Silicon
**Notes:** Many Claude Code users are on Mac

---

## Degradation Behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Hard block with fix instructions | Refuse to run, print install instructions | ✓ |
| Deferred mode | Defer embedding work to Claude API | |
| You decide | Let Claude pick | |

**User's choice:** Hard block with fix instructions
**Notes:** brain-cache can't function without Ollama

| Option | Description | Selected |
|--------|-------------|----------|
| Auto-start attempt | Try ollama serve in background, wait 5s | ✓ |
| Just tell the user | Print message and exit | |
| You decide | Let Claude determine | |

**User's choice:** Auto-start attempt

| Option | Description | Selected |
|--------|-------------|----------|
| Auto-pull with progress | Automatically pull model with progress output | ✓ |
| Prompt user to pull | Print command and exit | |
| You decide | Let Claude determine | |

**User's choice:** Auto-pull with progress

| Option | Description | Selected |
|--------|-------------|----------|
| Run on CPU, warn about speed | Ollama runs on CPU, warn user about slower indexing | ✓ |
| Skip local, defer to Claude | Don't attempt CPU embeddings | |
| Let user choose at init | Ask during init | |

**User's choice:** Run on CPU, warn about speed

---

## Config & Profile Storage

| Option | Description | Selected |
|--------|-------------|----------|
| ~/.brain-cache/ | Global config in user home | ✓ |
| XDG directories | Follow XDG spec | |
| .brain-cache/ in project root | Everything in project directory | |
| You decide | Let Claude pick | |

**User's choice:** ~/.brain-cache/

| Option | Description | Selected |
|--------|-------------|----------|
| JSON | ~/.brain-cache/profile.json | ✓ |
| TOML | ~/.brain-cache/profile.toml | |
| You decide | Let Claude pick | |

**User's choice:** JSON

| Option | Description | Selected |
|--------|-------------|----------|
| .brain-cache/ in project root | Indexes live next to the code | ✓ |
| ~/.brain-cache/projects/<hash>/ | All project data in global directory | |
| You decide | Let Claude determine | |

**User's choice:** .brain-cache/ in project root

| Option | Description | Selected |
|--------|-------------|----------|
| Explicit init required | Must run brain-cache init first | ✓ |
| Auto-init on first use | Any command triggers init | |
| You decide | Let Claude pick | |

**User's choice:** Explicit init required

---

## Logging Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| warn | Only warnings and errors by default | ✓ |
| info | Info-level by default | |
| silent by default | No output unless enabled | |

**User's choice:** warn

| Option | Description | Selected |
|--------|-------------|----------|
| Env var only | BRAIN_CACHE_LOG=debug\|info\|warn\|error | ✓ |
| Env var + config file | Env var overrides config | |
| CLI flag --verbose / --debug | Per-command verbosity flags | |

**User's choice:** Env var only

| Option | Description | Selected |
|--------|-------------|----------|
| JSON always | Structured JSON on stderr | ✓ |
| Pretty in dev, JSON in prod | Auto-switch based on NODE_ENV or TTY | |
| You decide | Let Claude pick | |

**User's choice:** JSON always

---

## Claude's Discretion

- Detection implementation details (nvidia-smi parsing, system_profiler fields)
- Profile.json schema design
- Pino configuration specifics

## Deferred Ideas

None — discussion stayed within phase scope
