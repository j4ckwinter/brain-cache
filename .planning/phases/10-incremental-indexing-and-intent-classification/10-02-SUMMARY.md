---
phase: 10-incremental-indexing-and-intent-classification
plan: "02"
subsystem: retrieval
tags: [intent-classification, nlp, retriever, vitest, tdd]

# Dependency graph
requires:
  - phase: 09-indexing-and-retrieval-performance
    provides: classifyQueryIntent baseline with DIAGNOSTIC_KEYWORDS

provides:
  - DIAGNOSTIC_BIGRAMS array with 10 two-word strong diagnostic signals
  - DIAGNOSTIC_EXCLUSIONS array with context phrases that suppress false positives
  - Three-tier classifyQueryIntent logic (bigram -> keyword+exclusion -> knowledge)
  - 7 new tests covering bigrams and exclusion patterns

affects:
  - src/workflows/buildContext.ts (consumer of classifyQueryIntent - unchanged API)
  - src/workflows/search.ts (consumer of classifyQueryIntent - unchanged API)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Three-tier NLP classification: strong bigrams override, exclusions suppress keyword false positives"
    - "TDD for pure function improvement: RED tests first, GREEN implementation second"

key-files:
  created: []
  modified:
    - src/services/retriever.ts
    - tests/services/retriever.test.ts

key-decisions:
  - "Move 'not working' from DIAGNOSTIC_KEYWORDS to DIAGNOSTIC_BIGRAMS to avoid double-counting"
  - "Bigrams always win over exclusions (strong signal priority)"
  - "Exclusions only suppress single-keyword matches, not bigrams"

patterns-established:
  - "NLP false positive reduction: add exclusion context patterns before adding new keywords"
  - "Bigram-first classification for compound diagnostic signals"

requirements-completed: [HARD-04]

# Metrics
duration: 2min
completed: "2026-04-01"
---

# Phase 10 Plan 02: Intent Classification Improvement Summary

**Three-tier classifyQueryIntent with DIAGNOSTIC_BIGRAMS and DIAGNOSTIC_EXCLUSIONS reduces false positive diagnostic classifications for "error handler", "undefined behavior", and "null object pattern" queries**

## Performance

- **Duration:** 2 min
- **Started:** 2026-04-01T12:22:29Z
- **Completed:** 2026-04-01T12:23:40Z
- **Tasks:** 1 (TDD: RED + GREEN)
- **Files modified:** 2

## Accomplishments
- Added DIAGNOSTIC_BIGRAMS array (10 two-word phrases: "stack trace", "null pointer", "type error", etc.) that always classify as diagnostic regardless of exclusions
- Added DIAGNOSTIC_EXCLUSIONS array (15 context phrases: "error handler", "undefined behavior", "null object", etc.) that suppress false positive single-keyword matches
- Replaced single-tier keyword search with three-tier logic: bigram check first, then keyword+exclusion check, then knowledge fallback
- Moved "not working" from DIAGNOSTIC_KEYWORDS to DIAGNOSTIC_BIGRAMS (it's inherently a compound phrase)
- Added 7 new tests covering bigram matches and exclusion suppressions; all 252 tests pass

## Task Commits

Each task was committed atomically (TDD pattern):

1. **Task 1 RED: Add failing tests for bigrams and exclusions** - `89a6c21` (test)
2. **Task 1 GREEN: Implement DIAGNOSTIC_BIGRAMS and DIAGNOSTIC_EXCLUSIONS** - `22acd55` (feat)

**Plan metadata:** (docs commit - see below)

_Note: TDD task has RED and GREEN commits_

## Files Created/Modified
- `src/services/retriever.ts` - Added DIAGNOSTIC_BIGRAMS, DIAGNOSTIC_EXCLUSIONS arrays; replaced classifyQueryIntent with three-tier logic
- `tests/services/retriever.test.ts` - Added 7 new test cases: 4 bigram tests + 3 exclusion tests

## Decisions Made
- **"not working" moved to bigrams:** It's inherently a two-word compound phrase treated as a substring — fits bigram semantics better and avoids the keyword being overridden by an exclusion pattern
- **Bigrams override exclusions:** Strong two-word signals (like "stack trace", "null pointer") are unambiguous diagnostic indicators; no exclusion should suppress them
- **Exclusions only apply to single keywords:** This keeps the logic clean and predictable — bigrams are strong signals, exclusions are context modifiers for weak signals only

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- HARD-04 requirement satisfied: intent classification false positives reduced for common knowledge queries containing diagnostic keywords
- classifyQueryIntent API unchanged — zero impact on consumers (buildContext.ts, search.ts)
- All 252 tests pass, ready for phase 10 completion or additional plans

## Self-Check: PASSED

- src/services/retriever.ts: FOUND
- tests/services/retriever.test.ts: FOUND
- Commit 89a6c21 (test - RED): FOUND
- Commit 22acd55 (feat - GREEN): FOUND

---
*Phase: 10-incremental-indexing-and-intent-classification*
*Completed: 2026-04-01*
