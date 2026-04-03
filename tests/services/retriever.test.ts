import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @lancedb/lancedb before importing retriever
vi.mock('@lancedb/lancedb', () => ({}));

// Mock logger
vi.mock('../../src/services/logger.js', () => ({
  childLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

import {
  searchChunks,
  deduplicateChunks,
  classifyRetrievalMode,
  RETRIEVAL_STRATEGIES,
} from '../../src/services/retriever.js';
import type { RetrievedChunk } from '../../src/lib/types.js';

// Helper to create a mock LanceDB table
function makeMockTable(rows: Record<string, unknown>[]) {
  const toArray = vi.fn().mockResolvedValue(rows);
  const limit = vi.fn().mockReturnValue({ toArray });
  const distanceType = vi.fn().mockReturnValue({ limit });
  const nearestTo = vi.fn().mockReturnValue({ distanceType });
  const query = vi.fn().mockReturnValue({ nearestTo });
  return { query } as unknown as import('@lancedb/lancedb').Table;
}

function makeRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 'chunk-1',
    file_path: 'src/foo.ts',
    chunk_type: 'function',
    scope: null,
    name: 'myFunc',
    content: 'function myFunc() {}',
    start_line: 1,
    end_line: 5,
    _distance: 0.2,
    ...overrides,
  };
}

describe('searchChunks', () => {
  it('converts _distance to similarity (1 - _distance)', async () => {
    const row = makeRow({ _distance: 0.2 });
    const table = makeMockTable([row]);
    const results = await searchChunks(table, [0.1, 0.2], { limit: 10, distanceThreshold: 0.3 });

    expect(results).toHaveLength(1);
    expect(results[0].similarity).toBe(0.8);
  });

  it('filters rows with _distance above distanceThreshold', async () => {
    const rowClose = makeRow({ id: 'close', _distance: 0.2 });
    const rowFar = makeRow({ id: 'far', _distance: 0.5 });
    const table = makeMockTable([rowClose, rowFar]);

    const results = await searchChunks(table, [0.1, 0.2], { limit: 10, distanceThreshold: 0.3 });

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('close');
  });

  it('sorts results by similarity descending', async () => {
    const rowA = makeRow({ id: 'a', _distance: 0.3 });
    const rowB = makeRow({ id: 'b', _distance: 0.1 });
    const rowC = makeRow({ id: 'c', _distance: 0.2 });
    const table = makeMockTable([rowA, rowB, rowC]);

    const results = await searchChunks(table, [0.1], { limit: 10, distanceThreshold: 0.4 });

    expect(results.map((r) => r.id)).toEqual(['b', 'c', 'a']);
  });

  it('converts snake_case LanceDB fields to camelCase RetrievedChunk', async () => {
    const row = makeRow({
      id: 'chunk-abc',
      file_path: 'src/bar.ts',
      chunk_type: 'class',
      scope: 'MyClass',
      name: 'MyClass',
      content: 'class MyClass {}',
      start_line: 10,
      end_line: 20,
      _distance: 0.15,
    });
    const table = makeMockTable([row]);

    const results = await searchChunks(table, [0.1], { limit: 10, distanceThreshold: 0.3 });

    expect(results[0]).toMatchObject({
      id: 'chunk-abc',
      filePath: 'src/bar.ts',
      chunkType: 'class',
      scope: 'MyClass',
      name: 'MyClass',
      content: 'class MyClass {}',
      startLine: 10,
      endLine: 20,
      similarity: 0.85,
    });
  });

  it('returns empty array when all rows are above distanceThreshold', async () => {
    const row = makeRow({ _distance: 0.9 });
    const table = makeMockTable([row]);

    const results = await searchChunks(table, [0.1], { limit: 10, distanceThreshold: 0.3 });

    expect(results).toHaveLength(0);
  });

  it('returns empty array when table returns no rows', async () => {
    const table = makeMockTable([]);

    const results = await searchChunks(table, [0.1], { limit: 10, distanceThreshold: 0.3 });

    expect(results).toHaveLength(0);
  });
});

describe('deduplicateChunks', () => {
  it('removes duplicate chunks by id, preserving first occurrence', () => {
    const chunks: RetrievedChunk[] = [
      { id: 'a', filePath: 'f1', chunkType: 'function', scope: null, name: 'a', content: '', startLine: 1, endLine: 5, similarity: 0.9 },
      { id: 'b', filePath: 'f2', chunkType: 'function', scope: null, name: 'b', content: '', startLine: 1, endLine: 5, similarity: 0.8 },
      { id: 'a', filePath: 'f1', chunkType: 'function', scope: null, name: 'a', content: '', startLine: 1, endLine: 5, similarity: 0.7 },
    ];

    const result = deduplicateChunks(chunks);

    expect(result).toHaveLength(2);
    expect(result.map((c) => c.id)).toEqual(['a', 'b']);
    // First occurrence of 'a' has similarity 0.9
    expect(result[0].similarity).toBe(0.9);
  });

  it('returns empty array for empty input', () => {
    expect(deduplicateChunks([])).toEqual([]);
  });

  it('preserves original order (not sorted)', () => {
    const chunks: RetrievedChunk[] = [
      { id: 'z', filePath: 'f', chunkType: 'function', scope: null, name: 'z', content: '', startLine: 1, endLine: 5, similarity: 0.5 },
      { id: 'a', filePath: 'f', chunkType: 'function', scope: null, name: 'a', content: '', startLine: 1, endLine: 5, similarity: 0.9 },
    ];

    const result = deduplicateChunks(chunks);

    expect(result.map((c) => c.id)).toEqual(['z', 'a']);
  });
});

describe('classifyRetrievalMode', () => {
  // --- lookup mode ---
  it('returns "lookup" for "find the definition of foo"', () => {
    expect(classifyRetrievalMode('find the definition of foo')).toBe('lookup');
  });

  it('returns "lookup" for "where is the auth handler"', () => {
    expect(classifyRetrievalMode('where is the auth handler')).toBe('lookup');
  });

  it('returns "lookup" for "signature of classifyQueryIntent"', () => {
    expect(classifyRetrievalMode('signature of classifyQueryIntent')).toBe('lookup');
  });

  // Bigram-based lookup (formerly diagnostic bigrams)
  it('returns "lookup" for bigram "stack trace"', () => {
    expect(classifyRetrievalMode('I got a stack trace')).toBe('lookup');
  });

  it('returns "lookup" for bigram "null pointer"', () => {
    expect(classifyRetrievalMode('null pointer in the loop')).toBe('lookup');
  });

  it('returns "lookup" for bigram "type error"', () => {
    expect(classifyRetrievalMode('it throws a type error')).toBe('lookup');
  });

  it('returns "lookup" for bigram "not working"', () => {
    expect(classifyRetrievalMode('the feature is not working')).toBe('lookup');
  });

  // --- trace mode ---
  it('returns "trace" for "trace the call path from CLI to LanceDB"', () => {
    expect(classifyRetrievalMode('trace the call path from CLI to LanceDB')).toBe('trace');
  });

  it('returns "trace" for "how does indexing flow from CLI to storage"', () => {
    expect(classifyRetrievalMode('how does indexing flow from CLI to storage')).toBe('trace');
  });

  it('returns "trace" for "trace flow of build_context"', () => {
    expect(classifyRetrievalMode('trace flow of build_context')).toBe('trace');
  });

  // --- explore mode ---
  it('returns "explore" for "explain the architecture"', () => {
    expect(classifyRetrievalMode('explain the architecture')).toBe('explore');
  });

  it('returns "explore" for "how does auth work"', () => {
    expect(classifyRetrievalMode('how does auth work')).toBe('explore');
  });

  it('returns "explore" for "walk me through the retrieval pipeline"', () => {
    expect(classifyRetrievalMode('walk me through the retrieval pipeline')).toBe('explore');
  });

  // Exclusion tests — lookup keyword present but exclusion pattern overrides to explore
  it('returns "explore" for "how does the error handler work" (exclusion)', () => {
    expect(classifyRetrievalMode('how does the error handler work')).toBe('explore');
  });

  it('returns "explore" for "explain the null object pattern" (exclusion)', () => {
    expect(classifyRetrievalMode('explain the null object pattern')).toBe('explore');
  });

  // Ambiguity test: "trace the" prefix but architecture context → explore wins
  it('returns "explore" for "trace the architecture of this repo" (ambiguity)', () => {
    expect(classifyRetrievalMode('trace the architecture of this repo')).toBe('explore');
  });
});

describe('RETRIEVAL_STRATEGIES', () => {
  it('lookup strategy has limit=5 and distanceThreshold=0.25', () => {
    expect(RETRIEVAL_STRATEGIES['lookup']).toEqual({
      limit: 5,
      distanceThreshold: 0.25,
    });
  });

  it('trace strategy has limit=3 and distanceThreshold=0.30', () => {
    expect(RETRIEVAL_STRATEGIES['trace']).toEqual({
      limit: 3,
      distanceThreshold: 0.30,
    });
  });

  it('explore strategy has limit=20 and distanceThreshold=0.45', () => {
    expect(RETRIEVAL_STRATEGIES['explore']).toEqual({
      limit: 20,
      distanceThreshold: 0.45,
    });
  });
});
