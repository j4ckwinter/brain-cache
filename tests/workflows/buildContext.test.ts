import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock all service dependencies before importing the workflow
vi.mock('../../src/services/capability.js', () => ({
  readProfile: vi.fn(),
}));

vi.mock('../../src/services/ollama.js', () => ({
  isOllamaRunning: vi.fn(),
}));

vi.mock('../../src/services/lancedb.js', () => ({
  getConnection: vi.fn(),
  readIndexState: vi.fn(),
  readFileHashes: vi.fn(),
}));

vi.mock('../../src/services/embedder.js', () => ({
  embedBatchWithRetry: vi.fn(),
}));

vi.mock('../../src/services/retriever.js', () => ({
  searchChunks: vi.fn(),
  deduplicateChunks: vi.fn(),
  classifyRetrievalMode: vi.fn(),
  filterDedupedForNonTestChunks: vi.fn((chunks: unknown[]) => chunks),
  expandByEdges: vi.fn(async () => []),
  RETRIEVAL_STRATEGIES: {
    lookup:  { limit: 5,  distanceThreshold: 0.4, keywordBoostWeight: 0.40 },
    trace:   { limit: 3,  distanceThreshold: 0.5, keywordBoostWeight: 0.20 },
    explore: { limit: 20, distanceThreshold: 0.6, keywordBoostWeight: 0.10 },
  },
}));

vi.mock('../../src/lib/grepStyleBaseline.js', () => ({
  computeGrepStyleBaseline: async () => ({
    grepBaselineTokens: 1900,
    filesUsed: 2,
  }),
  GREP_BASELINE_TOP_FILES: 5,
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
import { getConnection, readIndexState, readFileHashes } from '../../src/services/lancedb.js';
import { embedBatchWithRetry } from '../../src/services/embedder.js';
import {
  searchChunks,
  deduplicateChunks,
  classifyRetrievalMode,
  expandByEdges,
} from '../../src/services/retriever.js';
import { assembleContext, countChunkTokens } from '../../src/services/tokenCounter.js';
import { readFile } from 'node:fs/promises';

const mockReadProfile = vi.mocked(readProfile);
const mockIsOllamaRunning = vi.mocked(isOllamaRunning);
const mockGetConnection = vi.mocked(getConnection);
const mockReadFileHashes = vi.mocked(readFileHashes);
const mockReadIndexState = vi.mocked(readIndexState);
const mockEmbedBatchWithRetry = vi.mocked(embedBatchWithRetry);
const mockSearchChunks = vi.mocked(searchChunks);
const mockDeduplicateChunks = vi.mocked(deduplicateChunks);
const mockClassifyQueryIntent = vi.mocked(classifyRetrievalMode);
const mockExpandByEdges = vi.mocked(expandByEdges);
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
  sourceKind: 'file' as const,
  scope: null,
  name: `fn_${id}`,
  content: `function fn_${id}() {}`,
  startLine: 1,
  endLine: 5,
  fileType: 'source',
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
    mockGetConnection.mockResolvedValue(mockDb);
    // Return empty tokenCounts by default — exercises the fallback disk-read path
    mockReadFileHashes.mockResolvedValue({ hashes: {}, tokenCounts: {} });
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
    // Per-chunk content token count (matched pool); file reads for grep baseline are mocked separately
    mockCountChunkTokens.mockReturnValue(500);
    mockReadFile.mockResolvedValue('file content here' as any);
    mockExpandByEdges.mockResolvedValue([]);

    // Dynamically import after mocks are in place
    const mod = await import('../../src/workflows/buildContext.js');
    runBuildContext = mod.runBuildContext;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('returns a ContextResult with expected metadata fields present', async () => {
    const result = await runBuildContext('how does authentication work');
    expect(result).toHaveProperty('content');
    expect(result).toHaveProperty('chunks');
    expect(result).toHaveProperty('metadata');
    expect(result.metadata).toHaveProperty('tokensSent');
    expect(result.metadata).toHaveProperty('estimatedWithoutBraincache');
    expect(result.metadata).toHaveProperty('reductionPct');
    expect(result.metadata).toHaveProperty('matchedPoolTokens');
    expect(result.metadata).toHaveProperty('filteringPct');
    expect(result.metadata).toHaveProperty('savingsDisplayMode');
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

  it('computes matchedPoolTokens from deduped chunk bodies', async () => {
    mockAssembleContext.mockReturnValue({
      content: 'assembled',
      chunks: dedupedChunks,
      tokenCount: 150,
    });
    mockCountChunkTokens.mockReturnValue(500);

    const result = await runBuildContext('test query');
    expect(result.metadata.matchedPoolTokens).toBe(1000);
  });

  it('computes reductionPct vs grep-style baseline (mocked)', async () => {
    mockAssembleContext.mockReturnValue({
      content: 'assembled',
      chunks: dedupedChunks,
      tokenCount: 150,
    });
    mockCountChunkTokens.mockReturnValue(500);

    const result = await runBuildContext('test query');
    expect(result.metadata.tokensSent).toBe(150);
    expect(result.metadata.estimatedWithoutBraincache).toBe(1900);
    expect(result.metadata.reductionPct).toBe(92);
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

  it('appends a Git History section after source context when history chunks exist', async () => {
    const sourceChunk = fakeChunk('c1', '/project/src/index.ts');
    const historyChunk = {
      ...fakeChunk('h1', ''),
      chunkType: 'commit',
      sourceKind: 'history' as const,
      name: 'abc1234',
      content: 'Commit: abc1234\nTouched files:\n- src/index.ts (+1/-0)',
    };
    mockSearchChunks.mockResolvedValue([sourceChunk, historyChunk]);
    mockDeduplicateChunks.mockReturnValue([sourceChunk, historyChunk]);
    mockAssembleContext.mockReturnValue({
      content: '## Source Context\n\nsource body',
      chunks: [sourceChunk],
      tokenCount: 120,
    });

    const result = await runBuildContext('why was this changed?');
    expect(result.content).toContain('## Source Context');
    expect(result.content).toContain('## Git History');
    expect(result.content.indexOf('## Source Context')).toBeLessThan(
      result.content.indexOf('## Git History'),
    );
  });

  it('calls expandByEdges when mode is trace and edges table exists', async () => {
    mockDb.tableNames.mockResolvedValue(['chunks', 'edges']);
    mockClassifyQueryIntent.mockReturnValue('trace');

    await runBuildContext('trace the call path from CLI to storage');

    expect(mockExpandByEdges).toHaveBeenCalledOnce();
  });

  it('does not call expandByEdges when mode is trace but no edges table', async () => {
    // Default: tableNames returns only ['chunks'] — no edges table
    mockClassifyQueryIntent.mockReturnValue('trace');

    await runBuildContext('trace the call path from CLI to storage');

    expect(mockExpandByEdges).not.toHaveBeenCalled();
  });

  it('does not call expandByEdges when mode is explore even with edges table', async () => {
    mockDb.tableNames.mockResolvedValue(['chunks', 'edges']);
    mockClassifyQueryIntent.mockReturnValue('explore');

    await runBuildContext('how does authentication work');

    expect(mockExpandByEdges).not.toHaveBeenCalled();
  });

  it('includes edge_expansion in localTasksPerformed when mode is trace with edges table', async () => {
    mockDb.tableNames.mockResolvedValue(['chunks', 'edges']);
    mockClassifyQueryIntent.mockReturnValue('trace');

    const result = await runBuildContext('trace the call path from CLI to storage');

    expect(result.metadata.localTasksPerformed).toContain('edge_expansion');
  });

  it('does not include edge_expansion in localTasksPerformed when mode is explore', async () => {
    mockDb.tableNames.mockResolvedValue(['chunks', 'edges']);
    mockClassifyQueryIntent.mockReturnValue('explore');

    const result = await runBuildContext('how does auth work');

    expect(result.metadata.localTasksPerformed).not.toContain('edge_expansion');
  });
});
