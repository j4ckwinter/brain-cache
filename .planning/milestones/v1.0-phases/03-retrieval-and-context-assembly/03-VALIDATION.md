---
phase: 3
slug: retrieval-and-context-assembly
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-31
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | vitest.config.ts |
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
| 03-01-01 | 01 | 1 | RET-01, RET-02, RET-05 | unit | `npx vitest run tests/services/retriever.test.ts` | ❌ W0 | ⬜ pending |
| 03-02-01 | 02 | 1 | RET-03 | unit | `npx vitest run tests/services/tokenCounter.test.ts` | ❌ W0 | ⬜ pending |
| 03-03-01 | 03 | 2 | RET-01, RET-04, RET-05 | integration | `npx vitest run tests/workflows/search.test.ts tests/workflows/buildContext.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/services/retriever.test.ts` — stubs for RET-01, RET-02, RET-05
- [ ] `tests/services/tokenCounter.test.ts` — stubs for RET-03
- [ ] `tests/workflows/search.test.ts` — search workflow integration stubs
- [ ] `tests/workflows/buildContext.test.ts` — context assembly integration stubs
- [ ] `@anthropic-ai/tokenizer` — install as runtime dependency

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Query result quality | RET-05 | Semantic relevance requires human judgment | Run `braincache search "why is X broken"` vs `"how does Y work"` and compare result ordering |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
