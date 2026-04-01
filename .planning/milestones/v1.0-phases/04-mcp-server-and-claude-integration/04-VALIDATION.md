---
phase: 4
slug: mcp-server-and-claude-integration
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-31
---

# Phase 4 — Validation Strategy

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
| 04-01-01 | 01 | 1 | MCP-01, MCP-02, MCP-03, MCP-04, MCP-05 | unit | `npx vitest run tests/mcp/server.test.ts` | No W0 | pending |
| 04-02-01 | 02 | 2 | CLD-01, CLD-02 | unit | `npx vitest run tests/workflows/askCodebase.test.ts` | No W0 | pending |

*Status: pending / green / red / flaky*

---

## Wave 0 Requirements

- [ ] `tests/mcp/server.test.ts` — MCP server init, tool registration, transport connect, all four tool handlers with mocked workflow dependencies
- [ ] `tests/workflows/askCodebase.test.ts` — runAskCodebase with mocked Anthropic SDK and buildContext
- [ ] `@modelcontextprotocol/sdk` — install as runtime dependency
- [ ] `@anthropic-ai/sdk` — install as runtime dependency

*(Existing test infrastructure: vitest.config.ts, vi.mock pattern for services — no framework changes needed. New test files only.)*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Claude Code MCP discovery | MCP-01 | Requires live Claude Code session | Add `.mcp.json` to project, restart Claude Code, verify tool discovery |
| Ask-codebase Claude response | CLD-01 | Requires live Anthropic API key + Ollama | Run `brain-cache ask "how does X work"` and verify Claude reasoning response |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
