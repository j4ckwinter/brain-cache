import { Schema } from 'apache-arrow';
import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChunkRow } from '../../src/services/lancedb.js';
import { chunkSchema, insertChunks, openDatabase, openOrCreateChunkTable } from '../../src/services/lancedb.js';
import { keywordSearchChunks, searchChunks } from '../../src/services/retriever.js';

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

  it.each([['source_kind'], ['source_kind', 'file_type']])('reads legacy indexes missing %j without migration', async (...missing) => {
    const db = await openDatabase(testDir);
    const schema = new Schema(chunkSchema(768).fields.filter(field => !missing.includes(field.name)));
    const row = { ...makeChunkRow(0), name: 'findNeedle', content: 'needle details', vector: [1, ...new Array(767).fill(0)] };
    const legacyRow = Object.fromEntries(Object.entries(row).filter(([key]) => !missing.includes(key)));
    const table = await db.createTable('chunks', [legacyRow], { schema });
    for (const query of ['findNeedle', 'needle details']) {
      for (const results of [
        await searchChunks(table, row.vector, { limit: 5, distanceThreshold: 0.4 }, query),
        await keywordSearchChunks(table, query, 5),
      ]) {
        expect(results).toHaveLength(1);
        expect(results[0]).toMatchObject({ id: row.id, sourceKind: 'file', fileType: 'source' });
      }
    }
    expect((await table.schema()).fields.map(field => field.name)).not.toContain('source_kind');
  });

  it.each([0.1, 1])('recovers exact symbols outside the vector shortlist at distance %s', async (distance) => {
    const db = await openDatabase(testDir);
    const table = await openOrCreateChunkTable(db, testDir, 'nomic-embed-text', 768);
    const vector = (x: number, y: number) => [x, y, ...new Array(766).fill(0)];
    const exact = { ...makeChunkRow(99), name: 'findNeedle', vector: vector(1 - distance, Math.sqrt(1 - (1 - distance) ** 2)) };
    await insertChunks(table, [...Array.from({ length: 5 }, (_, i) => ({ ...makeChunkRow(i), vector: vector(1, 0) })), exact]);
    const results = await searchChunks(table, vector(1, 0), { limit: 5, distanceThreshold: 0.4 }, 'FINDNEEDLE');
    expect(results[0]?.id).toBe(exact.id);
    expect(results[0]?.similarity).toBe(0);
    expect(results).toHaveLength(5);
  });

  it('prioritizes exact names beyond 500 body matches and substring wrappers', async () => {
    const db = await openDatabase(testDir);
    const table = await openOrCreateChunkTable(db, testDir, 'nomic-embed-text', 768);
    await insertChunks(table, [
      { ...makeChunkRow(0), name: 'findNeedleWrapper' },
      ...Array.from({ length: 501 }, (_, i) => ({ ...makeChunkRow(i + 1), content: 'findNeedle()' })),
      { ...makeChunkRow(999), name: 'findNeedle' },
    ]);
    const results = await keywordSearchChunks(table, 'FINDNEEDLE', 50);
    expect(results[0]?.id).toBe('chunk-999');
    expect(results).toHaveLength(50);
    expect(new Set(results.map(chunk => chunk.id)).size).toBe(results.length);
  });

  it('retains measured similarity when an exact candidate is also a vector hit beyond the threshold', async () => {
    const db = await openDatabase(testDir);
    const table = await openOrCreateChunkTable(db, testDir, 'nomic-embed-text', 768);
    const vector = [0.6, 0.8, ...new Array(766).fill(0)];
    await insertChunks(table, [{ ...makeChunkRow(0), name: 'findNeedle', vector }]);
    const results = await searchChunks(table, [1, ...new Array(767).fill(0)], { limit: 5, distanceThreshold: 0.2 }, 'findNeedle');
    expect(results).toHaveLength(1);
    expect(results[0].similarity).toBeCloseTo(0.6);
  });

  it.each(['f', 'db', '`db`', '`findNeedle`'])('retrieves standalone identifier %s even with zero vectors', async (query) => {
    const db = await openDatabase(testDir);
    const table = await openOrCreateChunkTable(db, testDir, 'nomic-embed-text', 768);
    const name = query.replaceAll('`', '');
    await insertChunks(table, [{ ...makeChunkRow(0), name }]);
    const options = { limit: 1, distanceThreshold: 0.2 };
    for (const results of [
      await searchChunks(table, [1, ...new Array(767).fill(0)], options, query),
      await keywordSearchChunks(table, query, 1),
    ]) {
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe(name);
      expect(results[0].similarity).toBe(0);
    }
  });

  it('uses stable IDs to break duplicate-name score ties', async () => {
    const db = await openDatabase(testDir);
    const table = await openOrCreateChunkTable(db, testDir, 'nomic-embed-text', 768);
    await insertChunks(table, [
      { ...makeChunkRow(2), name: 'findNeedle', content: 'findNeedle' },
      { ...makeChunkRow(1), name: 'findNeedle', content: 'findNeedle' },
    ]);
    expect((await keywordSearchChunks(table, 'findNeedle', 1)).map(chunk => chunk.id)).toEqual(['chunk-1']);
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

  it('matches mixed-case symbols, paths, and body-only text', async () => {
    const db = await openDatabase(testDir);
    const table = await openOrCreateChunkTable(db, testDir, 'nomic-embed-text', 768);
    const rows = [
      { ...makeChunkRow(0), name: 'CamelTarget', content: 'unrelated' },
      { ...makeChunkRow(1), file_path: 'src/CamelTarget/index.ts', content: 'unrelated' },
      { ...makeChunkRow(2), content: 'CAMELTARGET appears only in this body' },
    ];
    await insertChunks(table, rows);
    const results = await keywordSearchChunks(table, 'CamelTarget', 10);
    expect(results.map(chunk => chunk.id)).toEqual(['chunk-0', 'chunk-1', 'chunk-2']);
  });

  it.each([
    ["owner's", 'owners'],
    ['value%part', 'valueXpart'],
    ['value_part', 'valueXpart'],
    [String.raw`value\part`, 'valuepart'],
  ])('treats %s as literal text in fallback predicates', async (needle, decoy) => {
    const db = await openDatabase(testDir);
    const table = await openOrCreateChunkTable(db, testDir, 'nomic-embed-text', 768);
    await insertChunks(table, [
      { ...makeChunkRow(0), content: needle },
      { ...makeChunkRow(1), content: decoy },
    ]);
    const results = await keywordSearchChunks(table, needle, 10);
    expect(results.map(chunk => chunk.id)).toEqual(['chunk-0']);
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
