---
phase: 1
slug: foundation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-31
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | none — Wave 0 installs |
| **Quick run command** | `npx vitest run --reporter=verbose` |
| **Full suite command** | `npx vitest run --reporter=verbose` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --reporter=verbose`
- **After every plan wave:** Run `npx vitest run --reporter=verbose`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 1-01-01 | 01 | 1 | INF-01 | unit | `npx vitest run src/lib/__tests__/logger.test.ts` | ❌ W0 | ⬜ pending |
| 1-01-02 | 01 | 1 | INF-02 | unit | `npx vitest run src/services/__tests__/hardware.test.ts` | ❌ W0 | ⬜ pending |
| 1-01-03 | 01 | 1 | INF-03 | unit | `npx vitest run src/services/__tests__/capability.test.ts` | ❌ W0 | ⬜ pending |
| 1-01-04 | 01 | 1 | INF-04 | unit | `npx vitest run src/services/__tests__/model-selector.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `vitest` — install as dev dependency
- [ ] `vitest.config.ts` — configure for TypeScript + ESM
- [ ] Test stubs for INF-01 through INF-04

*Existing infrastructure does not cover phase requirements — Wave 0 is needed.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| GPU detection on real NVIDIA hardware | INF-02 | Requires physical GPU | Run `braincache doctor` on machine with NVIDIA GPU, verify VRAM tier reported |
| Apple Silicon detection | INF-02 | Requires macOS M-series | Run `braincache doctor` on M1/M2/M3 Mac, verify chip type and memory reported |
| Ollama reachability with real Ollama server | INF-02 | Requires running Ollama | Start Ollama, run `braincache doctor`, verify reachability and model status |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
