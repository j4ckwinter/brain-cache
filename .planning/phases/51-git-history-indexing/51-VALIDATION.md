---
phase: 51
slug: git-history-indexing
status: passed
nyquist_compliant: true
wave_0_complete: true
created: 2026-04-06
---

# Phase 51 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (latest) |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run tests/services/gitHistory.test.ts` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run tests/services/gitHistory.test.ts tests/services/retriever.test.ts`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 51-01-01 | 01 | 0 | DAILY-04a | unit | `npx vitest run tests/services/gitHistory.test.ts` | ✅ | ✅ green |
| 51-01-02 | 01 | 0 | DAILY-04b | unit | `npx vitest run tests/services/gitHistory.test.ts` | ✅ | ✅ green |
| 51-01-03 | 01 | 0 | DAILY-04c | unit | `npx vitest run tests/services/lancedb.test.ts` | ✅ | ✅ green |
| 51-01-04 | 01 | 0 | DAILY-04d | unit | `npx vitest run tests/services/lancedb.test.ts` | ✅ | ✅ green |
| 51-02-01 | 02 | 1 | DAILY-04e | unit | `npx vitest run tests/services/retriever.test.ts` | ✅ | ✅ green |
| 51-02-02 | 02 | 1 | DAILY-04f | unit | `npx vitest run tests/lib/format.test.ts` | ✅ | ✅ green |
| 51-02-03 | 02 | 1 | DAILY-04g | integration | `npx vitest run tests/workflows/index.test.ts` | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `tests/services/gitHistory.test.ts` — coverage for DAILY-04a, DAILY-04b (parseGitLog, buildCommitContent)
- [x] `tests/services/lancedb.test.ts` additions — coverage for DAILY-04c, DAILY-04d (migration, deletion)
- [x] `tests/services/retriever.test.ts` additions — coverage for DAILY-04e (history penalty)
- [x] `tests/lib/format.test.ts` additions — coverage for DAILY-04f (provenance labels)
- [x] `tests/workflows/index.test.ts` additions — coverage for DAILY-04g (git ingestion step)

---

## Manual-Only Verifications

*All phase behaviors have automated verification.*

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 15s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved

Validation is aligned to phase-53 closure evidence in `51-VERIFICATION.md` with targeted suite result: PASS (177), FAIL (0).
