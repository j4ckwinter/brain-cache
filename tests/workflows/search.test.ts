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
  RETRIEVAL_STRATEGIES: {
    lookup:  { limit: 5,  distanceThreshold: 0.4 },
    trace:   { limit: 3,  distanceThreshold: 0.5 },
    explore: { limit: 20, distanceThreshold: 0.6 },
  },
}));

import { readProfile } from '../../src/services/capability.js';
import { isOllamaRunning } from '../../src/services/ollama.js';
import { openDatabase, readIndexState } from '../../src/services/lancedb.js';
import { embedBatchWithRetry } from '../../src/services/embedder.js';
import {
  searchChunks,
  deduplicateChunks,
  classifyRetrievalMode,
} from '../../src/services/retriever.js';

const mockReadProfile = vi.mocked(readProfile);
const mockIsOllamaRunning = vi.mocked(isOllamaRunning);
const mockOpenDatabase = vi.mocked(openDatabase);
const mockReadIndexState = vi.mocked(readIndexState);
const mockEmbedBatchWithRetry = vi.mocked(embedBatchWithRetry);
const mockSearchChunks = vi.mocked(searchChunks);
const mockDeduplicateChunks = vi.mocked(deduplicateChunks);
const mockClassifyRetrievalMode = vi.mocked(classifyRetrievalMode);

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
  embeddingModel: 'mxbai-embed-large', // different from profile to test model source
  dimension: 1024,
  indexedAt: '2026-03-31T00:00:00.000Z',
  fileCount: 10,
  chunkCount: 50,
};

const fakeChunk = (id: string) => ({
  id,
  filePath: `/project/src/${id}.ts`,
  chunkType: 'function',
  scope: null,
  name: `fn_${id}`,
  content: `function fn_${id}() {}`,
  startLine: 1,
  endLine: 5,
  similarity: 0.9,
});

const queryVector = new Array(1024).fill(0.1);

const mockTable = {
  query: vi.fn(),
  countRows: vi.fn().mockResolvedValue(2),
} as any;

const mockDb = {
  tableNames: vi.fn(),
  openTable: vi.fn(),
} as any;

let runSearch: typeof import('../../src/workflows/search.js').runSearch;

describe('runSearch', () => {
  let stderrOutput: string[];
  let stdoutOutput: string[];
  let stderrWriteSpy: ReturnType<typeof vi.spyOn>;
  let stdoutWriteSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    stderrOutput = [];
    stdoutOutput = [];

    stderrWriteSpy = vi.spyOn(process.stderr, 'write').mockImplementation((data: unknown) => {
      stderrOutput.push(String(data));
      return true;
    });
    stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation((data: unknown) => {
      stdoutOutput.push(String(data));
      return true;
    });

    // Happy path defaults
    mockReadProfile.mockResolvedValue({ ...mockProfile });
    mockIsOllamaRunning.mockResolvedValue(true);
    mockReadIndexState.mockResolvedValue({ ...mockIndexState });
    mockOpenDatabase.mockResolvedValue(mockDb);
    mockDb.tableNames.mockResolvedValue(['chunks']);
    mockDb.openTable.mockResolvedValue(mockTable);
    mockEmbedBatchWithRetry.mockResolvedValue({ embeddings: [queryVector], skipped: 0 });
    mockClassifyRetrievalMode.mockReturnValue('explore');

    const rawChunks = [fakeChunk('a'), fakeChunk('b')];
    const dedupedChunks = [fakeChunk('a'), fakeChunk('b')];
    mockSearchChunks.mockResolvedValue(rawChunks);
    mockDeduplicateChunks.mockReturnValue(dedupedChunks);

    // Dynamically import after mocks are in place
    const mod = await import('../../src/workflows/search.js');
    runSearch = mod.runSearch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('calls classifyQueryIntent with the query', async () => {
    await runSearch('how does authentication work');
    expect(mockClassifyRetrievalMode).toHaveBeenCalledWith('how does authentication work');
  });

  it('calls embedBatchWithRetry with model from indexState (not profile)', async () => {
    await runSearch('how does authentication work');
    // indexState.embeddingModel is 'mxbai-embed-large', profile.embeddingModel is 'nomic-embed-text'
    expect(mockEmbedBatchWithRetry).toHaveBeenCalledWith(
      'mxbai-embed-large', // must use indexState model, not profile model
      ['how does authentication work']
    );
  });

  it('calls searchChunks with the strategy from classifyRetrievalMode', async () => {
    mockClassifyRetrievalMode.mockReturnValue('explore');
    await runSearch('why is the login broken');
    expect(mockSearchChunks).toHaveBeenCalledWith(
      mockTable,
      queryVector,
      expect.objectContaining({ limit: 20, distanceThreshold: 0.6 }),
      'why is the login broken'
    );
  });

  it('passes query string as 4th argument to searchChunks (RET-01)', async () => {
    await runSearch('find the compression function');
    expect(mockSearchChunks).toHaveBeenCalled();
    const call = mockSearchChunks.mock.calls[0];
    expect(call[3]).toBe('find the compression function');
  });

  it('calls deduplicateChunks on search results', async () => {
    const rawChunks = [fakeChunk('x'), fakeChunk('y')];
    mockSearchChunks.mockResolvedValue(rawChunks);
    await runSearch('test query');
    expect(mockDeduplicateChunks).toHaveBeenCalledWith(rawChunks);
  });

  it('returns deduplicated chunks', async () => {
    const dedupedChunks = [fakeChunk('only-one')];
    mockDeduplicateChunks.mockReturnValue(dedupedChunks);
    const result = await runSearch('test query');
    expect(result).toEqual(dedupedChunks);
  });

  it('writes search progress to stderr', async () => {
    await runSearch('test query');
    const combined = stderrOutput.join('');
    expect(combined).toContain('brain-cache:');
  });

  it('writes found chunks count to stderr', async () => {
    await runSearch('test query');
    const combined = stderrOutput.join('');
    expect(combined).toContain('found');
    expect(combined).toContain('chunks');
  });

  it('writes nothing to stdout', async () => {
    await runSearch('test query');
    expect(stdoutOutput).toHaveLength(0);
    expect(stdoutWriteSpy).not.toHaveBeenCalled();
  });

  it('throws when no profile found', async () => {
    mockReadProfile.mockResolvedValue(null);
    await expect(runSearch('test query')).rejects.toThrow("No profile found. Run 'brain-cache init' first.");
  });

  it('throws when Ollama is not running', async () => {
    mockIsOllamaRunning.mockResolvedValue(false);
    await expect(runSearch('test query')).rejects.toThrow('Ollama is not running');
  });

  it('throws when no index found', async () => {
    mockReadIndexState.mockResolvedValue(null);
    await expect(runSearch('test query')).rejects.toThrow("Run 'brain-cache index' first.");
  });

  it('applies custom limit option', async () => {
    mockClassifyRetrievalMode.mockReturnValue('explore');
    await runSearch('test query', { limit: 5 });
    expect(mockSearchChunks).toHaveBeenCalledWith(
      mockTable,
      queryVector,
      expect.objectContaining({ limit: 5 }),
      'test query'
    );
  });

  it('uses explore strategy for general queries', async () => {
    mockClassifyRetrievalMode.mockReturnValue('explore');
    await runSearch('how does routing work');
    expect(mockSearchChunks).toHaveBeenCalledWith(
      mockTable,
      queryVector,
      expect.objectContaining({ limit: 20, distanceThreshold: 0.6 }),
      'how does routing work'
    );
  });
});
