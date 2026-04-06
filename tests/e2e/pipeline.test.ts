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
});
