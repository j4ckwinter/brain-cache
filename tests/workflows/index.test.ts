import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock all service dependencies before importing the workflow
vi.mock('../../src/services/capability.js', () => ({
  readProfile: vi.fn(),
}));

vi.mock('../../src/services/ollama.js', () => ({
  isOllamaRunning: vi.fn(),
}));

vi.mock('../../src/services/crawler.js', () => ({
  crawlSourceFiles: vi.fn(),
}));

vi.mock('../../src/services/chunker.js', () => ({
  chunkFile: vi.fn(),
}));

vi.mock('../../src/services/embedder.js', () => ({
  embedBatchWithRetry: vi.fn(),
}));

vi.mock('../../src/services/indexLock.js', () => ({
  acquireIndexLock: vi.fn(),
  releaseIndexLock: vi.fn(),
}));

vi.mock('../../src/services/lancedb.js', () => ({
  getConnection: vi.fn(),
  openOrCreateChunkTable: vi.fn(),
  openOrCreateEdgesTable: vi.fn(),
  insertChunks: vi.fn(),
  insertEdges: vi.fn(),
  writeIndexState: vi.fn(),
  readFileHashes: vi.fn(),
  writeFileHashes: vi.fn(),
  deleteChunksByFilePaths: vi.fn(),
  createVectorIndexIfNeeded: vi.fn(),
  withWriteLock: vi.fn(),
  classifyFileType: vi.fn((filePath: string) => filePath.includes('.test.') ? 'test' : 'source'),
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    readFile: vi.fn(),
  };
});

vi.mock('../../src/services/tokenCounter.js', () => ({
  countChunkTokens: vi.fn().mockReturnValue(50),
}));

import { readProfile } from '../../src/services/capability.js';
import { isOllamaRunning } from '../../src/services/ollama.js';
import { acquireIndexLock, releaseIndexLock } from '../../src/services/indexLock.js';
import { crawlSourceFiles } from '../../src/services/crawler.js';
import { chunkFile } from '../../src/services/chunker.js';
import { embedBatchWithRetry } from '../../src/services/embedder.js';
import {
  getConnection,
  openOrCreateChunkTable,
  openOrCreateEdgesTable,
  insertChunks,
  insertEdges,
  writeIndexState,
  readFileHashes,
  writeFileHashes,
  deleteChunksByFilePaths,
  createVectorIndexIfNeeded,
  withWriteLock,
  classifyFileType,
} from '../../src/services/lancedb.js';
import { readFile } from 'node:fs/promises';
import { countChunkTokens } from '../../src/services/tokenCounter.js';

const mockAcquireIndexLock = vi.mocked(acquireIndexLock);
const mockReleaseIndexLock = vi.mocked(releaseIndexLock);
const mockReadProfile = vi.mocked(readProfile);
const mockIsOllamaRunning = vi.mocked(isOllamaRunning);
const mockCrawlSourceFiles = vi.mocked(crawlSourceFiles);
const mockChunkFile = vi.mocked(chunkFile);
const mockEmbedBatchWithRetry = vi.mocked(embedBatchWithRetry);
const mockGetConnection = vi.mocked(getConnection);
const mockOpenOrCreateChunkTable = vi.mocked(openOrCreateChunkTable);
const mockOpenOrCreateEdgesTable = vi.mocked(openOrCreateEdgesTable);
const mockInsertChunks = vi.mocked(insertChunks);
const mockInsertEdges = vi.mocked(insertEdges);
const mockWriteIndexState = vi.mocked(writeIndexState);
const mockReadFileHashes = vi.mocked(readFileHashes);
const mockWriteFileHashes = vi.mocked(writeFileHashes);
const mockDeleteChunksByFilePaths = vi.mocked(deleteChunksByFilePaths);
const mockCreateVectorIndexIfNeeded = vi.mocked(createVectorIndexIfNeeded);
const mockWithWriteLock = vi.mocked(withWriteLock);
const mockReadFile = vi.mocked(readFile);
const mockCountChunkTokens = vi.mocked(countChunkTokens);
const mockClassifyFileType = vi.mocked(classifyFileType);

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

const mockDb = {} as any;
const mockTable = {} as any;

const fakeFiles = ['/project/src/foo.ts', '/project/src/bar.ts'];

const fakeChunk = (filePath: string, i: number) => ({
  id: `${filePath}:${i}`,
  filePath,
  chunkType: 'function' as const,
  scope: null,
  name: `fn${i}`,
  content: `function fn${i}() {}`,
  startLine: i,
  endLine: i + 2,
});

// 768-dim zero vector for nomic-embed-text
const zeroVector768 = new Array(768).fill(0);

let runIndex: (targetPath?: string) => Promise<void>;

describe('runIndex', () => {
  let stderrOutput: string[];
  let stdoutOutput: string[];
  let stderrWriteSpy: ReturnType<typeof vi.spyOn>;
  let stdoutWriteSpy: ReturnType<typeof vi.spyOn>;
  let processExitSpy: ReturnType<typeof vi.spyOn>;

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
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: unknown) => {
      throw new Error(`process.exit(${code})`);
    });

    // Lock defaults: no-op (always succeeds)
    mockAcquireIndexLock.mockResolvedValue(undefined);
    mockReleaseIndexLock.mockResolvedValue(undefined);

    // Happy path defaults
    mockReadProfile.mockResolvedValue({ ...mockProfile });
    mockIsOllamaRunning.mockResolvedValue(true);
    mockCrawlSourceFiles.mockResolvedValue(fakeFiles);
    mockReadFile.mockResolvedValue('const x = 1;' as any);
    // chunkFile now returns { chunks, edges } — provide that shape
    mockChunkFile.mockImplementation((filePath, _content) => ({ chunks: [fakeChunk(filePath, 1)], edges: [] }));
    mockEmbedBatchWithRetry.mockResolvedValue({ embeddings: [zeroVector768, zeroVector768], skipped: 0, zeroVectorIndices: new Set() });
    mockGetConnection.mockResolvedValue(mockDb);
    mockOpenOrCreateChunkTable.mockResolvedValue(mockTable);
    mockOpenOrCreateEdgesTable.mockResolvedValue({ delete: vi.fn(), countRows: vi.fn().mockResolvedValue(0) } as any);
    mockInsertChunks.mockResolvedValue(undefined);
    mockInsertEdges.mockResolvedValue(undefined);
    mockWriteIndexState.mockResolvedValue(undefined);
    // Incremental indexing: empty stored hashes = full index on first run
    mockReadFileHashes.mockResolvedValue({ hashes: {}, tokenCounts: {} });
    mockWriteFileHashes.mockResolvedValue(undefined);
    mockDeleteChunksByFilePaths.mockResolvedValue(undefined);
    mockCreateVectorIndexIfNeeded.mockResolvedValue(undefined);
    // withWriteLock: just call the callback
    mockWithWriteLock.mockImplementation(async (fn) => fn());
    // table needs countRows for index state
    (mockTable as any).countRows = vi.fn().mockResolvedValue(fakeFiles.length);

    // Dynamically import after mocks are in place
    const mod = await import('../../src/workflows/index.js');
    runIndex = mod.runIndex;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('calls pipeline in correct order: crawl -> chunk -> embed -> store -> writeIndexState', async () => {
    const callOrder: string[] = [];
    mockCrawlSourceFiles.mockImplementation(async () => { callOrder.push('crawl'); return fakeFiles; });
    mockChunkFile.mockImplementation((fp, _c) => { callOrder.push('chunk'); return { chunks: [fakeChunk(fp, 1)], edges: [] }; });
    mockEmbedBatchWithRetry.mockImplementation(async () => { callOrder.push('embed'); return { embeddings: [zeroVector768, zeroVector768], skipped: 0, zeroVectorIndices: new Set() }; });
    mockInsertChunks.mockImplementation(async () => { callOrder.push('store'); });
    mockWriteIndexState.mockImplementation(async () => { callOrder.push('writeState'); });

    await runIndex('/project');

    expect(callOrder[0]).toBe('crawl');
    expect(callOrder).toContain('chunk');
    expect(callOrder).toContain('embed');
    expect(callOrder).toContain('store');
    expect(callOrder[callOrder.length - 1]).toBe('writeState');
  });

  it('calls crawlSourceFiles with the resolved target path', async () => {
    await runIndex('/project');
    expect(mockCrawlSourceFiles).toHaveBeenCalledWith('/project');
  });

  it('calls chunkFile for each crawled file', async () => {
    await runIndex('/project');
    expect(mockChunkFile).toHaveBeenCalledTimes(fakeFiles.length);
    expect(mockChunkFile).toHaveBeenCalledWith(fakeFiles[0], expect.any(String));
    expect(mockChunkFile).toHaveBeenCalledWith(fakeFiles[1], expect.any(String));
  });

  it('calls embedBatchWithRetry with model name, chunk texts, and dimension', async () => {
    await runIndex('/project');
    expect(mockEmbedBatchWithRetry).toHaveBeenCalledWith(
      'nomic-embed-text',
      expect.arrayContaining([expect.any(String)]),
      768 // dimension for nomic-embed-text
    );
  });

  it('calls insertChunks with rows containing vectors', async () => {
    await runIndex('/project');
    expect(mockInsertChunks).toHaveBeenCalledWith(
      mockTable,
      expect.arrayContaining([
        expect.objectContaining({ vector: zeroVector768 }),
      ])
    );
  });

  it('calls insertChunks with rows containing file_type from classifyFileType', async () => {
    // Set up: one test file, one source file
    const testFilePath = '/project/src/foo.test.ts';
    const sourceFilePath = '/project/src/bar.ts';
    mockCrawlSourceFiles.mockResolvedValue([testFilePath, sourceFilePath]);
    mockChunkFile.mockImplementation((filePath, _content) => ({ chunks: [fakeChunk(filePath, 1)], edges: [] }));
    mockClassifyFileType.mockImplementation((fp: string) => fp.includes('.test.') ? 'test' : 'source');

    await runIndex('/project');

    expect(mockInsertChunks).toHaveBeenCalledWith(
      mockTable,
      expect.arrayContaining([
        expect.objectContaining({ file_path: testFilePath, file_type: 'test' }),
        expect.objectContaining({ file_path: sourceFilePath, file_type: 'source' }),
      ])
    );
  });

  it('calls writeIndexState with correct model, dimension, and counts', async () => {
    await runIndex('/project');
    expect(mockWriteIndexState).toHaveBeenCalledWith(
      '/project',
      expect.objectContaining({
        version: 1,
        embeddingModel: 'nomic-embed-text',
        dimension: 768,
        fileCount: fakeFiles.length,
        chunkCount: fakeFiles.length, // one chunk per file in mock
      })
    );
  });

  it('throws when no profile found', async () => {
    mockReadProfile.mockResolvedValue(null);
    await expect(runIndex('/project')).rejects.toThrow("brain-cache init");
  });

  it('writes error message to stderr when no profile found', async () => {
    mockReadProfile.mockResolvedValue(null);
    try {
      await runIndex('/project');
    } catch {
      // expected
    }
    // Error is thrown, no stderr output in this case — just verify it throws
  });

  it('throws when Ollama is not running', async () => {
    mockIsOllamaRunning.mockResolvedValue(false);
    await expect(runIndex('/project')).rejects.toThrow('Ollama is not running');
  });

  it('error message mentions Ollama when not running', async () => {
    mockIsOllamaRunning.mockResolvedValue(false);
    let err: Error | undefined;
    try {
      await runIndex('/project');
    } catch (e) {
      err = e as Error;
    }
    expect(err?.message).toContain('Ollama');
    expect(err?.message).toContain('ollama serve');
  });

  it('handles zero source files gracefully: returns without calling embedBatchWithRetry', async () => {
    mockCrawlSourceFiles.mockResolvedValue([]);
    await runIndex('/project');
    expect(mockEmbedBatchWithRetry).not.toHaveBeenCalled();
    expect(processExitSpy).not.toHaveBeenCalled();
  });

  it('handles zero source files: does not call writeIndexState', async () => {
    mockCrawlSourceFiles.mockResolvedValue([]);
    await runIndex('/project');
    expect(mockWriteIndexState).not.toHaveBeenCalled();
  });

  it('defaults to process.cwd() when no path argument provided', async () => {
    await runIndex();
    // crawlSourceFiles should be called with the resolved cwd
    const callArg = mockCrawlSourceFiles.mock.calls[0][0];
    expect(callArg).toBe(process.cwd());
  });

  it('produces zero output on stdout', async () => {
    await runIndex('/project');
    expect(stdoutOutput).toHaveLength(0);
    expect(stdoutWriteSpy).not.toHaveBeenCalled();
  });

  it('reports file count and completion to stderr', async () => {
    await runIndex('/project');
    const combined = stderrOutput.join('');
    expect(combined).toContain(`found ${fakeFiles.length} source files`);
    expect(combined).toContain('indexing complete');
  });

  it('prints percentage progress during embedding', async () => {
    await runIndex('/project');
    const combined = stderrOutput.join('');
    expect(combined).toContain('(100%)');
  });

  it('prints token savings stats on completion', async () => {
    await runIndex('/project');
    const combined = stderrOutput.join('');
    expect(combined).toContain('Tokens sent to Claude:');
    expect(combined).toContain('Estimated without:');
    expect(combined).toContain('Reduction:');
  });

  it('calls acquireIndexLock with the resolved project path before indexing begins', async () => {
    await runIndex('/project');
    expect(mockAcquireIndexLock).toHaveBeenCalledWith('/project');
    expect(mockAcquireIndexLock).toHaveBeenCalledTimes(1);
  });

  it('calls releaseIndexLock in finally even when indexing throws', async () => {
    mockReadProfile.mockRejectedValue(new Error('profile read failed'));

    try {
      await runIndex('/project');
    } catch {
      // expected
    }

    expect(mockReleaseIndexLock).toHaveBeenCalledWith('/project');
  });

  it('propagates lock contention error immediately without calling crawlSourceFiles', async () => {
    mockAcquireIndexLock.mockRejectedValue(new Error('Another index operation is in progress. Try again later.'));

    await expect(runIndex('/project')).rejects.toThrow('Another index operation is in progress');
    expect(mockCrawlSourceFiles).not.toHaveBeenCalled();
  });

  it('skips files that fail to chunk instead of crashing the run', async () => {
    const goodFile = '/project/src/bar.ts';
    const badFile = '/project/src/foo.ts';
    mockCrawlSourceFiles.mockResolvedValue([badFile, goodFile]);

    mockChunkFile.mockImplementation((filePath, _content) => {
      if (filePath === badFile) throw new Error('parse failure');
      return { chunks: [fakeChunk(filePath, 1)], edges: [] };
    });

    await runIndex('/project');

    // Good file's chunk was still embedded and stored
    expect(mockEmbedBatchWithRetry).toHaveBeenCalled();
    expect(mockInsertChunks).toHaveBeenCalledWith(
      mockTable,
      expect.arrayContaining([
        expect.objectContaining({ file_path: goodFile }),
      ])
    );
  });
});
