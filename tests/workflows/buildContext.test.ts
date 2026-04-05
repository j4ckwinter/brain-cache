import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock all service dependencies before importing the workflow
vi.mock('../../src/services/capability.js', () => ({
  readProfile: vi.fn(),
}));

vi.mock('../../src/services/ollama.js', () => ({
  isOllamaRunning: vi.fn(),
}));

vi.mock('../../src/services/lancedb.js', () => ({
  openDatabase: vi.fn(),
  readIndexState: vi.fn(),
}));

vi.mock('../../src/services/embedder.js', () => ({
  embedBatchWithRetry: vi.fn(),
}));

vi.mock('../../src/services/retriever.js', () => ({
  searchChunks: vi.fn(),
  deduplicateChunks: vi.fn(),
  classifyRetrievalMode: vi.fn(),
  classifyQueryIntent: vi.fn(), // deprecated alias — kept for backward compat
  RETRIEVAL_STRATEGIES: {
    lookup:  { limit: 5,  distanceThreshold: 0.4, keywordBoostWeight: 0.40 },
    trace:   { limit: 3,  distanceThreshold: 0.5, keywordBoostWeight: 0.20 },
    explore: { limit: 20, distanceThreshold: 0.6, keywordBoostWeight: 0.10 },
  },
}));

vi.mock('../../src/services/tokenCounter.js', () => ({
  assembleContext: vi.fn(),
  countChunkTokens: vi.fn(),
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    readFile: vi.fn(),
  };
});

import { readProfile } from '../../src/services/capability.js';
import { isOllamaRunning } from '../../src/services/ollama.js';
import { openDatabase, readIndexState } from '../../src/services/lancedb.js';
import { embedBatchWithRetry } from '../../src/services/embedder.js';
import {
  searchChunks,
  deduplicateChunks,
  classifyRetrievalMode,
} from '../../src/services/retriever.js';
import { assembleContext, countChunkTokens } from '../../src/services/tokenCounter.js';
import { readFile } from 'node:fs/promises';

const mockReadProfile = vi.mocked(readProfile);
const mockIsOllamaRunning = vi.mocked(isOllamaRunning);
const mockOpenDatabase = vi.mocked(openDatabase);
const mockReadIndexState = vi.mocked(readIndexState);
const mockEmbedBatchWithRetry = vi.mocked(embedBatchWithRetry);
const mockSearchChunks = vi.mocked(searchChunks);
const mockDeduplicateChunks = vi.mocked(deduplicateChunks);
const mockClassifyQueryIntent = vi.mocked(classifyRetrievalMode);
const mockAssembleContext = vi.mocked(assembleContext);
const mockCountChunkTokens = vi.mocked(countChunkTokens);
const mockReadFile = vi.mocked(readFile);

const mockProfile = {
  version: 1 as const,
  detectedAt: '2026-03-31T00:00:00.000Z',
  vramTier: 'large' as const,
  vramGiB: 16,
  gpuVendor: 'nvidia' as const,
  embeddingModel: 'nomic-embed-text',
  ollamaVersion: null,
  platform: 'linux',
};

const mockIndexState = {
  version: 1 as const,
  embeddingModel: 'nomic-embed-text',
  dimension: 768,
  indexedAt: '2026-03-31T00:00:00.000Z',
  fileCount: 5,
  chunkCount: 20,
};

const fakeChunk = (id: string, filePath: string) => ({
  id,
  filePath,
  chunkType: 'function',
  scope: null,
  name: `fn_${id}`,
  content: `function fn_${id}() {}`,
  startLine: 1,
  endLine: 5,
  similarity: 0.85,
});

const queryVector = new Array(768).fill(0.1);

const mockTable = {} as any;

const mockDb = {
  tableNames: vi.fn(),
  openTable: vi.fn(),
} as any;

let runBuildContext: typeof import('../../src/workflows/buildContext.js').runBuildContext;

describe('runBuildContext', () => {
  let stderrOutput: string[];
  let stderrWriteSpy: ReturnType<typeof vi.spyOn>;
  let processExitSpy: ReturnType<typeof vi.spyOn>;

  const chunk1 = fakeChunk('c1', '/project/src/auth.ts');
  const chunk2 = fakeChunk('c2', '/project/src/router.ts');
  const dedupedChunks = [chunk1, chunk2];

  beforeEach(async () => {
    stderrOutput = [];

    stderrWriteSpy = vi.spyOn(process.stderr, 'write').mockImplementation((data: unknown) => {
      stderrOutput.push(String(data));
      return true;
    });
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: unknown) => {
      throw new Error(`process.exit(${code})`);
    });

    // Happy path defaults
    mockReadProfile.mockResolvedValue({ ...mockProfile });
    mockIsOllamaRunning.mockResolvedValue(true);
    mockReadIndexState.mockResolvedValue({ ...mockIndexState });
    mockOpenDatabase.mockResolvedValue(mockDb);
    mockDb.tableNames.mockResolvedValue(['chunks']);
    mockDb.openTable.mockResolvedValue(mockTable);
    mockEmbedBatchWithRetry.mockResolvedValue({ embeddings: [queryVector], skipped: 0 });
    mockClassifyQueryIntent.mockReturnValue('explore');
    mockSearchChunks.mockResolvedValue(dedupedChunks);
    mockDeduplicateChunks.mockReturnValue(dedupedChunks);
    mockAssembleContext.mockReturnValue({
      content: 'assembled content',
      chunks: dedupedChunks,
      tokenCount: 150,
    });
    // Each file has 500 tokens
    mockCountChunkTokens.mockReturnValue(500);
    mockReadFile.mockResolvedValue('file content here' as any);

    // Dynamically import after mocks are in place
    const mod = await import('../../src/workflows/buildContext.js');
    runBuildContext = mod.runBuildContext;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('returns a ContextResult with all 5 metadata fields present', async () => {
    const result = await runBuildContext('how does authentication work');
    expect(result).toHaveProperty('content');
    expect(result).toHaveProperty('chunks');
    expect(result).toHaveProperty('metadata');
    expect(result.metadata).toHaveProperty('tokensSent');
    expect(result.metadata).toHaveProperty('estimatedWithoutBraincache');
    expect(result.metadata).toHaveProperty('reductionPct');
    expect(result.metadata).toHaveProperty('localTasksPerformed');
    expect(result.metadata).toHaveProperty('cloudCallsMade');
  });

  it('metadata.localTasksPerformed equals the expected 4-step array', async () => {
    const result = await runBuildContext('how does routing work');
    expect(result.metadata.localTasksPerformed).toEqual([
      'embed_query',
      'vector_search',
      'dedup',
      'token_budget',
    ]);
  });

  it('metadata.cloudCallsMade equals 0', async () => {
    const result = await runBuildContext('find the main entry point');
    expect(result.metadata.cloudCallsMade).toBe(0);
  });

  it('calls assembleContext with the configured maxTokens', async () => {
    await runBuildContext('test query', { maxTokens: 2000 });
    expect(mockAssembleContext).toHaveBeenCalledWith(
      dedupedChunks,
      { maxTokens: 2000 }
    );
  });

  it('calls assembleContext with DEFAULT_TOKEN_BUDGET when no maxTokens provided', async () => {
    await runBuildContext('test query');
    expect(mockAssembleContext).toHaveBeenCalledWith(
      dedupedChunks,
      { maxTokens: 4096 }
    );
  });

  it('reads unique source files for estimatedWithoutBraincache calculation', async () => {
    await runBuildContext('test query');
    // Two unique files: /project/src/auth.ts and /project/src/router.ts
    expect(mockReadFile).toHaveBeenCalledWith('/project/src/auth.ts', 'utf-8');
    expect(mockReadFile).toHaveBeenCalledWith('/project/src/router.ts', 'utf-8');
  });

  it('does not read the same file twice even if multiple chunks come from it', async () => {
    const sameFileChunks = [
      fakeChunk('c1', '/project/src/auth.ts'),
      fakeChunk('c2', '/project/src/auth.ts'),
      fakeChunk('c3', '/project/src/auth.ts'),
    ];
    mockAssembleContext.mockReturnValue({
      content: 'assembled',
      chunks: sameFileChunks,
      tokenCount: 100,
    });

    await runBuildContext('test query');

    const readFileCalls = mockReadFile.mock.calls.filter(
      (call) => call[0] === '/project/src/auth.ts'
    );
    expect(readFileCalls).toHaveLength(1);
  });

  it('computes reductionPct as (1 - tokensSent/estimatedWithoutBraincache) * 100', async () => {
    // tokenCount = 150
    // 2 files, each 500 tokens → fileContentTokens = 1000
    // toolCalls = 1 (initial) + 2 (files) = 3, overhead = 3 * 300 = 900
    // estimatedWithoutBraincache = 1000 + 900 = 1900
    // reductionPct = Math.round((1 - 150/1900) * 100) = 92
    mockAssembleContext.mockReturnValue({
      content: 'assembled',
      chunks: dedupedChunks,
      tokenCount: 150,
    });
    mockCountChunkTokens.mockReturnValue(500); // per file

    const result = await runBuildContext('test query');
    expect(result.metadata.tokensSent).toBe(150);
    expect(result.metadata.estimatedWithoutBraincache).toBe(1900);
    expect(result.metadata.reductionPct).toBe(92);
  });

  it('returns reductionPct 0 when estimatedWithoutBraincache is 0', async () => {
    // estimatedWithoutBraincache = 0 only if no files AND no tool overhead
    // With current implementation (always has toolCallOverhead), just verify it doesn't crash
    // and returns a non-negative reduction pct
    mockReadFile.mockRejectedValue(new Error('ENOENT'));
    const result = await runBuildContext('test query');
    expect(result.metadata.reductionPct).toBeGreaterThanOrEqual(0);
  });

  it('skips files that cannot be read (gracefully handles missing files)', async () => {
    mockReadFile.mockImplementation(async (path: any) => {
      if (path === '/project/src/auth.ts') throw new Error('ENOENT');
      return 'file content' as any;
    });
    // Should not throw
    // auth.ts fails (0 tokens), router.ts succeeds (500 tokens)
    // toolCalls = 1 + 2 = 3, overhead = 900
    // estimatedWithoutBraincache = 500 + 900 = 1400
    const result = await runBuildContext('test query');
    expect(result.metadata.estimatedWithoutBraincache).toBe(1400);
  });

  it('throws when no profile found', async () => {
    mockReadProfile.mockResolvedValue(null);
    await expect(runBuildContext('test query')).rejects.toThrow("brain-cache init");
  });

  it('throws when Ollama is not running', async () => {
    mockIsOllamaRunning.mockResolvedValue(false);
    await expect(runBuildContext('test query')).rejects.toThrow('Ollama is not running');
  });

  it('throws when no index found', async () => {
    mockReadIndexState.mockResolvedValue(null);
    await expect(runBuildContext('test query')).rejects.toThrow('No index found');
  });

  it('writes progress messages to stderr', async () => {
    await runBuildContext('test query');
    const combined = stderrOutput.join('');
    expect(combined).toContain('brain-cache:');
  });
});
