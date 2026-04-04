import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLAUDE_MD_SECTION } from '../../src/lib/claude-md-section.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('CLAUDE_MD_SECTION template', () => {
  it('contains search_codebase', () => {
    expect(CLAUDE_MD_SECTION).toContain('search_codebase');
  });

  it('contains build_context', () => {
    expect(CLAUDE_MD_SECTION).toContain('build_context');
  });

  it('contains doctor', () => {
    expect(CLAUDE_MD_SECTION).toContain('doctor');
  });

  it('contains index_repo', () => {
    expect(CLAUDE_MD_SECTION).toContain('index_repo');
  });

  it('does not contain removed tools (trace_flow, explain_codebase)', () => {
    expect(CLAUDE_MD_SECTION).not.toContain('trace_flow');
    expect(CLAUDE_MD_SECTION).not.toContain('explain_codebase');
  });

  it('contains ## Brain-Cache MCP Tools heading (idempotency check)', () => {
    expect(CLAUDE_MD_SECTION).toContain('## Brain-Cache MCP Tools');
  });

  it('contains "Do NOT use" negative routing examples', () => {
    const doNotUseMatches = CLAUDE_MD_SECTION.match(/Do NOT use/g);
    expect(doNotUseMatches).not.toBeNull();
    expect(doNotUseMatches!.length).toBeGreaterThanOrEqual(1);
  });

  it('CLAUDE_MD_SECTION content matches CLAUDE.md Brain-Cache MCP Tools section', () => {
    const claudeMd = readFileSync(resolve(__dirname, '../../CLAUDE.md'), 'utf-8');
    // Extract the Brain-Cache MCP Tools section from CLAUDE.md
    const sectionStart = claudeMd.indexOf('## Brain-Cache MCP Tools');
    expect(sectionStart).toBeGreaterThan(-1);
    // Find the next ## heading after the section start (or end of file)
    const afterStart = claudeMd.indexOf('\n## ', sectionStart + 1);
    const sectionEnd = afterStart === -1 ? claudeMd.length : afterStart;
    const claudeMdSection = claudeMd.slice(sectionStart, sectionEnd).trim();
    const templateSection = CLAUDE_MD_SECTION.trim();
    expect(templateSection).toBe(claudeMdSection);
  });
});
