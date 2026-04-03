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
  RETRIEVAL_STRATEGIES: {
    lookup:  { limit: 5,  distanceThreshold: 0.4 },
    trace:   { limit: 3,  distanceThreshold: 0.5 },
    explore: { limit: 20, distanceThreshold: 0.6 },
  },
}));

vi.mock('../../src/services/flowTracer.js', () => ({
  traceFlow: vi.fn(),
  resolveSymbolToChunkId: vi.fn(),
}));

vi.mock('../../src/services/compression.js', () => ({
  compressChunk: vi.fn((chunk) => chunk),
}));

vi.mock('../../src/services/configLoader.js', () => ({
  loadUserConfig: vi.fn(),
  resolveStrategy: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
}));

import { readProfile } from '../../src/services/capability.js';
import { isOllamaRunning } from '../../src/services/ollama.js';
import { openDatabase, readIndexState } from '../../src/services/lancedb.js';
import { embedBatchWithRetry } from '../../src/services/embedder.js';
import { searchChunks, deduplicateChunks } from '../../src/services/retriever.js';
import { traceFlow, resolveSymbolToChunkId } from '../../src/services/flowTracer.js';
import { compressChunk } from '../../src/services/compression.js';
import { loadUserConfig, resolveStrategy } from '../../src/services/configLoader.js';
import { readFile } from 'node:fs/promises';

const mockReadProfile = vi.mocked(readProfile);
const mockReadFile = vi.mocked(readFile);
const mockIsOllamaRunning = vi.mocked(isOllamaRunning);
const mockOpenDatabase = vi.mocked(openDatabase);
const mockReadIndexState = vi.mocked(readIndexState);
const mockEmbedBatchWithRetry = vi.mocked(embedBatchWithRetry);
const mockSearchChunks = vi.mocked(searchChunks);
const mockDeduplicateChunks = vi.mocked(deduplicateChunks);
const mockTraceFlow = vi.mocked(traceFlow);
const mockResolveSymbolToChunkId = vi.mocked(resolveSymbolToChunkId);
const mockCompressChunk = vi.mocked(compressChunk);
const mockLoadUserConfig = vi.mocked(loadUserConfig);
const mockResolveStrategy = vi.mocked(resolveStrategy);

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
  totalTokens: 1000,
};

const queryVector = new Array(768).fill(0.1);

const mockTable = {} as any;
const mockEdgesTable = {} as any;

const mockDb = {
  tableNames: vi.fn(),
  openTable: vi.fn(),
} as any;

const seedChunk = {
  id: 'seed-chunk-1',
  filePath: '/project/src/auth.ts',
  chunkType: 'function',
  scope: null,
  name: 'authenticate',
  content: 'function authenticate() { return db.findUser(); }',
  startLine: 10,
  endLine: 30,
  similarity: 0.9,
};

const mockFlowHops = [
  {
    chunkId: 'seed-chunk-1',
    filePath: '/project/src/auth.ts',
    name: 'authenticate',
    startLine: 10,
    endLine: 30,
    content: 'function authenticate() { return db.findUser(); }',
    hopDepth: 0,
    callsFound: ['findUser'],
  },
  {
    chunkId: 'hop-1',
    filePath: '/project/src/db.ts',
    name: 'findUser',
    startLine: 5,
    endLine: 20,
    content: 'function findUser() { return query("users"); }',
    hopDepth: 1,
    callsFound: ['query'],
  },
];

let runTraceFlow: typeof import('../../src/workflows/traceFlow.js').runTraceFlow;

describe('runTraceFlow', () => {
  beforeEach(async () => {
    mockReadProfile.mockResolvedValue({ ...mockProfile });
    mockIsOllamaRunning.mockResolvedValue(true);
    mockReadIndexState.mockResolvedValue({ ...mockIndexState });
    mockOpenDatabase.mockResolvedValue(mockDb);
    mockDb.tableNames.mockResolvedValue(['chunks', 'edges']);
    mockDb.openTable.mockImplementation(async (name: string) => {
      if (name === 'edges') return mockEdgesTable;
      return mockTable;
    });
    mockEmbedBatchWithRetry.mockResolvedValue({ embeddings: [queryVector], skipped: 0 });
    mockSearchChunks.mockResolvedValue([seedChunk]);
    mockDeduplicateChunks.mockReturnValue([seedChunk]);
    mockTraceFlow.mockResolvedValue(mockFlowHops);
    mockLoadUserConfig.mockResolvedValue({});
    mockResolveStrategy.mockReturnValue({ limit: 3, distanceThreshold: 0.5 });
    mockCompressChunk.mockImplementation((chunk) => chunk);
    mockResolveSymbolToChunkId.mockResolvedValue(null);

    const mod = await import('../../src/workflows/traceFlow.js');
    runTraceFlow = mod.runTraceFlow;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('returns a TraceFlowResult with hops[] array and metadata object', async () => {
    const result = await runTraceFlow('authenticate function');
    expect(result).toHaveProperty('hops');
    expect(result).toHaveProperty('metadata');
    expect(Array.isArray(result.hops)).toBe(true);
  });

  it('hops contain filePath, name, startLine, content, callsFound, hopDepth fields', async () => {
    const result = await runTraceFlow('authenticate function');
    expect(result.hops.length).toBeGreaterThan(0);
    const hop = result.hops[0];
    expect(hop).toHaveProperty('filePath');
    expect(hop).toHaveProperty('name');
    expect(hop).toHaveProperty('startLine');
    expect(hop).toHaveProperty('content');
    expect(hop).toHaveProperty('callsFound');
    expect(hop).toHaveProperty('hopDepth');
  });

  it('metadata includes seedChunkId, totalHops, localTasksPerformed', async () => {
    const result = await runTraceFlow('authenticate function');
    expect(result.metadata).toHaveProperty('seedChunkId');
    expect(result.metadata).toHaveProperty('totalHops');
    expect(result.metadata).toHaveProperty('localTasksPerformed');
  });

  it('metadata.localTasksPerformed includes embed_query, seed_search, bfs_trace', async () => {
    const result = await runTraceFlow('authenticate function');
    expect(result.metadata.localTasksPerformed).toContain('embed_query');
    expect(result.metadata.localTasksPerformed).toContain('seed_search');
    expect(result.metadata.localTasksPerformed).toContain('bfs_trace');
  });

  it('returns empty hops[] when seed search returns no results', async () => {
    mockDeduplicateChunks.mockReturnValue([]);
    const result = await runTraceFlow('unknown function');
    expect(result.hops).toHaveLength(0);
    expect(result.metadata.seedChunkId).toBeNull();
    expect(result.metadata.totalHops).toBe(0);
  });

  it('localTasksPerformed for empty seed includes only embed_query and seed_search', async () => {
    mockDeduplicateChunks.mockReturnValue([]);
    const result = await runTraceFlow('unknown function');
    expect(result.metadata.localTasksPerformed).toEqual(['embed_query', 'seed_search']);
  });

  it('calls traceFlow with seed chunk ID from first seed result', async () => {
    await runTraceFlow('authenticate function');
    expect(mockTraceFlow).toHaveBeenCalledWith(
      mockEdgesTable,
      mockTable,
      'seed-chunk-1',
      expect.objectContaining({ maxHops: 3 })
    );
  });

  it('applies compressChunk to each hop', async () => {
    await runTraceFlow('authenticate function');
    expect(mockCompressChunk).toHaveBeenCalledTimes(mockFlowHops.length);
  });

  it('calls loadUserConfig to get user configuration', async () => {
    await runTraceFlow('authenticate function');
    expect(mockLoadUserConfig).toHaveBeenCalled();
  });

  it('calls resolveStrategy with trace mode', async () => {
    await runTraceFlow('authenticate function');
    expect(mockResolveStrategy).toHaveBeenCalledWith('trace', {}, undefined);
  });

  it('metadata.totalHops equals the number of hops returned', async () => {
    const result = await runTraceFlow('authenticate function');
    expect(result.metadata.totalHops).toBe(result.hops.length);
  });

  it('metadata.seedChunkId equals the first seed chunk id', async () => {
    const result = await runTraceFlow('authenticate function');
    expect(result.metadata.seedChunkId).toBe('seed-chunk-1');
  });

  it('respects maxHops option passed in', async () => {
    await runTraceFlow('authenticate function', { maxHops: 5 });
    expect(mockTraceFlow).toHaveBeenCalledWith(
      mockEdgesTable,
      mockTable,
      'seed-chunk-1',
      expect.objectContaining({ maxHops: 5 })
    );
  });

  it('throws when no profile found', async () => {
    mockReadProfile.mockResolvedValue(null);
    await expect(runTraceFlow('test')).rejects.toThrow("No profile found. Run 'brain-cache init' first.");
  });

  it('throws when Ollama is not running', async () => {
    mockIsOllamaRunning.mockResolvedValue(false);
    await expect(runTraceFlow('test')).rejects.toThrow('Ollama is not running.');
  });

  it('throws when no index found', async () => {
    mockReadIndexState.mockResolvedValue(null);
    await expect(runTraceFlow('test')).rejects.toThrow('No index found');
  });

  it('throws when edges table is missing', async () => {
    mockDb.tableNames.mockResolvedValue(['chunks']);
    await expect(runTraceFlow('test')).rejects.toThrow('No edges table found');
  });

  it('resolves entry point via exact SQL name lookup when camelCase symbol found in query (RET-03)', async () => {
    mockResolveSymbolToChunkId.mockResolvedValue('seed-chunk-1');
    const result = await runTraceFlow('how does chunkFile work');
    expect(mockResolveSymbolToChunkId).toHaveBeenCalledWith(mockTable, 'chunkFile', '');
    expect(mockEmbedBatchWithRetry).not.toHaveBeenCalled();
    expect(mockTraceFlow).toHaveBeenCalledWith(
      mockEdgesTable,
      mockTable,
      'seed-chunk-1',
      expect.objectContaining({ maxHops: 3 })
    );
    expect(result.hops.length).toBeGreaterThan(0);
  });

  it('falls back to vector search when exact name lookup returns null (RET-03)', async () => {
    mockResolveSymbolToChunkId.mockResolvedValue(null);
    const result = await runTraceFlow('how does chunkFile work');
    expect(mockResolveSymbolToChunkId).toHaveBeenCalled();
    expect(mockEmbedBatchWithRetry).toHaveBeenCalled();
    expect(mockSearchChunks).toHaveBeenCalled();
    expect(result.hops.length).toBeGreaterThan(0);
  });

  it('localTasksPerformed includes exact_name_lookup when exact path taken (RET-03)', async () => {
    mockResolveSymbolToChunkId.mockResolvedValue('seed-chunk-1');
    const result = await runTraceFlow('how does chunkFile work');
    expect(result.metadata.localTasksPerformed).toContain('exact_name_lookup');
    expect(result.metadata.localTasksPerformed).not.toContain('embed_query');
  });

  it('localTasksPerformed does NOT include exact_name_lookup on fallback path (RET-03)', async () => {
    mockResolveSymbolToChunkId.mockResolvedValue(null);
    const result = await runTraceFlow('how does chunkFile work');
    expect(result.metadata.localTasksPerformed).not.toContain('exact_name_lookup');
    expect(result.metadata.localTasksPerformed).toContain('embed_query');
  });

  it('skips exact lookup when query has no extractable symbol candidate (RET-03)', async () => {
    mockResolveSymbolToChunkId.mockResolvedValue(null);
    const result = await runTraceFlow('how does the flow work');
    expect(mockResolveSymbolToChunkId).not.toHaveBeenCalled();
    expect(mockEmbedBatchWithRetry).toHaveBeenCalled();
    expect(result.hops.length).toBeGreaterThan(0);
  });
});

describe('token savings computation (OUT-02)', () => {
  beforeEach(async () => {
    mockReadProfile.mockResolvedValue({ ...mockProfile });
    mockIsOllamaRunning.mockResolvedValue(true);
    mockReadIndexState.mockResolvedValue({ ...mockIndexState });
    mockOpenDatabase.mockResolvedValue(mockDb);
    mockDb.tableNames.mockResolvedValue(['chunks', 'edges']);
    mockDb.openTable.mockImplementation(async (name: string) => {
      if (name === 'edges') return mockEdgesTable;
      return mockTable;
    });
    mockEmbedBatchWithRetry.mockResolvedValue({ embeddings: [queryVector], skipped: 0 });
    mockLoadUserConfig.mockResolvedValue({});
    mockResolveStrategy.mockReturnValue({ limit: 3, distanceThreshold: 0.30 });
    mockCompressChunk.mockImplementation((chunk) => chunk);

    const mod = await import('../../src/workflows/traceFlow.js');
    runTraceFlow = mod.runTraceFlow;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('zero hops — no seed found: returns tokensSent=0, estimatedWithoutBraincache=0, reductionPct=0, filesInContext=0', async () => {
    mockSearchChunks.mockResolvedValue([]);
    mockDeduplicateChunks.mockReturnValue([]);

    const result = await runTraceFlow('nonexistent function');
    expect(result.hops).toHaveLength(0);
    expect(result.metadata.tokensSent).toBe(0);
    expect(result.metadata.estimatedWithoutBraincache).toBe(0);
    expect(result.metadata.reductionPct).toBe(0);
    expect(result.metadata.filesInContext).toBe(0);
  });

  it('non-empty hops — real savings: tokensSent > 0 computed from hop content', async () => {
    mockSearchChunks.mockResolvedValue([seedChunk]);
    mockDeduplicateChunks.mockReturnValue([seedChunk]);
    mockTraceFlow.mockResolvedValue(mockFlowHops);
    mockReadFile.mockResolvedValue('function authenticate() { return db.findUser(); }\n// more file content here that makes file larger than chunk' as any);

    const result = await runTraceFlow('authenticate function');
    expect(result.hops.length).toBeGreaterThan(0);
    expect(result.metadata.tokensSent).toBeGreaterThan(0);
    expect(result.metadata.reductionPct).toBeGreaterThanOrEqual(0);
    expect(result.metadata.reductionPct).toBeLessThanOrEqual(100);
    expect(result.metadata.filesInContext).toBeGreaterThanOrEqual(1);
    expect(result.metadata.estimatedWithoutBraincache).toBeGreaterThanOrEqual(0);
  });

  it('non-empty hops — filesInContext matches unique file count in hops', async () => {
    mockSearchChunks.mockResolvedValue([seedChunk]);
    mockDeduplicateChunks.mockReturnValue([seedChunk]);
    mockTraceFlow.mockResolvedValue(mockFlowHops);
    mockReadFile.mockResolvedValue('file content here' as any);

    const result = await runTraceFlow('authenticate function');
    const uniqueFiles = new Set(mockFlowHops.map(h => h.filePath)).size;
    expect(result.metadata.filesInContext).toBe(uniqueFiles);
  });

  it('non-empty hops — estimatedWithoutBraincache > tokensSent when file is larger than chunk', async () => {
    mockSearchChunks.mockResolvedValue([seedChunk]);
    mockDeduplicateChunks.mockReturnValue([seedChunk]);
    mockTraceFlow.mockResolvedValue(mockFlowHops);
    // Return very large file content so estimated > tokensSent
    const largeContent = 'x '.repeat(5000);
    mockReadFile.mockResolvedValue(largeContent as any);

    const result = await runTraceFlow('authenticate function');
    expect(result.metadata.estimatedWithoutBraincache).toBeGreaterThan(result.metadata.tokensSent);
  });

  it('reductionPct is not hardcoded 67', async () => {
    mockSearchChunks.mockResolvedValue([seedChunk]);
    mockDeduplicateChunks.mockReturnValue([seedChunk]);
    mockTraceFlow.mockResolvedValue(mockFlowHops);
    // Small file content — reductionPct will be near 0 or even 0 (not 67)
    mockReadFile.mockResolvedValue('tiny' as any);

    const result = await runTraceFlow('authenticate function');
    expect(result.metadata.reductionPct).not.toBe(67);
  });

  it('TraceFlowResult.metadata contains all savings fields', async () => {
    mockSearchChunks.mockResolvedValue([seedChunk]);
    mockDeduplicateChunks.mockReturnValue([seedChunk]);
    mockTraceFlow.mockResolvedValue(mockFlowHops);
    mockReadFile.mockResolvedValue('file content' as any);

    const result = await runTraceFlow('authenticate function');
    expect(result.metadata).toHaveProperty('tokensSent');
    expect(result.metadata).toHaveProperty('estimatedWithoutBraincache');
    expect(result.metadata).toHaveProperty('reductionPct');
    expect(result.metadata).toHaveProperty('filesInContext');
  });
});
