/**
 * E2E smoke: tmpdir project + embedded LanceDB + mocked embedder (TEST-01).
 * No live Ollama — embeddings are deterministic fake vectors.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

const mockReadProfile = vi.fn();
const mockEmbedBatchWithRetry = vi.fn();

vi.mock('../../src/services/capability.js', () => ({
  readProfile: (...args: unknown[]) => mockReadProfile(...args),
}));

vi.mock('../../src/services/ollama.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/services/ollama.js')>();
  return {
    ...mod,
    isOllamaRunning: vi.fn().mockResolvedValue(true),
  };
});

vi.mock('../../src/services/embedder.js', () => ({
  embedBatchWithRetry: (...args: unknown[]) => mockEmbedBatchWithRetry(...args),
}));

vi.mock('../../src/services/gitHistory.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/services/gitHistory.js')>(),
  readGitConfig: vi.fn().mockResolvedValue({ enabled: false }),
}));

vi.mock('../../src/services/indexLock.js', () => ({
  acquireIndexLock: vi.fn().mockResolvedValue(undefined),
  releaseIndexLock: vi.fn().mockResolvedValue(undefined),
}));

const profile = {
  version: 1 as const,
  detectedAt: '2026-04-06T00:00:00.000Z',
  vramTier: 'large' as const,
  vramGiB: 16,
  gpuVendor: 'nvidia' as const,
  embeddingModel: 'nomic-embed-text',
  ollamaVersion: '0.6.0',
  platform: 'darwin',
};

const dim = 768;
const fakeVec = () => new Array(dim).fill(0.02);

describe('e2e pipeline', () => {
  let projectRoot: string;

  beforeEach(() => {
    mockReadProfile.mockResolvedValue(profile);
    mockEmbedBatchWithRetry.mockImplementation(async (_model: string, texts: string[]) => ({
      embeddings: texts.map(() => fakeVec()),
      skipped: 0,
      zeroVectorIndices: new Set<number>(),
    }));
    projectRoot = join(tmpdir(), `bc-e2e-${randomUUID()}`);
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('indexes, searches, and builds context in one tmpdir project', async () => {
    await mkdir(join(projectRoot, 'src'), { recursive: true });
    await writeFile(
      join(projectRoot, 'src', 'hello.ts'),
      'export function hello(): string { return "hi"; }\n',
      'utf-8',
    );

    const { runIndex } = await import('../../src/workflows/index.js');
    const { runSearch } = await import('../../src/workflows/search.js');
    const { runBuildContext } = await import('../../src/workflows/buildContext.js');

    await runIndex(projectRoot);

    const searchResult = await runSearch('hello function', { path: projectRoot, limit: 5 });
    expect(searchResult.chunks.length).toBeGreaterThan(0);

    const ctx = await runBuildContext('what does hello return', {
      path: projectRoot,
      maxTokens: 2048,
    });
    expect(ctx.content.length).toBeGreaterThan(0);
    expect(ctx.metadata.tokensSent).toBeGreaterThan(0);
  });

  async function indexFixture() {
    await mkdir(join(projectRoot, 'src'), { recursive: true });
    await writeFile(join(projectRoot, 'src', 'hello.ts'),
      'export function helper() { return 1; }\nexport function hello() { return helper(); }\n');
    const { runIndex } = await import('../../src/workflows/index.js');
    await runIndex(projectRoot);
    return runIndex;
  }

  async function counts() {
    const { getConnection } = await import('../../src/services/lancedb.js');
    const db = await getConnection(projectRoot);
    return {
      chunks: await (await db.openTable('chunks')).countRows(),
      edges: await (await db.openTable('edges')).countRows(),
    };
  }

  it('repeated forced rebuilds replace chunks and edges without duplicates', async () => {
    const runIndex = await indexFixture();
    const initial = await counts();
    expect(initial.chunks).toBeGreaterThan(0);
    expect(initial.edges).toBeGreaterThan(0);
    await runIndex(projectRoot, { force: true });
    expect(await counts()).toEqual(initial);
    await runIndex(projectRoot, { force: true });
    expect(await counts()).toEqual(initial);
  });

  it('rebuilds unchanged files after an embedding model change', async () => {
    const runIndex = await indexFixture();
    const initial = await counts();
    mockReadProfile.mockResolvedValue({ ...profile, embeddingModel: 'mxbai-embed-large' });
    mockEmbedBatchWithRetry.mockImplementation(async (_model: string, texts: string[]) => ({
      embeddings: texts.map(() => new Array(1024).fill(0.02)),
      skipped: 0, zeroVectorIndices: new Set<number>(),
    }));
    await runIndex(projectRoot);
    expect(await counts()).toEqual(initial);
    const { readIndexState } = await import('../../src/services/lancedb.js');
    expect(await readIndexState(projectRoot)).toMatchObject({
      embeddingModel: 'mxbai-embed-large', dimension: 1024, chunkCount: initial.chunks,
    });
  });

  it('clears persisted content and metadata when the last source file is removed', async () => {
    const runIndex = await indexFixture();
    await rm(join(projectRoot, 'src', 'hello.ts'));
    await runIndex(projectRoot);
    expect(await counts()).toEqual({ chunks: 0, edges: 0 });
    const { readIndexState, readFileHashes } = await import('../../src/services/lancedb.js');
    expect(await readIndexState(projectRoot)).toMatchObject({ fileCount: 0, chunkCount: 0 });
    expect((await readFileHashes(projectRoot)).hashes).toEqual({});
  });


  it('recovers a failed forced rebuild on the next ordinary index', async () => {
    const runIndex = await indexFixture();
    const initial = await counts();
    mockEmbedBatchWithRetry.mockRejectedValueOnce(new Error('embedding unavailable'));
    await expect(runIndex(projectRoot, { force: true })).rejects.toThrow('embedding unavailable');
    await runIndex(projectRoot);
    expect(await counts()).toEqual(initial);
  });


  it('rebuilds unchanged files when upgrading a legacy table schema', async () => {
    const runIndex = await indexFixture();
    const initial = await counts();
    const { getConnection } = await import('../../src/services/lancedb.js');
    const db = await getConnection(projectRoot);
    await (await db.openTable('chunks')).dropColumns(['file_type']);
    await runIndex(projectRoot);
    expect(await counts()).toEqual(initial);
    const schema = await (await db.openTable('chunks')).schema();
    expect(schema.fields.some(field => field.name === 'file_type')).toBe(true);
  });

});
