---
phase: 5
slug: cli-completion
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-31
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run --reporter=verbose` |
| **Full suite command** | `npx vitest run --reporter=verbose` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --reporter=verbose`
- **After every plan wave:** Run `npx vitest run --reporter=verbose`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 05-01-01 | 01 | 1 | CLI-03, CLI-04 | unit | `npx vitest run tests/workflows/status.test.ts tests/workflows/init.test.ts` | Partial W0 | pending |
| 05-02-01 | 02 | 2 | CLI-01, CLI-02 | unit | `npx vitest run tests/workflows/init.test.ts tests/workflows/index.test.ts` | Yes | pending |

*Status: pending / green / red / flaky*

---

## Wave 0 Requirements

- [ ] `tests/workflows/status.test.ts` — stubs for CLI-04 status command

*(Doctor tests for CLI-03 are added to the existing `tests/workflows/init.test.ts` file — no separate doctor.test.ts needed)*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Init model pull progress | CLI-01 | Requires live Ollama with model download | Run `brain-cache init` and verify progress output on stderr |
| Index progress bar | CLI-02 | Requires live Ollama + real codebase | Run `brain-cache index .` and verify progress percentage on stderr |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
