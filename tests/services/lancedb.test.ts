import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdir, writeFile, rm } from 'node:fs/promises';

// --- classifyFileType tests ---

describe('classifyFileType', () => {
  it('returns "source" for a regular source file', async () => {
    const { classifyFileType } = await import('../../src/services/lancedb.js');
    expect(classifyFileType('src/utils/helper.ts')).toBe('source');
  });

  it('returns "test" for *.test.ts files', async () => {
    const { classifyFileType } = await import('../../src/services/lancedb.js');
    expect(classifyFileType('src/utils/helper.test.ts')).toBe('test');
  });

  it('returns "test" for *.spec.ts files', async () => {
    const { classifyFileType } = await import('../../src/services/lancedb.js');
    expect(classifyFileType('src/utils/helper.spec.ts')).toBe('test');
  });

  it('returns "test" for *.test.tsx files', async () => {
    const { classifyFileType } = await import('../../src/services/lancedb.js');
    expect(classifyFileType('src/utils/helper.test.tsx')).toBe('test');
  });

  it('returns "test" for *.spec.tsx files', async () => {
    const { classifyFileType } = await import('../../src/services/lancedb.js');
    expect(classifyFileType('src/utils/helper.spec.tsx')).toBe('test');
  });

  it('returns "test" for *.test.js files', async () => {
    const { classifyFileType } = await import('../../src/services/lancedb.js');
    expect(classifyFileType('src/utils/helper.test.js')).toBe('test');
  });

  it('returns "test" for *.spec.js files', async () => {
    const { classifyFileType } = await import('../../src/services/lancedb.js');
    expect(classifyFileType('src/utils/helper.spec.js')).toBe('test');
  });

  it('returns "test" for files in __tests__/ directory', async () => {
    const { classifyFileType } = await import('../../src/services/lancedb.js');
    expect(classifyFileType('src/__tests__/helper.ts')).toBe('test');
  });

  it('returns "test" for files in __tests__/ directory with Windows paths', async () => {
    const { classifyFileType } = await import('../../src/services/lancedb.js');
    expect(classifyFileType('src\\__tests__\\helper.ts')).toBe('test');
  });

  it('returns "source" for a service file like lancedb.ts', async () => {
    const { classifyFileType } = await import('../../src/services/lancedb.js');
    expect(classifyFileType('src/services/lancedb.ts')).toBe('source');
  });
});

// --- chunkSchema file_type field tests ---

describe('chunkSchema', () => {
  it('includes a non-nullable file_type field', async () => {
    const { chunkSchema } = await import('../../src/services/lancedb.js');
    const schema = chunkSchema(768);
    const fileTypeField = schema.fields.find((f: { name: string }) => f.name === 'file_type');
    expect(fileTypeField).toBeDefined();
    expect(fileTypeField?.nullable).toBe(false);
  });

  it('includes a non-nullable source_kind field', async () => {
    const { chunkSchema } = await import('../../src/services/lancedb.js');
    const schema = chunkSchema(768);
    const sourceKindField = schema.fields.find((f: { name: string }) => f.name === 'source_kind');
    expect(sourceKindField).toBeDefined();
    expect(sourceKindField?.nullable).toBe(false);
  });
});

// --- readFileHashes / writeFileHashes tests ---

describe('readFileHashes', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `lancedb-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(join(testDir, '.brain-cache'), { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('returns empty manifest when file-hashes.json does not exist', async () => {
    const { readFileHashes } = await import('../../src/services/lancedb.js');
    const result = await readFileHashes(testDir);
    expect(result).toEqual({ hashes: {}, tokenCounts: {}, stats: {} });
  });

  it('returns parsed manifest when file-hashes.json exists in new format', async () => {
    const manifest = {
      hashes: {
        '/project/src/foo.ts': 'abc123',
        '/project/src/bar.ts': 'def456',
      },
      tokenCounts: {
        '/project/src/foo.ts': 100,
        '/project/src/bar.ts': 200,
      },
    };
    await writeFile(
      join(testDir, '.brain-cache', 'file-hashes.json'),
      JSON.stringify(manifest),
      'utf-8'
    );
    const { readFileHashes } = await import('../../src/services/lancedb.js');
    const result = await readFileHashes(testDir);
    // Manifest without stats key → stats defaults to {}
    expect(result).toEqual({ ...manifest, stats: {} });
  });

  it('migrates legacy format (plain hashes object) to FileHashManifest with empty tokenCounts', async () => {
    const legacyHashes = {
      '/project/src/foo.ts': 'abc123',
      '/project/src/bar.ts': 'def456',
    };
    await writeFile(
      join(testDir, '.brain-cache', 'file-hashes.json'),
      JSON.stringify(legacyHashes),
      'utf-8'
    );
    const { readFileHashes } = await import('../../src/services/lancedb.js');
    const result = await readFileHashes(testDir);
    expect(result).toEqual({ hashes: legacyHashes, tokenCounts: {}, stats: {} });
  });

  it('returns empty manifest when file-hashes.json contains invalid JSON', async () => {
    await writeFile(
      join(testDir, '.brain-cache', 'file-hashes.json'),
      'not valid json!!!',
      'utf-8'
    );
    const { readFileHashes } = await import('../../src/services/lancedb.js');
    const result = await readFileHashes(testDir);
    expect(result).toEqual({ hashes: {}, tokenCounts: {}, stats: {} });
  });

  it('returns stats: {} when file-hashes.json exists but lacks a stats key (migration-safe)', async () => {
    const manifestWithoutStats = {
      hashes: { '/project/src/foo.ts': 'abc123' },
      tokenCounts: { '/project/src/foo.ts': 50 },
    };
    await writeFile(
      join(testDir, '.brain-cache', 'file-hashes.json'),
      JSON.stringify(manifestWithoutStats),
      'utf-8'
    );
    const { readFileHashes } = await import('../../src/services/lancedb.js');
    const result = await readFileHashes(testDir);
    expect(result.stats).toEqual({});
  });
});

describe('writeFileHashes', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `lancedb-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    // Do NOT pre-create .brain-cache — writeFileHashes should do it
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('creates .brain-cache directory if needed and writes JSON', async () => {
    const { writeFileHashes, readFileHashes } = await import('../../src/services/lancedb.js');
    const manifest = { hashes: { '/project/src/foo.ts': 'abc123' }, tokenCounts: { '/project/src/foo.ts': 42 }, stats: {} };
    await writeFileHashes(testDir, manifest);
    const result = await readFileHashes(testDir);
    expect(result).toEqual(manifest);
  });

  it('overwrites existing file-hashes.json', async () => {
    await mkdir(join(testDir, '.brain-cache'), { recursive: true });
    await writeFile(
      join(testDir, '.brain-cache', 'file-hashes.json'),
      JSON.stringify({ hashes: { '/old/file.ts': 'oldhash' }, tokenCounts: {}, stats: {} }),
      'utf-8'
    );
    const { writeFileHashes, readFileHashes } = await import('../../src/services/lancedb.js');
    const newManifest = { hashes: { '/new/file.ts': 'newhash' }, tokenCounts: { '/new/file.ts': 99 }, stats: {} };
    await writeFileHashes(testDir, newManifest);
    const result = await readFileHashes(testDir);
    expect(result).toEqual(newManifest);
  });

  it('round-trips stats entries (size and mtimeMs preserved)', async () => {
    const { writeFileHashes, readFileHashes } = await import('../../src/services/lancedb.js');
    const manifest = {
      hashes: { '/project/src/foo.ts': 'abc123' },
      tokenCounts: { '/project/src/foo.ts': 42 },
      stats: {
        '/project/src/foo.ts': { size: 1024, mtimeMs: 1712345678901 },
        '/project/src/bar.ts': { size: 512, mtimeMs: 1712000000000 },
      },
    };
    await writeFileHashes(testDir, manifest);
    const result = await readFileHashes(testDir);
    expect(result.stats).toEqual(manifest.stats);
    expect(result.stats['/project/src/foo.ts'].size).toBe(1024);
    expect(result.stats['/project/src/foo.ts'].mtimeMs).toBe(1712345678901);
    expect(result.stats['/project/src/bar.ts'].size).toBe(512);
  });
});

// --- deleteChunksByFilePath tests ---

describe('deleteChunksByFilePath', () => {
  it('calls table.delete with correct SQL predicate for a file path', async () => {
    const { deleteChunksByFilePath } = await import('../../src/services/lancedb.js');
    const mockTable = { delete: vi.fn().mockResolvedValue(undefined) } as any;
    await deleteChunksByFilePath(mockTable, '/project/src/foo.ts');
    expect(mockTable.delete).toHaveBeenCalledWith("file_path = '/project/src/foo.ts'");
  });

  it('escapes single quotes in file paths', async () => {
    const { deleteChunksByFilePath } = await import('../../src/services/lancedb.js');
    const mockTable = { delete: vi.fn().mockResolvedValue(undefined) } as any;
    await deleteChunksByFilePath(mockTable, "/project/src/o'malley.ts");
    expect(mockTable.delete).toHaveBeenCalledWith("file_path = '/project/src/o''malley.ts'");
  });

  it('resolves without error on successful delete', async () => {
    const { deleteChunksByFilePath } = await import('../../src/services/lancedb.js');
    const mockTable = { delete: vi.fn().mockResolvedValue(undefined) } as any;
    await expect(deleteChunksByFilePath(mockTable, '/project/src/foo.ts')).resolves.toBeUndefined();
  });
});

describe('migrateSourceKindColumn', () => {
  it('adds source_kind column with default file when missing', async () => {
    const { migrateSourceKindColumn } = await import('../../src/services/lancedb.js');
    const mockTable = {
      schema: vi.fn().mockResolvedValue({
        fields: [{ name: 'id' }, { name: 'file_path' }],
      }),
      addColumns: vi.fn().mockResolvedValue(undefined),
    } as any;

    await migrateSourceKindColumn(mockTable);

    expect(mockTable.addColumns).toHaveBeenCalledWith([
      { name: 'source_kind', valueSql: "'file'" },
    ]);
  });

  it('is a no-op when source_kind already exists', async () => {
    const { migrateSourceKindColumn } = await import('../../src/services/lancedb.js');
    const mockTable = {
      schema: vi.fn().mockResolvedValue({
        fields: [{ name: 'id' }, { name: 'source_kind' }],
      }),
      addColumns: vi.fn().mockResolvedValue(undefined),
    } as any;

    await migrateSourceKindColumn(mockTable);
    expect(mockTable.addColumns).not.toHaveBeenCalled();
  });
});

describe('deleteHistoryChunks', () => {
  it("deletes only rows where source_kind='history'", async () => {
    const { deleteHistoryChunks } = await import('../../src/services/lancedb.js');
    const mockTable = { delete: vi.fn().mockResolvedValue(undefined) } as any;
    await deleteHistoryChunks(mockTable);
    expect(mockTable.delete).toHaveBeenCalledWith("source_kind = 'history'");
  });
});

// --- Edge table tests ---

describe('edgeSchema', () => {
  it('returns a Schema with 6 fields', async () => {
    const { edgeSchema } = await import('../../src/services/lancedb.js');
    const schema = edgeSchema();
    expect(schema.fields).toHaveLength(6);
  });

  it('has correct field names in order', async () => {
    const { edgeSchema } = await import('../../src/services/lancedb.js');
    const schema = edgeSchema();
    expect(schema.fields.map((f: { name: string }) => f.name)).toEqual([
      'from_chunk_id', 'from_file', 'from_symbol', 'to_symbol', 'to_file', 'edge_type',
    ]);
  });
});

describe('openOrCreateEdgesTable', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `edges-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('creates a new edges table on first call with 0 rows', async () => {
    const { openDatabase, openOrCreateEdgesTable } = await import('../../src/services/lancedb.js');
    const db = await openDatabase(testDir);
    const table = await openOrCreateEdgesTable(db);
    expect(await table.countRows()).toBe(0);
  });

  it('opens existing edges table on second call', async () => {
    const { openDatabase, openOrCreateEdgesTable } = await import('../../src/services/lancedb.js');
    const db = await openDatabase(testDir);
    await openOrCreateEdgesTable(db);
    // Second call should open, not recreate
    const table2 = await openOrCreateEdgesTable(db);
    expect(await table2.countRows()).toBe(0);
  });

  it('drops and recreates the edges table when shouldReset is true', async () => {
    const { openDatabase, openOrCreateEdgesTable, insertEdges } = await import('../../src/services/lancedb.js');
    const db = await openDatabase(testDir);
    const table = await openOrCreateEdgesTable(db);
    // Insert a row so we can verify it is gone after reset
    await insertEdges(table, [{
      fromChunkId: 'chunk-1',
      fromFile: '/a.ts',
      fromSymbol: 'foo',
      toSymbol: 'bar',
      toFile: '/b.ts',
      edgeType: 'call',
    }]);
    expect(await table.countRows()).toBe(1);

    // Reset — should drop and recreate
    const db2 = await openDatabase(testDir);
    const freshTable = await openOrCreateEdgesTable(db2, { shouldReset: true });
    expect(await freshTable.countRows()).toBe(0);
  });
});

describe('insertEdges', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `edges-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('is a no-op when edges array is empty', async () => {
    const { openDatabase, openOrCreateEdgesTable, insertEdges } = await import('../../src/services/lancedb.js');
    const db = await openDatabase(testDir);
    const table = await openOrCreateEdgesTable(db);
    await insertEdges(table, []);
    expect(await table.countRows()).toBe(0);
  });

  it('writes rows to edges table and countRows returns correct count', async () => {
    const { openDatabase, openOrCreateEdgesTable, insertEdges } = await import('../../src/services/lancedb.js');
    const db = await openDatabase(testDir);
    const table = await openOrCreateEdgesTable(db);
    await insertEdges(table, [
      { fromChunkId: 'c1', fromFile: '/a.ts', fromSymbol: 'foo', toSymbol: 'bar', toFile: '/b.ts', edgeType: 'call' },
      { fromChunkId: 'c2', fromFile: '/a.ts', fromSymbol: null, toSymbol: 'baz', toFile: null, edgeType: 'import' },
    ]);
    expect(await table.countRows()).toBe(2);
  });
});

describe('queryEdgesFrom', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `edges-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('returns only rows matching the given from_chunk_id', async () => {
    const { openDatabase, openOrCreateEdgesTable, insertEdges, queryEdgesFrom } = await import('../../src/services/lancedb.js');
    const db = await openDatabase(testDir);
    const table = await openOrCreateEdgesTable(db);
    await insertEdges(table, [
      { fromChunkId: 'chunk-A', fromFile: '/a.ts', fromSymbol: 'foo', toSymbol: 'bar', toFile: '/b.ts', edgeType: 'call' },
      { fromChunkId: 'chunk-B', fromFile: '/b.ts', fromSymbol: 'baz', toSymbol: 'qux', toFile: '/c.ts', edgeType: 'call' },
    ]);
    const rows = await queryEdgesFrom(table, 'chunk-A');
    expect(rows).toHaveLength(1);
    expect(rows[0].from_chunk_id).toBe('chunk-A');
    expect(rows[0].to_symbol).toBe('bar');
  });

  it('returns empty array when no rows match', async () => {
    const { openDatabase, openOrCreateEdgesTable, queryEdgesFrom } = await import('../../src/services/lancedb.js');
    const db = await openDatabase(testDir);
    const table = await openOrCreateEdgesTable(db);
    const rows = await queryEdgesFrom(table, 'nonexistent-chunk');
    expect(rows).toEqual([]);
  });
});

describe('withWriteLock', () => {
  it('serializes two concurrent async operations', async () => {
    const { withWriteLock } = await import('../../src/services/lancedb.js');
    const order: number[] = [];

    // Two operations that would interleave if not serialized
    const op1 = withWriteLock(async () => {
      order.push(1);
      await new Promise(resolve => setTimeout(resolve, 10));
      order.push(2);
    });
    const op2 = withWriteLock(async () => {
      order.push(3);
    });

    await Promise.all([op1, op2]);
    // op1 must complete fully before op2 starts
    expect(order).toEqual([1, 2, 3]);
  });

  it('does not deadlock when wrapped function throws', async () => {
    const { withWriteLock } = await import('../../src/services/lancedb.js');
    const results: string[] = [];

    // First operation throws
    const failing = withWriteLock(async () => {
      throw new Error('intentional failure');
    });
    await expect(failing).rejects.toThrow('intentional failure');

    // Second operation must still execute (no deadlock)
    await withWriteLock(async () => {
      results.push('executed after error');
    });
    expect(results).toContain('executed after error');
  });
});
