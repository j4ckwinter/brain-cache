# Phase 1: Foundation - Context

**Gathered:** 2026-03-31
**Status:** Ready for planning

<domain>
## Phase Boundary

Establish the brain-cache project scaffold, stderr-only logging via pino, and hardware capability detection (GPU, VRAM, Ollama). This phase delivers the foundation that all subsequent phases build on — no indexing, retrieval, or MCP work happens here.

</domain>

<decisions>
## Implementation Decisions

### VRAM Tier Thresholds
- **D-01:** 3-tier system: `none/cpu` (no GPU or <2GB VRAM), `standard` (2-6GB, nomic-embed-text 768d), `large` (8GB+, mxbai-embed-large 1024d)
- **D-02:** Capability profile detected once during `brain-cache init` and cached to disk. Re-detection only via `brain-cache doctor` or explicit refresh.
- **D-03:** VRAM detection via `nvidia-smi --query-gpu=memory.total` for NVIDIA GPUs, with fallback to "no GPU" tier on non-NVIDIA or missing drivers
- **D-04:** Apple Silicon (Metal) GPU detection supported via `system_profiler SPDisplaysDataType` on macOS. Unified memory counts toward VRAM tier.

### Degradation Behavior
- **D-05:** Ollama not installed = hard block. Print clear install instructions (brew install ollama / curl install script) and exit. brain-cache cannot function without Ollama.
- **D-06:** Ollama installed but not running = auto-start attempt. Try `ollama serve` in background, wait up to 5 seconds for readiness. If it fails, print "run `ollama serve`" message and exit.
- **D-07:** Required embedding model not pulled = auto-pull with progress output. Seamless first-run experience — user doesn't need to know model names.
- **D-08:** CPU-only machines (no GPU detected) = still run embeddings locally on CPU. Warn user on first run that indexing will be slower without GPU. Do not defer to Claude API.

### Config & Profile Storage
- **D-09:** Global config directory: `~/.brain-cache/`. Contains `config.json` (settings) and `profile.json` (capability profile).
- **D-10:** Profile format: JSON (`~/.brain-cache/profile.json`)
- **D-11:** Per-project data lives in `.brain-cache/` in the project root (e.g., `.brain-cache/index/` for LanceDB). Easy to `.gitignore`.
- **D-12:** `brain-cache init` is required before other commands work. Commands fail with "Run `brain-cache init` first" if no profile exists. No auto-init.

### Logging Strategy
- **D-13:** Default log level: `warn`. Only warnings and errors on stderr during normal operation.
- **D-14:** Log level controlled via environment variable only: `BRAIN_CACHE_LOG=debug|info|warn|error`. No config file option, no CLI flags.
- **D-15:** Pino outputs structured JSON to stderr always. No pretty-printing mode. Use `| pino-pretty` in dev if needed.
- **D-16:** stdout is strictly reserved for MCP stdio transport. Zero non-MCP output on stdout under any circumstances.

### Naming
- **D-17:** Project name is `brain-cache` (hyphenated), not "braincache". CLI command: `brain-cache`. Config dir: `~/.brain-cache/`. Project dir: `.brain-cache/`.

### Claude's Discretion
- Detection implementation details (exact parsing of nvidia-smi output, system_profiler fields)
- Profile.json schema design
- Pino configuration specifics (child loggers, serializers, etc.)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

No external specs — requirements fully captured in decisions above and in:

### Project Context
- `.planning/PROJECT.md` — Project vision, constraints, architecture philosophy
- `.planning/REQUIREMENTS.md` — INF-01 through INF-04 are this phase's requirements
- `.planning/ROADMAP.md` — Phase 1 success criteria and dependencies

### Technology
- `CLAUDE.md` §Technology Stack — Recommended versions, embedding model specs, alternatives considered

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- None — greenfield project, no existing code

### Established Patterns
- None yet — this phase establishes the foundational patterns

### Integration Points
- This phase creates the capability detection service that Phase 2+ will import
- Logging setup created here is used by every subsequent module
- Config/profile paths established here are referenced by all phases

</code_context>

<specifics>
## Specific Ideas

- User specifically wants Apple Silicon support — many Claude Code developers are on Mac
- Auto-start Ollama and auto-pull models for frictionless first-run experience
- CPU fallback should work but warn — don't silently degrade

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 01-foundation*
*Context gathered: 2026-03-31*
