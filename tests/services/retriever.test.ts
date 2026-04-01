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
  classifyQueryIntent,
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

describe('classifyQueryIntent', () => {
  it('returns "diagnostic" for "why is this broken"', () => {
    expect(classifyQueryIntent('why is this broken')).toBe('diagnostic');
  });

  it('returns "diagnostic" for "error in module"', () => {
    expect(classifyQueryIntent('error in module')).toBe('diagnostic');
  });

  it('returns "diagnostic" for queries with bug/crash keywords', () => {
    expect(classifyQueryIntent('the app crashes on startup')).toBe('diagnostic');
    expect(classifyQueryIntent('there is a bug in the auth flow')).toBe('diagnostic');
    expect(classifyQueryIntent('help me fix the failing test')).toBe('diagnostic');
  });

  it('returns "knowledge" for "how does auth work"', () => {
    expect(classifyQueryIntent('how does auth work')).toBe('knowledge');
  });

  it('returns "knowledge" for "explain the database schema"', () => {
    expect(classifyQueryIntent('explain the database schema')).toBe('knowledge');
  });

  it('returns "knowledge" for general knowledge queries', () => {
    expect(classifyQueryIntent('what is the purpose of the chunker')).toBe('knowledge');
    expect(classifyQueryIntent('describe the embedding pipeline')).toBe('knowledge');
  });

  // Bigram tests (always diagnostic regardless of exclusions)
  it('returns "diagnostic" for bigram "stack trace"', () => {
    expect(classifyQueryIntent('I got a stack trace')).toBe('diagnostic');
  });

  it('returns "diagnostic" for bigram "null pointer"', () => {
    expect(classifyQueryIntent('null pointer in the loop')).toBe('diagnostic');
  });

  it('returns "diagnostic" for bigram "type error"', () => {
    expect(classifyQueryIntent('it throws a type error')).toBe('diagnostic');
  });

  it('returns "diagnostic" for bigram "not working"', () => {
    expect(classifyQueryIntent('the feature is not working')).toBe('diagnostic');
  });

  // Exclusion tests (keyword present but suppressed by exclusion pattern)
  it('returns "knowledge" for "how does the error handler work" (exclusion)', () => {
    expect(classifyQueryIntent('how does the error handler work')).toBe('knowledge');
  });

  it('returns "knowledge" for "what is undefined behavior" (exclusion)', () => {
    expect(classifyQueryIntent('what is undefined behavior in Rust')).toBe('knowledge');
  });

  it('returns "knowledge" for "explain the null object pattern" (exclusion)', () => {
    expect(classifyQueryIntent('explain the null object pattern')).toBe('knowledge');
  });
});

describe('RETRIEVAL_STRATEGIES', () => {
  it('diagnostic strategy has limit=20 and distanceThreshold=0.4', () => {
    expect(RETRIEVAL_STRATEGIES['diagnostic']).toEqual({
      limit: 20,
      distanceThreshold: 0.4,
    });
  });

  it('knowledge strategy has limit=10 and distanceThreshold=0.3', () => {
    expect(RETRIEVAL_STRATEGIES['knowledge']).toEqual({
      limit: 10,
      distanceThreshold: 0.3,
    });
  });
});
