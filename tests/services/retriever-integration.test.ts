import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChunkRow } from '../../src/services/lancedb.js';
import { insertChunks, openDatabase, openOrCreateChunkTable } from '../../src/services/lancedb.js';
import { keywordSearchChunks } from '../../src/services/retriever.js';

const mockReadProfile = vi.fn();

vi.mock('../../src/services/ollama.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/services/ollama.js')>();
  return {
    ...mod,
    isOllamaRunning: vi.fn().mockResolvedValue(false),
  };
});

vi.mock('../../src/services/capability.js', () => ({
  readProfile: (...args: unknown[]) => mockReadProfile(...args),
}));

vi.mock('../../src/services/embedder.js', () => ({
  embedBatchWithRetry: vi.fn().mockResolvedValue({
    embeddings: [],
    skipped: 0,
    zeroVectorIndices: new Set<number>(),
  }),
}));

vi.mock('../../src/services/indexLock.js', () => ({
  acquireIndexLock: vi.fn().mockResolvedValue(undefined),
  releaseIndexLock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/services/logger.js', () => ({
  childLogger: vi.fn().mockReturnValue({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const PROFILE = {
  version: 1 as const,
  detectedAt: '2026-04-07T00:00:00.000Z',
  vramTier: 'large' as const,
  vramGiB: 16,
  gpuVendor: 'nvidia' as const,
  embeddingModel: 'nomic-embed-text',
  ollamaVersion: '0.6.0',
  platform: 'darwin',
};

function makeChunkRow(i: number): ChunkRow {
  return {
    id: `chunk-${i}`,
    file_path: `src/module${i % 10}/file${i}.ts`,
    chunk_type: 'function',
    scope: null,
    name: `func_${i}`,
    content: `export function func_${i}() { return ${i}; }`,
    start_line: 1,
    end_line: 5,
    file_type: 'source',
    source_kind: 'file',
    vector: new Array(768).fill(0),
  };
}

async function writeIndexState(dir: string, model: string, dim: number): Promise<void> {
  const stateDir = join(dir, '.brain-cache');
  await mkdir(stateDir, { recursive: true });
  await writeFile(
    join(stateDir, 'index_state.json'),
    JSON.stringify({
      version: 1,
      embeddingModel: model,
      dimension: dim,
      indexedAt: new Date().toISOString(),
      fileCount: 1,
      chunkCount: 10,
    }),
    'utf-8',
  );
}

describe('keyword fallback integration - real LanceDB', () => {
  let testDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockReadProfile.mockResolvedValue(PROFILE);
    testDir = join(tmpdir(), `bc-retriever-int-${randomUUID()}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('keywordSearchChunks returns matching chunks from real table', async () => {
    const db = await openDatabase(testDir);
    const table = await openOrCreateChunkTable(db, testDir, 'nomic-embed-text', 768);
    const rows = Array.from({ length: 20 }, (_, i) => makeChunkRow(i));
    rows[5].name = 'uniqueneedle';
    rows[5].content = 'export function uniqueneedle() { return "found"; }';
    await insertChunks(table, rows);

    const results = await keywordSearchChunks(table, 'uniqueneedle', 10);

    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0]?.name).toBe('uniqueneedle');
  });

  it('keywordSearchChunks returns empty for non-matching query', async () => {
    const db = await openDatabase(testDir);
    const table = await openOrCreateChunkTable(db, testDir, 'nomic-embed-text', 768);
    const rows = Array.from({ length: 20 }, (_, i) => makeChunkRow(i));
    await insertChunks(table, rows);

    const results = await keywordSearchChunks(table, 'xyzzyNotFound', 10);

    expect(results).toHaveLength(0);
  });

  it('runSearch returns fallback results when Ollama unavailable', async () => {
    const db = await openDatabase(testDir);
    const table = await openOrCreateChunkTable(db, testDir, 'nomic-embed-text', 768);
    const rows = Array.from({ length: 20 }, (_, i) => makeChunkRow(i));
    rows[7].name = 'searchtarget';
    rows[7].content = 'export function searchtarget() { return "hit"; }';
    await insertChunks(table, rows);
    await writeIndexState(testDir, 'nomic-embed-text', 768);

    const { runSearch } = await import('../../src/workflows/search.js');
    const result = await runSearch('searchtarget', { path: testDir });

    expect(result.fallback).toBe(true);
    expect(result.chunks.length).toBeGreaterThanOrEqual(1);
    expect(result.chunks.some((chunk) => chunk.name === 'searchtarget')).toBe(true);
  });
});

describe('keyword search at scale - 10k+ rows', () => {
  let testDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockReadProfile.mockResolvedValue(PROFILE);
    testDir = join(tmpdir(), `bc-retriever-int-${randomUUID()}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it(
    'finds needle in 10,100 rows within time and memory bounds',
    { timeout: 30000 },
    async () => {
      const rows = Array.from({ length: 10_100 }, (_, i) => makeChunkRow(i));
      rows[5000].name = 'scaleneedle';
      rows[5000].content = 'export function scaleneedle() { return "found at scale"; }';

      const db = await openDatabase(testDir);
      const table = await openOrCreateChunkTable(db, testDir, 'nomic-embed-text', 768);

      for (let i = 0; i < rows.length; i += 1000) {
        await insertChunks(table, rows.slice(i, i + 1000));
      }

      const heapBefore = process.memoryUsage().heapUsed;
      const results = await keywordSearchChunks(table, 'scaleneedle', 20);
      const heapAfter = process.memoryUsage().heapUsed;
      const deltaMB = (heapAfter - heapBefore) / (1024 * 1024);

      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0]?.name).toBe('scaleneedle');
      expect(deltaMB).toBeLessThan(100);
    },
  );

  it(
    'returns empty for non-matching query on large table',
    { timeout: 30000 },
    async () => {
      const rows = Array.from({ length: 10_100 }, (_, i) => makeChunkRow(i));
      const db = await openDatabase(testDir);
      const table = await openOrCreateChunkTable(db, testDir, 'nomic-embed-text', 768);

      for (let i = 0; i < rows.length; i += 1000) {
        await insertChunks(table, rows.slice(i, i + 1000));
      }

      const results = await keywordSearchChunks(table, 'absolutelyNoMatchXYZ', 20);
      expect(results).toHaveLength(0);
    },
  );
});
