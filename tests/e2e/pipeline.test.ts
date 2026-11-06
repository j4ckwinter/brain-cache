/**
 * E2E smoke: tmpdir project + embedded LanceDB + mocked embedder (TEST-01).
 * No live Ollama — embeddings are deterministic fake vectors.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdir, readFile, writeFile, rm, readdir, cp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { resolveIndexDirectory } from '../../src/services/indexStorage.js';
import { CHUNK_FORMAT_VERSION } from '../../src/lib/config.js';

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

async function readSnapshotInChild(projectRoot: string) {
  const script = `
    const { readIndexState, withIndexConnection } = await import(process.argv[1]);
    const { resolveIndexDirectory } = await import(process.argv[2]);
    const root = process.argv[3];
    const directory = await resolveIndexDirectory(root);
    const state = await readIndexState(root, directory);
    const content = await withIndexConnection(root, directory, async db =>
      (await (await db.openTable('chunks')).query().where("name = 'helper'").toArray())[0].content);
    process.stdout.write(JSON.stringify({ state, content }));
  `;
  const result = await promisify(execFile)(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script,
    pathToFileURL(resolve('src/services/lancedb.ts')).href,
    pathToFileURL(resolve('src/services/indexStorage.ts')).href, projectRoot]);
  return JSON.parse(result.stdout) as { state: { chunkCount: number }; content: string };
}

describe('e2e pipeline', () => {
  let projectRoot: string;

  beforeEach(() => {
    mockReadProfile.mockResolvedValue(profile);
    mockEmbedBatchWithRetry.mockImplementation(async (_model: string, texts: string[]) => ({
      embeddings: texts.map(() => fakeVec()),
      skipped: 0,
      zeroVectorIndices: new Set<number>(),
    }));
    projectRoot = join(tmpdir(), `bc-e2e-999-${randomUUID()}`);
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

  it('keeps partial new-file rows unpublished and retries without duplicates', async () => {
    const runIndex = await indexFixture();
    const initial = await counts();
    await writeFile(join(projectRoot, 'src', 'new.ts'), Array.from({ length: 51 }, (_, i) =>
      `export function added${i}() { return helper(); }`).join('\n'));
    mockEmbedBatchWithRetry.mockImplementationOnce(async (_model: string, texts: string[]) => ({
      embeddings: texts.map(() => fakeVec()), skipped: 0, zeroVectorIndices: new Set<number>(),
    })).mockRejectedValueOnce(new Error('interrupted second batch'));
    await expect(runIndex(projectRoot)).rejects.toThrow('interrupted second batch');
    expect(await counts()).toEqual(initial);
    await runIndex(projectRoot);
    expect(await counts()).toEqual({ chunks: initial.chunks + 51, edges: initial.edges + 51 });
    await runIndex(projectRoot);
    expect(await counts()).toEqual({ chunks: initial.chunks + 51, edges: initial.edges + 51 });
  }, 30_000);

  it('retrieves declarations from mixed source files by their exact names', async () => {
    await mkdir(join(projectRoot, 'src'), { recursive: true });
    await writeFile(join(projectRoot, 'src', 'mixed.ts'),
      'interface User { id: string }\nconst MAX_RETRIES = 3;\nfunction retry() { return MAX_RETRIES; }');
    const { runIndex } = await import('../../src/workflows/index.js');
    const { runSearch } = await import('../../src/workflows/search.js');
    await runIndex(projectRoot);
    for (const name of ['User', 'MAX_RETRIES']) {
      const result = await runSearch(name, { path: projectRoot, limit: 1 });
      expect(result.chunks[0]?.name).toBe(name);
    }
  });

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
    const schema = await (await (await getConnection(projectRoot)).openTable('chunks')).schema();
    expect(schema.fields.some(field => field.name === 'file_type')).toBe(true);
  });

  async function downgradeChunkFormat(revision?: number) {
    const path = join(await resolveIndexDirectory(projectRoot), 'index_state.json');
    const state = JSON.parse(await readFile(path, 'utf8'));
    if (revision === undefined) delete state.chunkFormatVersion;
    else state.chunkFormatVersion = revision;
    await writeFile(path, JSON.stringify(state));
  }

  it.each([undefined, 1, 2, 3])('rebuilds unchanged files for obsolete chunk format %s and then reuses it', async (revision) => {
    const runIndex = await indexFixture();
    const initial = await counts();
    await downgradeChunkFormat(revision);
    mockEmbedBatchWithRetry.mockClear();
    await runIndex(projectRoot);
    expect(mockEmbedBatchWithRetry).toHaveBeenCalled();
    expect(await counts()).toEqual(initial);
    const { readIndexState } = await import('../../src/services/lancedb.js');
    expect(await readIndexState(projectRoot)).toMatchObject({ chunkFormatVersion: CHUNK_FORMAT_VERSION });
    mockEmbedBatchWithRetry.mockClear();
    await runIndex(projectRoot);
    expect(mockEmbedBatchWithRetry).not.toHaveBeenCalled();
    expect(await counts()).toEqual(initial);
    expect(await readIndexState(projectRoot)).toMatchObject({ chunkFormatVersion: CHUNK_FORMAT_VERSION });
  });

  it('retries an interrupted chunk format rebuild on the next ordinary index', async () => {
    const runIndex = await indexFixture();
    const initial = await counts();
    await downgradeChunkFormat();
    mockEmbedBatchWithRetry.mockRejectedValueOnce(new Error('embedding unavailable'));
    await expect(runIndex(projectRoot)).rejects.toThrow('embedding unavailable');
    const { readIndexState } = await import('../../src/services/lancedb.js');
    expect((await readIndexState(projectRoot))?.chunkFormatVersion).toBeUndefined();
    expect(await counts()).toEqual(initial);
    await runIndex(projectRoot);
    expect(await counts()).toEqual(initial);
    expect(await readIndexState(projectRoot)).toMatchObject({ chunkFormatVersion: CHUNK_FORMAT_VERSION });
  });

  it('keeps same-line class and method chunks distinct through storage and retrieval', async () => {
    await mkdir(join(projectRoot, 'src'), { recursive: true });
    await writeFile(join(projectRoot, 'src', 'inline.ts'), 'class Example { one() { return 1; } two() { return 2; } }');
    const { runIndex } = await import('../../src/workflows/index.js');
    const { runSearch } = await import('../../src/workflows/search.js');
    await runIndex(projectRoot);
    const result = await runSearch('example methods', { path: projectRoot, limit: 10 });
    expect(result.chunks.map(chunk => chunk.name).sort()).toEqual(['Example', 'one', 'two']);
    expect(new Set(result.chunks.map(chunk => chunk.id)).size).toBe(3);
  });

  it('expands a trace from a parsed caller to its local callee', async () => {
    await mkdir(join(projectRoot, 'src'), { recursive: true });
    await writeFile(join(projectRoot, 'src', 'calls.ts'),
      'export function entry() { return helper(); }\nfunction helper() { return 42; }');
    const { runIndex } = await import('../../src/workflows/index.js');
    const { runBuildContext } = await import('../../src/workflows/buildContext.js');
    await runIndex(projectRoot);
    const context = await runBuildContext('trace from entry', { path: projectRoot, limit: 1 });
    expect(context.chunks.map(chunk => chunk.name)).toEqual(['entry', 'helper']);
    expect(context.metadata.localTasksPerformed).toContain('edge_expansion');
  });

  it('keeps readers on a complete snapshot while a refresh is paused', async () => {
    const runIndex = await indexFixture();
    const { runSearch } = await import('../../src/workflows/search.js');
    const { runBuildContext } = await import('../../src/workflows/buildContext.js');
    const { readIndexState, readFileHashes } = await import('../../src/services/lancedb.js');
    const oldDirectory = await resolveIndexDirectory(projectRoot);
    const oldState = await readIndexState(projectRoot);
    const oldHashes = await readFileHashes(projectRoot);
    await writeFile(join(projectRoot, 'src', 'hello.ts'),
      'export function helper() { return 999; }\nexport function hello() { return helper(); }');
    let resume!: () => void;
    let reached!: () => void;
    const paused = new Promise<void>(resolve => { reached = resolve; });
    const release = new Promise<void>(resolve => { resume = resolve; });
    mockEmbedBatchWithRetry.mockImplementationOnce(async (_model: string, texts: string[]) => {
      reached();
      await release;
      return { embeddings: texts.map(() => fakeVec()), skipped: 0, zeroVectorIndices: new Set<number>() };
    });
    const refresh = runIndex(projectRoot);
    try {
      await paused;
      expect(await resolveIndexDirectory(projectRoot)).toBe(oldDirectory);
      expect(await readIndexState(projectRoot)).toEqual(oldState);
      expect(await readFileHashes(projectRoot)).toEqual(oldHashes);
      const result = await runSearch('helper', { path: projectRoot, limit: 1 });
      expect(result.chunks[0].content).toContain('return 1;');
      const context = await runBuildContext('trace from hello', { path: projectRoot, limit: 1 });
      expect(context.content).toContain('return 1;');
      expect(context.content).not.toContain('return 999;');
      const otherProcess = await readSnapshotInChild(projectRoot);
      expect(otherProcess.state).toEqual(oldState);
      expect(otherProcess.content).toContain('return 1;');
    } finally {
      resume();
      await refresh;
    }
    const result = await runSearch('helper', { path: projectRoot, limit: 1 });
    expect(result.chunks[0].content).toContain('return 999;');
    expect((await readSnapshotInChild(projectRoot)).content).toContain('return 999;');
    const pinned = await runSearch('helper', { path: projectRoot, limit: 1, indexDirectory: oldDirectory });
    expect(pinned.chunks[0].content).toContain('return 1;');
  });

  it('preserves the active model and content after a failed model migration', async () => {
    const runIndex = await indexFixture();
    const { readIndexState } = await import('../../src/services/lancedb.js');
    const oldDirectory = await resolveIndexDirectory(projectRoot);
    const oldState = await readIndexState(projectRoot);
    const initial = await counts();
    mockReadProfile.mockResolvedValue({ ...profile, embeddingModel: 'mxbai-embed-large' });
    mockEmbedBatchWithRetry.mockRejectedValueOnce(new Error('model unavailable'));
    await expect(runIndex(projectRoot)).rejects.toThrow('model unavailable');
    expect(await resolveIndexDirectory(projectRoot)).toBe(oldDirectory);
    expect(await readIndexState(projectRoot)).toEqual(oldState);
    expect(await counts()).toEqual(initial);
  });

  it('pins an in-flight context request while a replacement is published', async () => {
    const runIndex = await indexFixture();
    const originalDirectory = await resolveIndexDirectory(projectRoot);
    const { runBuildContext } = await import('../../src/workflows/buildContext.js');
    let resume!: () => void;
    let reached!: () => void;
    const paused = new Promise<void>(resolve => { reached = resolve; });
    const release = new Promise<void>(resolve => { resume = resolve; });
    mockEmbedBatchWithRetry.mockImplementationOnce(async () => {
      reached();
      await release;
      return { embeddings: [fakeVec()], skipped: 0, zeroVectorIndices: new Set<number>() };
    });
    const request = runBuildContext('trace from hello', { path: projectRoot, limit: 1 });
    try {
      await paused;
      await writeFile(join(projectRoot, 'src', 'hello.ts'),
        'export function helper() { return 999; }\nexport function hello() { return helper(); }');
      await runIndex(projectRoot);
      await runIndex(projectRoot, { force: true });
      await runIndex(projectRoot, { force: true });
    } finally {
      resume();
    }
    const context = await request;
    expect(context.chunks.map(chunk => chunk.name)).toEqual(['hello', 'helper']);
    expect(context.content).toContain('return 1;');
    expect(context.content).not.toContain('return 999;');
    const fresh = await runBuildContext('trace from hello', { path: projectRoot, limit: 1 });
    expect(fresh.content).toContain('return 999;');
    await runIndex(projectRoot);
    await expect(readFile(join(originalDirectory, 'index_state.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readdir(join(projectRoot, '.brain-cache', 'generations'))).toHaveLength(2);
  });

  it('reuses an unchanged generation without embedding or rewriting metadata', async () => {
    const runIndex = await indexFixture();
    const directory = await resolveIndexDirectory(projectRoot);
    const state = await readFile(join(directory, 'index_state.json'), 'utf8');
    mockEmbedBatchWithRetry.mockClear();
    for (let i = 0; i < 5; i++) await runIndex(projectRoot);
    await runIndex(projectRoot, { verify: true });
    expect(await resolveIndexDirectory(projectRoot)).toBe(directory);
    expect(await readdir(join(projectRoot, '.brain-cache', 'generations'))).toHaveLength(1);
    expect(await readFile(join(directory, 'index_state.json'), 'utf8')).toBe(state);
    expect(mockEmbedBatchWithRetry).not.toHaveBeenCalled();
  });

  it('publishes a forced generation even when files are unchanged', async () => {
    const runIndex = await indexFixture();
    const directory = await resolveIndexDirectory(projectRoot);
    await runIndex(projectRoot, { force: true });
    expect(await resolveIndexDirectory(projectRoot)).not.toBe(directory);
  });

  it('does not skip missing metadata or verified hash mismatches', async () => {
    const runIndex = await indexFixture();
    const { readFileHashes, writeFileHashes } = await import('../../src/services/lancedb.js');
    const original = await resolveIndexDirectory(projectRoot);
    const manifest = await readFileHashes(projectRoot);
    const file = join(projectRoot, 'src', 'hello.ts');
    delete manifest.tokenCounts[file];
    await writeFileHashes(projectRoot, manifest);
    mockEmbedBatchWithRetry.mockClear();
    await runIndex(projectRoot);
    expect(await resolveIndexDirectory(projectRoot)).not.toBe(original);
    expect((await readFileHashes(projectRoot)).tokenCounts[file]).toBeGreaterThan(0);
    expect(mockEmbedBatchWithRetry).not.toHaveBeenCalled();
    const repaired = await resolveIndexDirectory(projectRoot);
    const wrongHash = await readFileHashes(projectRoot);
    wrongHash.hashes[file] = 'incorrect hash';
    await writeFileHashes(projectRoot, wrongHash);
    await runIndex(projectRoot, { verify: true });
    expect(await resolveIndexDirectory(projectRoot)).not.toBe(repaired);
    expect(mockEmbedBatchWithRetry).toHaveBeenCalled();
  });

  it('migrates an unchanged legacy layout instead of treating it as a no-op', async () => {
    const runIndex = await indexFixture();
    const directory = await resolveIndexDirectory(projectRoot);
    const legacy = join(projectRoot, '.brain-cache');
    for (const name of ['index', 'index_state.json', 'file-hashes.json']) {
      await cp(join(directory, name), join(legacy, name), { recursive: true });
    }
    await rm(join(legacy, 'active.json'));
    expect(await resolveIndexDirectory(projectRoot)).toBe(legacy);
    await runIndex(projectRoot);
    expect(await resolveIndexDirectory(projectRoot)).not.toBe(legacy);
  });

  it('uses the same text decoding for indexing and verification', async () => {
    const runIndex = await indexFixture();
    await writeFile(join(projectRoot, 'src', 'hello.ts'), Buffer.concat([
      Buffer.from('export function hello() { return 1; } // '), Buffer.from([0xff]),
    ]));
    await runIndex(projectRoot);
    const directory = await resolveIndexDirectory(projectRoot);
    await runIndex(projectRoot, { verify: true });
    expect(await resolveIndexDirectory(projectRoot)).toBe(directory);
  });

});
