---
phase: 2
slug: storage-and-indexing
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-31
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | vitest.config.ts (exists from Phase 1) |
| **Quick run command** | `npx vitest run --reporter=verbose` |
| **Full suite command** | `npx vitest run --reporter=verbose` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --reporter=verbose`
- **After every plan wave:** Run `npx vitest run --reporter=verbose`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 2-01-01 | 01 | 1 | IDX-01 | unit | `npx vitest run tests/services/storage.test.ts` | ❌ W0 | ⬜ pending |
| 2-01-02 | 01 | 1 | IDX-02 | unit | `npx vitest run tests/services/crawler.test.ts` | ❌ W0 | ⬜ pending |
| 2-02-01 | 02 | 2 | IDX-03 | unit | `npx vitest run tests/services/chunker.test.ts` | ❌ W0 | ⬜ pending |
| 2-03-01 | 03 | 3 | IDX-04 | unit | `npx vitest run tests/services/embedder.test.ts` | ❌ W0 | ⬜ pending |
| 2-03-02 | 03 | 3 | IDX-05 | unit | `npx vitest run tests/workflows/index.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `@lancedb/lancedb` — install and verify import works
- [ ] `tree-sitter` + grammar packages — install and verify CJS/ESM shim
- [ ] `fast-glob` + `ignore` — install for file crawling
- [ ] Test stubs for IDX-01 through IDX-05

*Existing vitest infrastructure covers test runner needs.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Full codebase indexing end-to-end | IDX-01 | Requires running Ollama with model loaded | Run `braincache index .` on a real codebase with Ollama running |
| Embedding batch performance | IDX-04 | Requires Ollama server and timing measurement | Time `braincache index .` and verify batch requests in Ollama logs |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
