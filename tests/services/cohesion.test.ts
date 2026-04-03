import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies
vi.mock('../../src/services/logger.js', () => ({
  childLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

vi.mock('../../src/services/tokenCounter.js', () => ({
  formatChunk: vi.fn((chunk: any) => `// File: ${chunk.filePath} (lines ${chunk.startLine}-${chunk.endLine})\n${chunk.content}`),
  countChunkTokens: vi.fn(() => 10),
}));

import { groupChunksByFile, enrichWithParentClass, formatGroupedContext } from '../../src/services/cohesion.js';
import type { RetrievedChunk } from '../../src/lib/types.js';

function makeChunk(overrides: Partial<RetrievedChunk> = {}): RetrievedChunk {
  return {
    id: 'chunk-1',
    filePath: '/project/src/foo.ts',
    chunkType: 'function',
    scope: null,
    name: 'myFn',
    content: 'function myFn() {}',
    startLine: 10,
    endLine: 20,
    similarity: 0.9,
    ...overrides,
  };
}

describe('groupChunksByFile', () => {
  it('returns empty Map for empty input', () => {
    const result = groupChunksByFile([]);
    expect(result.size).toBe(0);
  });

  it('groups chunks by filePath', () => {
    const chunks = [
      makeChunk({ id: 'c1', filePath: '/project/src/a.ts' }),
      makeChunk({ id: 'c2', filePath: '/project/src/b.ts' }),
      makeChunk({ id: 'c3', filePath: '/project/src/a.ts' }),
    ];
    const result = groupChunksByFile(chunks);
    expect(result.size).toBe(2);
    expect(result.get('/project/src/a.ts')).toHaveLength(2);
    expect(result.get('/project/src/b.ts')).toHaveLength(1);
  });

  it('groups chunks from 3 files into a Map with 3 entries', () => {
    const chunks = [
      makeChunk({ id: 'c1', filePath: '/a.ts' }),
      makeChunk({ id: 'c2', filePath: '/b.ts' }),
      makeChunk({ id: 'c3', filePath: '/c.ts' }),
    ];
    const result = groupChunksByFile(chunks);
    expect(result.size).toBe(3);
  });

  it('sorts chunks within each file group by startLine ascending', () => {
    const chunks = [
      makeChunk({ id: 'c3', filePath: '/project/src/a.ts', startLine: 50 }),
      makeChunk({ id: 'c1', filePath: '/project/src/a.ts', startLine: 10 }),
      makeChunk({ id: 'c2', filePath: '/project/src/a.ts', startLine: 30 }),
    ];
    const result = groupChunksByFile(chunks);
    const group = result.get('/project/src/a.ts')!;
    expect(group[0].startLine).toBe(10);
    expect(group[1].startLine).toBe(30);
    expect(group[2].startLine).toBe(50);
  });
});

describe('enrichWithParentClass', () => {
  function makeMockTable(parentRows: any[] = []) {
    const toArray = vi.fn().mockResolvedValue(parentRows);
    const where = vi.fn().mockReturnValue({ toArray });
    const query = vi.fn().mockReturnValue({ where });
    return { query } as any;
  }

  it('returns original chunks when no method chunks present', async () => {
    const chunks = [
      makeChunk({ chunkType: 'function' }),
      makeChunk({ id: 'c2', chunkType: 'class' }),
    ];
    const table = makeMockTable([]);
    const result = await enrichWithParentClass(chunks, table, { maxTokens: 1000, currentTokens: 50 });
    expect(result).toHaveLength(2);
  });

  it('skips non-method chunks (function, class, file types)', async () => {
    const chunks = [
      makeChunk({ id: 'c1', chunkType: 'function' }),
      makeChunk({ id: 'c2', chunkType: 'class' }),
      makeChunk({ id: 'c3', chunkType: 'file' }),
    ];
    const table = makeMockTable([]);
    const result = await enrichWithParentClass(chunks, table, { maxTokens: 1000, currentTokens: 30 });
    expect(result).toHaveLength(3);
  });

  it('adds parent class chunk when method chunk has scope and parent class exists', async () => {
    const methodChunk = makeChunk({
      id: 'method-1',
      chunkType: 'method',
      scope: 'MyClass',
      filePath: '/project/src/foo.ts',
      name: 'doSomething',
    });

    const parentRow = {
      id: 'parent-1',
      file_path: '/project/src/foo.ts',
      chunk_type: 'class',
      scope: null,
      name: 'MyClass',
      content: 'class MyClass {}',
      start_line: 1,
      end_line: 50,
    };

    const table = makeMockTable([parentRow]);
    const result = await enrichWithParentClass([methodChunk], table, { maxTokens: 1000, currentTokens: 10 });
    expect(result.length).toBeGreaterThan(1);
    const parentAdded = result.find(c => c.id === 'parent-1');
    expect(parentAdded).toBeDefined();
  });

  it('does NOT add parent if it would exceed token budget', async () => {
    const methodChunk = makeChunk({
      id: 'method-1',
      chunkType: 'method',
      scope: 'MyClass',
      filePath: '/project/src/foo.ts',
    });

    const parentRow = {
      id: 'parent-1',
      file_path: '/project/src/foo.ts',
      chunk_type: 'class',
      scope: null,
      name: 'MyClass',
      content: 'class MyClass {}',
      start_line: 1,
      end_line: 50,
    };

    const table = makeMockTable([parentRow]);
    // currentTokens near max so adding parent (10 tokens) would overflow
    const result = await enrichWithParentClass([methodChunk], table, { maxTokens: 15, currentTokens: 10 });
    const parentAdded = result.find(c => c.id === 'parent-1');
    expect(parentAdded).toBeUndefined();
  });

  it('does NOT add parent if parent is already in the chunk set', async () => {
    const existingParent = makeChunk({
      id: 'parent-1',
      chunkType: 'class',
      name: 'MyClass',
      filePath: '/project/src/foo.ts',
    });
    const methodChunk = makeChunk({
      id: 'method-1',
      chunkType: 'method',
      scope: 'MyClass',
      filePath: '/project/src/foo.ts',
    });

    const parentRow = {
      id: 'parent-1',
      file_path: '/project/src/foo.ts',
      chunk_type: 'class',
      scope: null,
      name: 'MyClass',
      content: 'class MyClass {}',
      start_line: 1,
      end_line: 50,
    };

    const table = makeMockTable([parentRow]);
    const result = await enrichWithParentClass([existingParent, methodChunk], table, { maxTokens: 1000, currentTokens: 20 });
    // Should not have a duplicate parent-1
    const parentChunks = result.filter(c => c.id === 'parent-1');
    expect(parentChunks).toHaveLength(1);
  });
});

describe('formatGroupedContext', () => {
  it('outputs file-header sections separated by ---', () => {
    const groups = new Map<string, RetrievedChunk[]>();
    groups.set('/project/src/a.ts', [
      makeChunk({ id: 'c1', filePath: '/project/src/a.ts' }),
    ]);
    groups.set('/project/src/b.ts', [
      makeChunk({ id: 'c2', filePath: '/project/src/b.ts' }),
    ]);

    const result = formatGroupedContext(groups);
    expect(result).toContain('---');
    expect(result).toContain('/project/src/a.ts');
    expect(result).toContain('/project/src/b.ts');
  });

  it('file header format is "// ── {filePath} ──"', () => {
    const groups = new Map<string, RetrievedChunk[]>();
    groups.set('/project/src/foo.ts', [
      makeChunk({ id: 'c1', filePath: '/project/src/foo.ts' }),
    ]);

    const result = formatGroupedContext(groups);
    expect(result).toContain('// ── /project/src/foo.ts ──');
  });

  it('returns empty string for empty groups', () => {
    const groups = new Map<string, RetrievedChunk[]>();
    const result = formatGroupedContext(groups);
    expect(result).toBe('');
  });

  it('formats chunks within a group separated by double newlines', () => {
    const groups = new Map<string, RetrievedChunk[]>();
    groups.set('/project/src/a.ts', [
      makeChunk({ id: 'c1', filePath: '/project/src/a.ts', startLine: 1 }),
      makeChunk({ id: 'c2', filePath: '/project/src/a.ts', startLine: 20 }),
    ]);

    const result = formatGroupedContext(groups);
    // Both chunks should appear in the output
    expect(result).toContain('lines 1-');
    expect(result).toContain('lines 20-');
  });
});
