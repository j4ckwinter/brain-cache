import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock tokenCounter to control token counts in tests
const mockCountChunkTokens = vi.fn();
vi.mock('../../src/services/tokenCounter.js', () => ({
  countChunkTokens: (...args: unknown[]) => mockCountChunkTokens(...args),
}));

import { compressChunk } from '../../src/services/compression.js';
import type { RetrievedChunk } from '../../src/lib/types.js';

function makeChunk(overrides: Partial<RetrievedChunk> = {}): RetrievedChunk {
  return {
    id: 'chunk-1',
    filePath: 'src/foo.ts',
    chunkType: 'function',
    scope: null,
    name: 'myFunc',
    content: 'function myFunc() {\n  return 42;\n}',
    startLine: 1,
    endLine: 3,
    similarity: 0.9,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('compressChunk', () => {
  describe('below base threshold (<=500 tokens): never compress', () => {
    it('returns chunk unchanged when content is below 500 token threshold', () => {
      mockCountChunkTokens.mockReturnValue(50);
      const chunk = makeChunk({ content: 'function myFunc() { return 42; }' });

      const result = compressChunk(chunk);

      expect(result).toBe(chunk); // same reference — not a copy
    });

    it('returns chunk unchanged when token count is exactly at threshold (500)', () => {
      mockCountChunkTokens.mockReturnValue(500);
      const chunk = makeChunk();

      const result = compressChunk(chunk);

      expect(result).toBe(chunk);
    });

    it('returns chunk unchanged at 499 tokens even with low similarity', () => {
      mockCountChunkTokens.mockReturnValue(499);
      const chunk = makeChunk({ similarity: 0.3 });

      const result = compressChunk(chunk);

      expect(result).toBe(chunk);
    });
  });

  describe('above hard limit (>800 tokens): always compress', () => {
    it('compresses chunk when tokens exceed 800 regardless of high similarity', () => {
      mockCountChunkTokens.mockReturnValue(900);
      const chunk = makeChunk({
        similarity: 0.99, // very high relevance — still compressed above hard limit
        content: 'function myFunc() {\n  // lots of body\n  return 42;\n}',
      });

      const result = compressChunk(chunk);

      expect(result).not.toBe(chunk);
      expect(result.content).toContain('// [body stripped]');
    });

    it('compresses chunk at exactly 801 tokens with similarity=1.0', () => {
      mockCountChunkTokens.mockReturnValue(801);
      const chunk = makeChunk({ similarity: 1.0 });

      const result = compressChunk(chunk);

      expect(result.content).toContain('// [compressed]');
    });
  });

  describe('middle range (501–800 tokens): relevance-aware compression', () => {
    it('does NOT compress high-relevance chunk (similarity=0.85) in middle range', () => {
      mockCountChunkTokens.mockReturnValue(600);
      const chunk = makeChunk({ similarity: 0.85 });

      const result = compressChunk(chunk);

      expect(result).toBe(chunk);
    });

    it('does NOT compress high-relevance chunk (similarity=0.95) in middle range', () => {
      mockCountChunkTokens.mockReturnValue(750);
      const chunk = makeChunk({ similarity: 0.95 });

      const result = compressChunk(chunk);

      expect(result).toBe(chunk);
    });

    it('compresses low-relevance chunk (similarity=0.7) in middle range', () => {
      mockCountChunkTokens.mockReturnValue(600);
      const chunk = makeChunk({
        similarity: 0.7,
        content: 'function myFunc() {\n  // lots of body\n  return 42;\n}',
      });

      const result = compressChunk(chunk);

      expect(result).not.toBe(chunk);
      expect(result.content).toContain('// [body stripped]');
    });

    it('compresses chunk at similarity=0.84 (just below high-relevance threshold)', () => {
      mockCountChunkTokens.mockReturnValue(600);
      const chunk = makeChunk({
        similarity: 0.84,
        content: 'function myFunc() {\n  // body\n  return 42;\n}',
      });

      const result = compressChunk(chunk);

      expect(result.content).toContain('// [compressed]');
    });
  });

  describe('compressed manifest format', () => {
    it('compressed content starts with // [compressed] header line', () => {
      mockCountChunkTokens.mockReturnValue(900);
      const chunk = makeChunk({
        name: 'processData',
        startLine: 10,
        endLine: 60,
        content: 'function processData(input: string): string {\n  // many lines\n  return input;\n}',
      });

      const result = compressChunk(chunk);
      const lines = result.content.split('\n');

      expect(lines[0]).toBe('// [compressed] processData (lines 10-60)');
    });

    it('compressed manifest includes // Signature: line with function signature', () => {
      mockCountChunkTokens.mockReturnValue(900);
      const chunk = makeChunk({
        content: 'export function computeHash(data: Buffer): string {\n  // body\n  return "";\n}',
      });

      const result = compressChunk(chunk);

      expect(result.content).toContain('// Signature: export function computeHash(data: Buffer): string {');
    });

    it('compressed manifest ends with // [body stripped]', () => {
      mockCountChunkTokens.mockReturnValue(900);
      const chunk = makeChunk({
        content: 'function myFunc(): void {\n  // body\n}',
      });

      const result = compressChunk(chunk);
      const lines = result.content.split('\n');

      expect(lines[lines.length - 1]).toBe('// [body stripped]');
    });

    it('preserves JSDoc block in manifest between header and signature', () => {
      mockCountChunkTokens.mockReturnValue(900);
      const jsDocContent = [
        '/**',
        ' * Processes the input data.',
        ' * @param input - The input string',
        ' * @returns processed result',
        ' */',
        'export function processData(input: string): string {',
        '  // lots of body code here',
        '  return input.trim();',
        '}',
      ].join('\n');

      const chunk = makeChunk({ content: jsDocContent, name: 'processData' });

      const result = compressChunk(chunk);
      const lines = result.content.split('\n');

      // Header is first
      expect(lines[0]).toContain('// [compressed]');
      // JSDoc is preserved
      expect(result.content).toContain('/**');
      expect(result.content).toContain(' * Processes the input data.');
      expect(result.content).toContain(' */');
      // Signature line follows JSDoc
      expect(result.content).toContain('// Signature: export function processData(input: string): string {');
      // Footer is last
      expect(lines[lines.length - 1]).toBe('// [body stripped]');
    });

    it('handles chunk with name=null by using "unknown" in header', () => {
      mockCountChunkTokens.mockReturnValue(900);
      const chunk = makeChunk({
        name: null,
        content: 'export default function() {\n  return null;\n}',
      });

      const result = compressChunk(chunk);

      expect(result.content).toContain('// [compressed] unknown');
    });

    it('preserves all chunk fields except content', () => {
      mockCountChunkTokens.mockReturnValue(900);
      const chunk = makeChunk({
        id: 'test-id',
        filePath: 'src/test.ts',
        chunkType: 'function',
        similarity: 0.55, // low relevance so compression fires
        startLine: 5,
        endLine: 100,
      });

      const result = compressChunk(chunk);

      expect(result.id).toBe('test-id');
      expect(result.filePath).toBe('src/test.ts');
      expect(result.chunkType).toBe('function');
      expect(result.similarity).toBe(0.55);
      expect(result.startLine).toBe(5);
      expect(result.endLine).toBe(100);
    });
  });
});
