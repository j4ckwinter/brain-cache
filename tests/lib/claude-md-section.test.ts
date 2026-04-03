import { describe, it, expect } from 'vitest';
import { CLAUDE_MD_SECTION } from '../../src/lib/claude-md-section.js';

describe('CLAUDE_MD_SECTION template', () => {
  it('contains search_codebase', () => {
    expect(CLAUDE_MD_SECTION).toContain('search_codebase');
  });

  it('contains build_context', () => {
    expect(CLAUDE_MD_SECTION).toContain('build_context');
  });

  it('contains trace_flow', () => {
    expect(CLAUDE_MD_SECTION).toContain('trace_flow');
  });

  it('contains explain_codebase', () => {
    expect(CLAUDE_MD_SECTION).toContain('explain_codebase');
  });

  it('contains doctor', () => {
    expect(CLAUDE_MD_SECTION).toContain('doctor');
  });

  it('contains index_repo', () => {
    expect(CLAUDE_MD_SECTION).toContain('index_repo');
  });

  it('contains ## Brain-Cache MCP Tools heading (idempotency check)', () => {
    expect(CLAUDE_MD_SECTION).toContain('## Brain-Cache MCP Tools');
  });

  it('contains cross-reference directing trace queries away from build_context', () => {
    expect(CLAUDE_MD_SECTION).toContain('instead of build_context');
  });
});
