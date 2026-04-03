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

vi.mock('../../src/services/tokenCounter.js', () => ({
  assembleContext: vi.fn(),
  countChunkTokens: vi.fn(),
}));

vi.mock('../../src/services/cohesion.js', () => ({
  groupChunksByFile: vi.fn(),
  enrichWithParentClass: vi.fn(),
  formatGroupedContext: vi.fn(),
}));

vi.mock('../../src/services/compression.js', () => ({
  compressChunk: vi.fn((chunk) => chunk),
}));

vi.mock('../../src/services/configLoader.js', () => ({
  loadUserConfig: vi.fn(),
  resolveStrategy: vi.fn(),
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
import { searchChunks, deduplicateChunks } from '../../src/services/retriever.js';
import { assembleContext, countChunkTokens } from '../../src/services/tokenCounter.js';
import { groupChunksByFile, enrichWithParentClass, formatGroupedContext } from '../../src/services/cohesion.js';
import { compressChunk } from '../../src/services/compression.js';
import { loadUserConfig, resolveStrategy } from '../../src/services/configLoader.js';
import { readFile } from 'node:fs/promises';
import { isExportedChunk } from '../../src/workflows/explainCodebase.js';

const mockReadProfile = vi.mocked(readProfile);
const mockIsOllamaRunning = vi.mocked(isOllamaRunning);
const mockOpenDatabase = vi.mocked(openDatabase);
const mockReadIndexState = vi.mocked(readIndexState);
const mockEmbedBatchWithRetry = vi.mocked(embedBatchWithRetry);
const mockSearchChunks = vi.mocked(searchChunks);
const mockDeduplicateChunks = vi.mocked(deduplicateChunks);
const mockAssembleContext = vi.mocked(assembleContext);
const mockCountChunkTokens = vi.mocked(countChunkTokens);
const mockGroupChunksByFile = vi.mocked(groupChunksByFile);
const mockEnrichWithParentClass = vi.mocked(enrichWithParentClass);
const mockFormatGroupedContext = vi.mocked(formatGroupedContext);
const mockCompressChunk = vi.mocked(compressChunk);
const mockLoadUserConfig = vi.mocked(loadUserConfig);
const mockResolveStrategy = vi.mocked(resolveStrategy);
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
  totalTokens: 1000,
};

const queryVector = new Array(768).fill(0.1);

// 4 embeddings — one per ARCHITECTURE_QUERIES entry used in the default (no-question) path
const fourQueryVectors = [queryVector, queryVector, queryVector, queryVector];

// Mock table supports both vector search (nearestTo) and full scan (toArray) for directory tree
const mockQueryBuilder = {
  nearestTo: vi.fn().mockReturnThis(),
  distanceType: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  toArray: vi.fn().mockResolvedValue([
    { file_path: '/project/src/auth.ts' },
    { file_path: '/project/src/router.ts' },
  ]),
};

const mockTable = {
  query: vi.fn(() => mockQueryBuilder),
} as any;

const mockDb = {
  tableNames: vi.fn(),
  openTable: vi.fn(),
} as any;

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

const chunk1 = fakeChunk('c1', '/project/src/auth.ts');
const chunk2 = fakeChunk('c2', '/project/src/router.ts');
const dedupedChunks = [chunk1, chunk2];

let runExplainCodebase: typeof import('../../src/workflows/explainCodebase.js').runExplainCodebase;

describe('runExplainCodebase', () => {
  let stderrOutput: string[];
  let stderrWriteSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    stderrOutput = [];
    stderrWriteSpy = vi.spyOn(process.stderr, 'write').mockImplementation((data: unknown) => {
      stderrOutput.push(String(data));
      return true;
    });

    mockReadProfile.mockResolvedValue({ ...mockProfile });
    mockIsOllamaRunning.mockResolvedValue(true);
    mockReadIndexState.mockResolvedValue({ ...mockIndexState });
    mockOpenDatabase.mockResolvedValue(mockDb);
    mockDb.tableNames.mockResolvedValue(['chunks']);
    mockDb.openTable.mockResolvedValue(mockTable);
    // Default: return 4 embeddings (matches the 4 ARCHITECTURE_QUERIES used in no-question path)
    mockEmbedBatchWithRetry.mockResolvedValue({ embeddings: fourQueryVectors, skipped: 0 });
    mockSearchChunks.mockResolvedValue(dedupedChunks);
    mockDeduplicateChunks.mockReturnValue(dedupedChunks);
    mockAssembleContext.mockReturnValue({
      content: 'assembled content',
      chunks: dedupedChunks,
      tokenCount: 150,
    });
    mockEnrichWithParentClass.mockResolvedValue(dedupedChunks);
    mockGroupChunksByFile.mockReturnValue(new Map([
      ['/project/src/auth.ts', [chunk1]],
      ['/project/src/router.ts', [chunk2]],
    ]));
    mockFormatGroupedContext.mockReturnValue('// ── /project/src/auth.ts ──\ncontent1\n\n---\n\n// ── /project/src/router.ts ──\ncontent2');
    mockCompressChunk.mockImplementation((chunk) => chunk);
    mockCountChunkTokens.mockReturnValue(500);
    mockReadFile.mockResolvedValue('file content here' as any);
    mockLoadUserConfig.mockResolvedValue({});
    mockResolveStrategy.mockReturnValue({ limit: 20, distanceThreshold: 0.6 });
    // Reset query builder mock between tests
    mockQueryBuilder.toArray.mockResolvedValue([
      { file_path: '/project/src/auth.ts' },
      { file_path: '/project/src/router.ts' },
    ]);

    const mod = await import('../../src/workflows/explainCodebase.js');
    runExplainCodebase = mod.runExplainCodebase;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('returns a ContextResult with content, chunks, metadata fields', async () => {
    const result = await runExplainCodebase();
    expect(result).toHaveProperty('content');
    expect(result).toHaveProperty('chunks');
    expect(result).toHaveProperty('metadata');
    expect(result.metadata).toHaveProperty('tokensSent');
    expect(result.metadata).toHaveProperty('estimatedWithoutBraincache');
    expect(result.metadata).toHaveProperty('reductionPct');
    expect(result.metadata).toHaveProperty('filesInContext');
    expect(result.metadata).toHaveProperty('localTasksPerformed');
    expect(result.metadata).toHaveProperty('cloudCallsMade');
  });

  it('uses explore mode strategy (limit:20, distanceThreshold:0.6 defaults)', async () => {
    await runExplainCodebase();
    expect(mockResolveStrategy).toHaveBeenCalledWith('explore', {}, undefined);
  });

  it('content is formatted by formatGroupedContext (file-grouped)', async () => {
    const result = await runExplainCodebase();
    expect(mockFormatGroupedContext).toHaveBeenCalled();
    expect(result.content).toContain('──');
  });

  it('content includes a directory structure preamble', async () => {
    const result = await runExplainCodebase();
    expect(result.content).toContain('## Directory Structure');
  });

  it('uses fallback query as first query in batch when no question provided', async () => {
    await runExplainCodebase();
    const embedCall = mockEmbedBatchWithRetry.mock.calls[0];
    expect(embedCall[1][0]).toBe('module structure and component responsibilities');
  });

  it('sends 4 architecture queries in one batch when no question provided', async () => {
    await runExplainCodebase();
    const embedCall = mockEmbedBatchWithRetry.mock.calls[0];
    expect(embedCall[1]).toHaveLength(4);
  });

  it('uses provided question when given', async () => {
    // Custom question → single query → only 1 embedding returned
    mockEmbedBatchWithRetry.mockResolvedValue({ embeddings: [queryVector], skipped: 0 });
    await runExplainCodebase({ question: 'how is authentication structured' });
    const embedCall = mockEmbedBatchWithRetry.mock.calls[0];
    expect(embedCall[1][0]).toBe('how is authentication structured');
    expect(embedCall[1]).toHaveLength(1);
  });

  it('localTasksPerformed includes embed_query, vector_search, cohesion_group', async () => {
    const result = await runExplainCodebase();
    expect(result.metadata.localTasksPerformed).toContain('embed_query');
    expect(result.metadata.localTasksPerformed).toContain('vector_search');
    expect(result.metadata.localTasksPerformed).toContain('cohesion_group');
  });

  it('localTasksPerformed includes directory_tree', async () => {
    const result = await runExplainCodebase();
    expect(result.metadata.localTasksPerformed).toContain('directory_tree');
  });

  it('only compresses chunks exceeding 500 tokens', async () => {
    // Mock chunks are small (<500 tokens), so compressChunk should not be called
    await runExplainCodebase();
    expect(mockCompressChunk).not.toHaveBeenCalled();
  });

  it('calls loadUserConfig to get user configuration', async () => {
    await runExplainCodebase();
    expect(mockLoadUserConfig).toHaveBeenCalled();
  });

  it('metadata.cloudCallsMade equals 0', async () => {
    const result = await runExplainCodebase();
    expect(result.metadata.cloudCallsMade).toBe(0);
  });

  it('calls enrichWithParentClass for parent class context', async () => {
    await runExplainCodebase();
    expect(mockEnrichWithParentClass).toHaveBeenCalled();
  });

  it('throws when no profile found', async () => {
    mockReadProfile.mockResolvedValue(null);
    await expect(runExplainCodebase()).rejects.toThrow("No profile found. Run 'brain-cache init' first.");
  });

  it('throws when Ollama is not running', async () => {
    mockIsOllamaRunning.mockResolvedValue(false);
    await expect(runExplainCodebase()).rejects.toThrow('Ollama is not running.');
  });

  it('throws when no index found', async () => {
    mockReadIndexState.mockResolvedValue(null);
    await expect(runExplainCodebase()).rejects.toThrow('No index found');
  });

  it('respects maxTokens option', async () => {
    await runExplainCodebase({ maxTokens: 8192 });
    expect(mockAssembleContext).toHaveBeenCalledWith(
      dedupedChunks,
      { maxTokens: 8192 }
    );
  });
});

function makeChunk(overrides: Partial<import('../../src/lib/types.js').RetrievedChunk> = {}): import('../../src/lib/types.js').RetrievedChunk {
  return {
    id: 'chunk-1',
    filePath: '/project/src/foo.ts',
    chunkType: 'function',
    scope: null,
    name: 'myFn',
    content: 'function myFn() {}',
    startLine: 10,
    endLine: 20,
    similarity: 0.9,
    ...overrides,
  };
}

describe('isExportedChunk', () => {
  it('returns true for chunkType "file" regardless of content', () => {
    const chunk = makeChunk({ chunkType: 'file', content: "import { x } from 'y'" });
    expect(isExportedChunk(chunk)).toBe(true);
  });

  it('returns true when first non-JSDoc non-empty line starts with "export "', () => {
    const chunk = makeChunk({ content: 'export function myFn() {}' });
    expect(isExportedChunk(chunk)).toBe(true);
  });

  it('returns false when first non-JSDoc non-empty line does NOT start with "export "', () => {
    const chunk = makeChunk({ content: 'function internal() {}' });
    expect(isExportedChunk(chunk)).toBe(false);
  });

  it('skips JSDoc block and returns true when export follows JSDoc', () => {
    const chunk = makeChunk({ content: '/** docs */\nexport function foo() {}' });
    expect(isExportedChunk(chunk)).toBe(true);
  });

  it('skips multi-line JSDoc block and returns true when export follows', () => {
    const chunk = makeChunk({
      content: '/**\n * docs\n */\nexport function foo() {}',
    });
    expect(isExportedChunk(chunk)).toBe(true);
  });

  it('skips compressed manifest lines and returns true when export follows', () => {
    const chunk = makeChunk({
      content: '// [compressed] fn (lines 1-10)\n// Signature: export function fn()\n// [body stripped]\nexport function fn() {}',
    });
    expect(isExportedChunk(chunk)).toBe(true);
  });

  it('returns false for empty content', () => {
    const chunk = makeChunk({ content: '' });
    expect(isExportedChunk(chunk)).toBe(false);
  });

  it('returns false for JSDoc-only content (no code line after JSDoc)', () => {
    const chunk = makeChunk({ content: '/**\n * Only a comment\n */' });
    expect(isExportedChunk(chunk)).toBe(false);
  });
});
