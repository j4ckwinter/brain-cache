import { describe, it, expect, vi, afterEach } from 'vitest';
import * as tokenCounter from '../../src/services/tokenCounter.js';
import { chunkDocFile } from '../../src/services/docChunker.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('chunkDocFile / chunkMarkdown', () => {
  it('produces two chunks for two ## headings with correct names', () => {
    const md = '## Hello\n\nWorld\n\n## Bye\n\nLater\n';
    const chunks = chunkDocFile('readme.md', md, '.md');
    expect(chunks).toHaveLength(2);
    expect(chunks[0]!.name).toBe('Hello');
    expect(chunks[1]!.name).toBe('Bye');
    expect(chunks[0]!.content).toContain('World');
    expect(chunks[1]!.content).toContain('Later');
  });

  it('stores breadcrumb path in scope for nested headings', () => {
    const md = '## API\n\n### Authentication\n\nSecret stuff\n';
    const chunks = chunkDocFile('doc.md', md, '.md');
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks[0]!.scope).toContain('## API');
    expect(chunks[0]!.scope).toContain('### Authentication');
  });

  it('strips YAML frontmatter before processing', () => {
    const md = '---\ntitle: My Doc\n---\n\n## Section\n\nBody\n';
    const chunks = chunkDocFile('x.md', md, '.md');
    expect(chunks.some((c) => c.content.includes('title:'))).toBe(false);
    expect(chunks.some((c) => c.name === 'Section')).toBe(true);
  });

  it('splits a large section at paragraph boundaries when tokens exceed threshold', () => {
    vi.spyOn(tokenCounter, 'countChunkTokens').mockImplementation((text: string) => {
      if (text.includes('PARA_A') && text.includes('PARA_B')) return 2000;
      if (text === 'PARA_A' || text === 'PARA_B') return 800;
      return 100;
    });

    const md = '## Big\n\nPARA_A\n\nPARA_B\n';
    const chunks = chunkDocFile('big.md', md, '.md');
    expect(chunks.length).toBeGreaterThanOrEqual(2);
  });

  it('uses chunkType file and id pattern filePath:startLine-1', () => {
    const md = '## One\n\nText\n';
    const chunks = chunkDocFile('/proj/readme.md', md, '.md');
    const c = chunks.find((x) => x.name === 'One');
    expect(c?.chunkType).toBe('file');
    expect(c?.id).toBe(`${c!.filePath}:${c!.startLine - 1}`);
  });
});

describe('chunkPlainText', () => {
  it('splits on double newlines into separate chunks', () => {
    const chunks = chunkDocFile('notes.txt', 'para1\n\npara2', '.txt');
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks.some((c) => c.content.includes('para1'))).toBe(true);
    expect(chunks.some((c) => c.content.includes('para2'))).toBe(true);
  });

  it('with no double newlines produces a single chunk', () => {
    const chunks = chunkDocFile('a.txt', 'single line block', '.txt');
    expect(chunks).toHaveLength(1);
  });

  it('dispatches .rst like plain text', () => {
    const chunks = chunkDocFile('a.rst', 'a\n\nb', '.rst');
    expect(chunks.length).toBeGreaterThanOrEqual(2);
  });
});

describe('chunkDocFile dispatch', () => {
  it('routes .md to markdown and .txt to plain text', () => {
    const mdChunks = chunkDocFile('x.md', '## A\n\nb', '.md');
    const txtChunks = chunkDocFile('x.txt', 'a\n\nb', '.txt');
    expect(mdChunks[0]!.name).toBe('A');
    expect(txtChunks.length).toBeGreaterThanOrEqual(1);
  });
});
