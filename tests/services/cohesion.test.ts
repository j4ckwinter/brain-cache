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

import { groupChunksByFile, enrichWithParentClass, formatGroupedContext, extractBehavioralSummary, groupChunksByModule, extractWiringAnnotations, formatModuleNarratives } from '../../src/services/cohesion.js';
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

describe('extractBehavioralSummary', () => {
  it('returns first JSDoc description line from chunk content', () => {
    const content = '/** Strips function bodies above 200 tokens */\nexport function compressChunk() {}';
    expect(extractBehavioralSummary(content)).toBe('Strips function bodies above 200 tokens');
  });

  it('returns null when no JSDoc present', () => {
    const content = 'export function foo() {}';
    expect(extractBehavioralSummary(content)).toBeNull();
  });

  it('skips // [compressed] manifest lines before JSDoc', () => {
    const content = '// [compressed] fn (lines 1-10)\n/** Does something cool */\n// Signature: export function fn()';
    expect(extractBehavioralSummary(content)).toBe('Does something cool');
  });

  it('returns null when JSDoc has only @param/@returns tags and no plain text', () => {
    const content = '/**\n * @param x - the input\n * @returns the result\n */\nexport function foo() {}';
    expect(extractBehavioralSummary(content)).toBeNull();
  });

  it('handles inline single-line JSDoc', () => {
    const content = '/** foo */ export function bar() {}';
    expect(extractBehavioralSummary(content)).toBe('foo');
  });
});

describe('groupChunksByModule', () => {
  it('groups chunks by parent directory relative to rootDir', () => {
    const chunks = [
      makeChunk({ id: 'c1', filePath: '/project/src/services/a.ts' }),
      makeChunk({ id: 'c2', filePath: '/project/src/services/b.ts' }),
      makeChunk({ id: 'c3', filePath: '/project/src/cli/index.ts' }),
    ];
    const result = groupChunksByModule(chunks, '/project');
    expect(result.size).toBe(2);
    expect(result.get('src/services')).toHaveLength(2);
    expect(result.get('src/cli')).toHaveLength(1);
  });

  it('root-level files get key "."', () => {
    const chunks = [
      makeChunk({ id: 'c1', filePath: '/project/index.ts' }),
    ];
    const result = groupChunksByModule(chunks, '/project');
    expect(result.has('.')).toBe(true);
    expect(result.get('.')![0].id).toBe('c1');
  });

  it('empty input returns empty Map', () => {
    const result = groupChunksByModule([], '/project');
    expect(result.size).toBe(0);
  });

  it('chunks within same directory are sorted by startLine ascending', () => {
    const chunks = [
      makeChunk({ id: 'c2', filePath: '/project/src/services/b.ts', startLine: 50 }),
      makeChunk({ id: 'c1', filePath: '/project/src/services/a.ts', startLine: 10 }),
    ];
    const result = groupChunksByModule(chunks, '/project');
    const group = result.get('src/services')!;
    expect(group[0].startLine).toBe(10);
    expect(group[1].startLine).toBe(50);
  });
});

describe('extractWiringAnnotations', () => {
  it('captures stems from relative imports', () => {
    const chunks = [
      makeChunk({ content: "import { foo } from '../services/tokenCounter.js'" }),
    ];
    expect(extractWiringAnnotations(chunks)).toEqual(['tokenCounter']);
  });

  it('excludes external packages (not starting with ./ or ../)', () => {
    const chunks = [
      makeChunk({ content: "import { Table } from '@lancedb/lancedb'" }),
    ];
    expect(extractWiringAnnotations(chunks)).toEqual([]);
  });

  it('excludes Node.js builtins', () => {
    const chunks = [
      makeChunk({ content: "import { readFile } from 'node:fs/promises'" }),
    ];
    expect(extractWiringAnnotations(chunks)).toEqual([]);
  });

  it('returns sorted, deduplicated stems from multiple imports', () => {
    const chunks = [
      makeChunk({
        content: "import { a } from './config.js'\nimport { b } from '../lib/types.js'\nimport { c } from './config.js'",
      }),
    ];
    expect(extractWiringAnnotations(chunks)).toEqual(['config', 'types']);
  });

  it('returns empty array when no imports present', () => {
    const chunks = [
      makeChunk({ content: 'export function foo() {}' }),
    ];
    expect(extractWiringAnnotations(chunks)).toEqual([]);
  });
});

describe('formatModuleNarratives', () => {
  it('produces "### module:" header per module group', () => {
    const groups = new Map<string, RetrievedChunk[]>([
      ['src/services', [makeChunk({ id: 'c1', filePath: '/project/src/services/a.ts' })]],
      ['src/cli', [makeChunk({ id: 'c2', filePath: '/project/src/cli/index.ts' })]],
    ]);
    const result = formatModuleNarratives(groups);
    expect(result).toContain('### module: src/services');
    expect(result).toContain('### module: src/cli');
  });

  it('includes behavioral summary from JSDoc for chunks that have it', () => {
    const groups = new Map<string, RetrievedChunk[]>([
      ['src/services', [makeChunk({
        id: 'c1',
        filePath: '/project/src/services/a.ts',
        content: '/** Handles authentication logic */\nexport function authHandler() {}',
        name: 'authHandler',
      })]],
    ]);
    const result = formatModuleNarratives(groups);
    expect(result).toContain('Handles authentication logic');
  });

  it('shows filename without fabricated text for chunks without JSDoc', () => {
    const groups = new Map<string, RetrievedChunk[]>([
      ['src/services', [makeChunk({
        id: 'c1',
        filePath: '/project/src/services/a.ts',
        content: 'export function foo() {}',
        name: 'foo',
      })]],
    ]);
    const result = formatModuleNarratives(groups);
    expect(result).toContain('a.ts');
    // Should NOT contain fabricated descriptions
    expect(result).not.toContain('This function');
    expect(result).not.toContain('undefined');
  });

  it('includes "imports:" wiring annotation when chunks have relative imports', () => {
    const groups = new Map<string, RetrievedChunk[]>([
      ['src/services', [makeChunk({
        id: 'c1',
        filePath: '/project/src/services/a.ts',
        content: "import { x } from '../lib/types.js'\nexport function foo() {}",
        name: 'foo',
      })]],
    ]);
    const result = formatModuleNarratives(groups);
    expect(result).toContain('imports:');
    expect(result).toContain('types');
  });

  it('does NOT use "// ── filepath ──" format (that is formatGroupedContext format)', () => {
    const groups = new Map<string, RetrievedChunk[]>([
      ['src/services', [makeChunk({ id: 'c1', filePath: '/project/src/services/a.ts' })]],
    ]);
    const result = formatModuleNarratives(groups);
    expect(result).not.toContain('// ──');
  });

  it('handles module where all chunks are internal helpers — still shows module', () => {
    const groups = new Map<string, RetrievedChunk[]>([
      ['src/services', [makeChunk({
        id: 'c1',
        filePath: '/project/src/services/a.ts',
        content: 'function helperFn() {}',
        name: 'helperFn',
      })]],
    ]);
    const result = formatModuleNarratives(groups);
    expect(result).toContain('### module: src/services');
  });
});
