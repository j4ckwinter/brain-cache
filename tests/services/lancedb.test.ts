import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdir, writeFile, rm } from 'node:fs/promises';

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

  it('returns empty object when file-hashes.json does not exist', async () => {
    const { readFileHashes } = await import('../../src/services/lancedb.js');
    const result = await readFileHashes(testDir);
    expect(result).toEqual({});
  });

  it('returns parsed hashes when file-hashes.json exists with valid JSON', async () => {
    const hashes = {
      '/project/src/foo.ts': 'abc123',
      '/project/src/bar.ts': 'def456',
    };
    await writeFile(
      join(testDir, '.brain-cache', 'file-hashes.json'),
      JSON.stringify(hashes),
      'utf-8'
    );
    const { readFileHashes } = await import('../../src/services/lancedb.js');
    const result = await readFileHashes(testDir);
    expect(result).toEqual(hashes);
  });

  it('returns empty object when file-hashes.json contains invalid JSON', async () => {
    await writeFile(
      join(testDir, '.brain-cache', 'file-hashes.json'),
      'not valid json!!!',
      'utf-8'
    );
    const { readFileHashes } = await import('../../src/services/lancedb.js');
    const result = await readFileHashes(testDir);
    expect(result).toEqual({});
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
    const hashes = { '/project/src/foo.ts': 'abc123' };
    await writeFileHashes(testDir, hashes);
    const result = await readFileHashes(testDir);
    expect(result).toEqual(hashes);
  });

  it('overwrites existing file-hashes.json', async () => {
    await mkdir(join(testDir, '.brain-cache'), { recursive: true });
    await writeFile(
      join(testDir, '.brain-cache', 'file-hashes.json'),
      JSON.stringify({ '/old/file.ts': 'oldhash' }),
      'utf-8'
    );
    const { writeFileHashes, readFileHashes } = await import('../../src/services/lancedb.js');
    const newHashes = { '/new/file.ts': 'newhash' };
    await writeFileHashes(testDir, newHashes);
    const result = await readFileHashes(testDir);
    expect(result).toEqual(newHashes);
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
