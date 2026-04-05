# Requirements: Brain-Cache

**Defined:** 2026-04-05
**Core Value:** Reduce Claude token usage and improve response quality by running embeddings, retrieval, and context building locally — Claude only sees what matters.

## v3.1 Requirements

Requirements for Hook Adoption milestone. Each maps to roadmap phases.

### Hook Installation

- [ ] **HOOK-01**: `brain-cache init` adds PreToolUse hooks to `~/.claude/settings.json` that fire when Claude uses Agent, Grep, Glob, or Read tools, outputting a reminder to check brain-cache first
- [ ] **HOOK-02**: Hook installation merges safely with existing hooks in settings.json — existing PreToolUse entries for other matchers are preserved, not overwritten
- [ ] **HOOK-03**: Running `brain-cache init` multiple times does not duplicate hook entries — if brain-cache hooks already exist, they are skipped with a message

### Documentation

- [ ] **HOOK-04**: SKILL.md references the PreToolUse hook as the enforcement mechanism and explains what it does
- [ ] **HOOK-05**: CLAUDE.md mentions that brain-cache hooks are installed and what triggers them

## Future Requirements

None deferred.

## Out of Scope

| Feature | Reason |
|---------|--------|
| PostToolUse hooks | Not needed for adoption — pre-call reminder is sufficient |
| Blocking hooks (exit non-zero) | Too aggressive — reminder is better UX than blocking |
| Hook for every tool | Only hook tools that brain-cache replaces (search/read/agent) |
| Custom hook message configuration | Over-engineering — fixed message is fine |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| HOOK-01 | Phase 36 | Planned |
| HOOK-02 | Phase 36 | Planned |
| HOOK-03 | Phase 36 | Planned |
| HOOK-04 | Phase 37 | Planned |
| HOOK-05 | Phase 37 | Planned |

**Coverage:**
- v3.1 requirements: 5 total, 0 complete
- Mapped to phases: 5
- Unmapped: 0

---
*Requirements defined: 2026-04-05*
