import { describe, it, expect, vi } from 'vitest';

// Mock @anthropic-ai/tokenizer before importing the module under test
vi.mock('@anthropic-ai/tokenizer', () => ({
  countTokens: vi.fn((text: string) => text.split(/\s+/).filter(Boolean).length),
}));

import {
  countChunkTokens,
  formatChunk,
  assembleContext,
} from '../../src/services/tokenCounter.js';
import type { RetrievedChunk } from '../../src/lib/types.js';

// Helper to create a minimal RetrievedChunk for testing
function makeChunk(overrides: Partial<RetrievedChunk> = {}): RetrievedChunk {
  return {
    id: 'chunk-1',
    filePath: 'src/foo.ts',
    chunkType: 'function',
    scope: null,
    name: 'myFunction',
    content: 'function myFunction() {}',
    startLine: 10,
    endLine: 25,
    similarity: 0.9,
    ...overrides,
  };
}

describe('countChunkTokens', () => {
  it('returns 0 for empty string', () => {
    expect(countChunkTokens('')).toBe(0);
  });

  it('returns a positive integer for non-empty strings', () => {
    const result = countChunkTokens('hello world');
    expect(result).toBeGreaterThan(0);
    expect(Number.isInteger(result)).toBe(true);
  });

  it('returns word count for multi-word strings (via mock)', () => {
    // Mock returns word count — "hello world foo" = 3
    expect(countChunkTokens('hello world foo')).toBe(3);
  });
});

describe('formatChunk', () => {
  it('returns string containing file path and line range header', () => {
    const chunk = makeChunk({ filePath: 'src/bar.ts', startLine: 10, endLine: 25 });
    const result = formatChunk(chunk);
    expect(result).toContain('// File: src/bar.ts (lines 10-25)');
  });

  it('includes chunk content after the header', () => {
    const chunk = makeChunk({ content: 'const x = 1;' });
    const result = formatChunk(chunk);
    expect(result).toContain('const x = 1;');
  });

  it('places header before content (newline separated)', () => {
    const chunk = makeChunk({ filePath: 'src/baz.ts', startLine: 1, endLine: 5, content: 'export {}' });
    const result = formatChunk(chunk);
    const headerIndex = result.indexOf('// File:');
    const contentIndex = result.indexOf('export {}');
    expect(headerIndex).toBeLessThan(contentIndex);
  });
});

describe('assembleContext', () => {
  it('returns empty result for empty chunks array', () => {
    const result = assembleContext([], { maxTokens: 100 });
    expect(result).toEqual({ content: '', chunks: [], tokenCount: 0 });
  });

  it('keeps chunks that fit within budget', () => {
    // Each chunk content "hello" = 1 token in mock; header adds more
    // "// File: src/a.ts (lines 1-1)\nhello" → split by whitespace = 6 tokens
    const chunks: RetrievedChunk[] = [
      makeChunk({ id: '1', filePath: 'src/a.ts', content: 'hello', startLine: 1, endLine: 1 }),
      makeChunk({ id: '2', filePath: 'src/b.ts', content: 'world', startLine: 2, endLine: 2 }),
    ];
    const result = assembleContext(chunks, { maxTokens: 100 });
    expect(result.chunks).toHaveLength(2);
    expect(result.tokenCount).toBeGreaterThan(0);
  });

  it('stops adding chunks when next chunk would exceed budget', () => {
    // Each formatted chunk = "// File: src/x.ts (lines N-N)\n<content>"
    // With mock (word count), each is ~6-7 tokens
    // Set maxTokens = 10 so only first chunk fits, second cannot be added
    const chunks: RetrievedChunk[] = [
      makeChunk({ id: '1', filePath: 'src/a.ts', content: 'alpha beta gamma', startLine: 1, endLine: 1 }),
      makeChunk({ id: '2', filePath: 'src/b.ts', content: 'delta epsilon zeta', startLine: 2, endLine: 2 }),
    ];
    // First chunk: "// File: src/a.ts (lines 1-1)\nalpha beta gamma" = 8 tokens
    // Second chunk: separator (4 tokens) + ~8 tokens = 12 more → would exceed 10
    const result = assembleContext(chunks, { maxTokens: 10 });
    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0].id).toBe('1');
  });

  it('returns empty result when single chunk exceeds budget', () => {
    const chunks: RetrievedChunk[] = [
      makeChunk({ id: '1', filePath: 'src/huge.ts', content: 'a b c d e f g h i j', startLine: 1, endLine: 1 }),
    ];
    // Budget of 3 is far too small for even the header
    const result = assembleContext(chunks, { maxTokens: 3 });
    expect(result.chunks).toHaveLength(0);
    expect(result.content).toBe('');
    expect(result.tokenCount).toBe(0);
  });

  it('joins kept chunks with separator', () => {
    const chunks: RetrievedChunk[] = [
      makeChunk({ id: '1', filePath: 'src/a.ts', content: 'hello', startLine: 1, endLine: 1 }),
      makeChunk({ id: '2', filePath: 'src/b.ts', content: 'world', startLine: 2, endLine: 2 }),
    ];
    const result = assembleContext(chunks, { maxTokens: 100 });
    expect(result.content).toContain('\n\n---\n\n');
  });

  it('content includes formatted representations of all kept chunks', () => {
    const chunks: RetrievedChunk[] = [
      makeChunk({ id: '1', filePath: 'src/first.ts', content: 'foo', startLine: 5, endLine: 10 }),
      makeChunk({ id: '2', filePath: 'src/second.ts', content: 'bar', startLine: 15, endLine: 20 }),
    ];
    const result = assembleContext(chunks, { maxTokens: 100 });
    expect(result.content).toContain('// File: src/first.ts (lines 5-10)');
    expect(result.content).toContain('// File: src/second.ts (lines 15-20)');
  });

  it('tokenCount reflects actual tokens used (not raw text length)', () => {
    const chunks: RetrievedChunk[] = [
      makeChunk({ id: '1', content: 'one two three', startLine: 1, endLine: 1 }),
    ];
    const result = assembleContext(chunks, { maxTokens: 100 });
    expect(result.tokenCount).toBeGreaterThan(0);
    // tokenCount should match a countChunkTokens call on the formatted chunk
    const formatted = `// File: src/foo.ts (lines 1-1)\none two three`;
    const expected = countChunkTokens(formatted);
    expect(result.tokenCount).toBe(expected);
  });
});
