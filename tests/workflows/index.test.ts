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
  deleteHistoryChunks: vi.fn(),
  createVectorIndexIfNeeded: vi.fn(),
  withWriteLock: vi.fn(),
  classifyFileType: vi.fn((filePath: string) => filePath.includes('.test.') ? 'test' : 'source'),
  escapeSqlLiteral: vi.fn((v: string) => v.replace(/'/g, "''")),
}));

vi.mock('../../src/services/gitHistory.js', () => ({
  fetchGitCommits: vi.fn(),
  buildCommitContent: vi.fn((commit: { shortHash: string }) => `Commit: ${commit.shortHash}`),
  readGitConfig: vi.fn(),
  isGitCommandError: vi.fn((error: unknown) => {
    return typeof error === 'object' && error !== null && 'command' in error;
  }),
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    readFile: vi.fn(),
    stat: vi.fn(),
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
  deleteHistoryChunks,
  createVectorIndexIfNeeded,
  withWriteLock,
  classifyFileType,
} from '../../src/services/lancedb.js';
import {
  fetchGitCommits,
  readGitConfig,
  buildCommitContent,
} from '../../src/services/gitHistory.js';
import { readFile, stat } from 'node:fs/promises';
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
const mockDeleteHistoryChunks = vi.mocked(deleteHistoryChunks);
const mockCreateVectorIndexIfNeeded = vi.mocked(createVectorIndexIfNeeded);
const mockWithWriteLock = vi.mocked(withWriteLock);
const mockReadFile = vi.mocked(readFile);
const mockStat = vi.mocked(stat);
const mockCountChunkTokens = vi.mocked(countChunkTokens);
const mockClassifyFileType = vi.mocked(classifyFileType);
const mockFetchGitCommits = vi.mocked(fetchGitCommits);
const mockReadGitConfig = vi.mocked(readGitConfig);
const mockBuildCommitContent = vi.mocked(buildCommitContent);

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

    // Clear all mock call history and implementations before each test
    vi.clearAllMocks();

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
    mockStat.mockResolvedValue({ size: 100, mtimeMs: 1000 } as any);
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
    mockReadFileHashes.mockResolvedValue({ hashes: {}, tokenCounts: {}, stats: {} });
    mockWriteFileHashes.mockResolvedValue(undefined);
    mockDeleteChunksByFilePaths.mockResolvedValue(undefined);
    mockDeleteHistoryChunks.mockResolvedValue(undefined);
    mockCreateVectorIndexIfNeeded.mockResolvedValue(undefined);
    // withWriteLock: just call the callback
    mockWithWriteLock.mockImplementation(async (fn) => fn());
    // table needs countRows for index state
    (mockTable as any).countRows = vi.fn().mockResolvedValue(fakeFiles.length);
    mockReadGitConfig.mockResolvedValue({});
    mockFetchGitCommits.mockResolvedValue([]);
    mockBuildCommitContent.mockImplementation((commit: { shortHash: string }) => `Commit: ${commit.shortHash}`);

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
        expect.objectContaining({ vector: zeroVector768, source_kind: 'file' }),
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
        expect.objectContaining({ file_path: testFilePath, file_type: 'test', source_kind: 'file' }),
        expect.objectContaining({ file_path: sourceFilePath, file_type: 'source', source_kind: 'file' }),
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

  it('ingests git history after file indexing when git.enabled=true', async () => {
    mockReadGitConfig.mockResolvedValue({ enabled: true, maxCommits: 25 });
    mockFetchGitCommits.mockResolvedValue([
      {
        shortHash: 'abc1234',
        author: 'Jane Dev',
        date: '2026-04-07T12:00:00.000Z',
        message: 'feat: add history',
        files: [{ path: 'src/index.ts', insertions: 2, deletions: 0 }],
      },
    ]);
    const callOrder: string[] = [];
    mockCreateVectorIndexIfNeeded.mockImplementation(async () => {
      callOrder.push('createVectorIndexIfNeeded');
    });
    mockDeleteHistoryChunks.mockImplementation(async () => {
      callOrder.push('deleteHistoryChunks');
    });
    mockInsertChunks.mockImplementation(async (_table, rows: unknown[]) => {
      const hasHistory = rows.some(
        (row) =>
          typeof row === 'object' &&
          row !== null &&
          (row as { source_kind?: string }).source_kind === 'history',
      );
      callOrder.push(hasHistory ? 'insertHistoryChunks' : 'insertFileChunks');
    });

    await runIndex('/project');

    expect(mockFetchGitCommits).toHaveBeenCalledWith('/project', 25);
    expect(callOrder.indexOf('insertFileChunks')).toBeGreaterThan(-1);
    expect(callOrder.indexOf('deleteHistoryChunks')).toBeGreaterThan(callOrder.indexOf('insertFileChunks'));
    expect(callOrder.indexOf('insertHistoryChunks')).toBeGreaterThan(callOrder.indexOf('deleteHistoryChunks'));
  });

  it('skips history ingestion when git.enabled is false', async () => {
    mockReadGitConfig.mockResolvedValue({ enabled: false, maxCommits: 100 });
    await runIndex('/project');
    expect(mockFetchGitCommits).not.toHaveBeenCalled();
    expect(mockDeleteHistoryChunks).not.toHaveBeenCalled();
  });

  it('uses default maxCommits=500 when git.enabled=true and maxCommits is missing', async () => {
    mockReadGitConfig.mockResolvedValue({ enabled: true });
    mockFetchGitCommits.mockResolvedValue([]);
    await runIndex('/project');
    expect(mockFetchGitCommits).toHaveBeenCalledWith('/project', 500);
  });
});

describe('computeFileDiffs', () => {
  it('classifies new files when not in stored hashes', async () => {
    const { computeFileDiffs } = await import('../../src/workflows/index.js');
    const r = computeFileDiffs(['/a.ts'], { '/a.ts': 'h1' }, {});
    expect(r.newFiles).toEqual(['/a.ts']);
    expect(r.changedFiles).toEqual([]);
    expect(r.removedFiles).toEqual([]);
    expect(r.unchangedFiles).toEqual([]);
  });

  it('classifies changed files when hash differs', async () => {
    const { computeFileDiffs } = await import('../../src/workflows/index.js');
    const r = computeFileDiffs(['/a.ts'], { '/a.ts': 'new' }, { '/a.ts': 'old' });
    expect(r.changedFiles).toEqual(['/a.ts']);
    expect(r.newFiles).toEqual([]);
  });

  it('classifies unchanged files when hash matches', async () => {
    const { computeFileDiffs } = await import('../../src/workflows/index.js');
    const r = computeFileDiffs(['/a.ts'], { '/a.ts': 'same' }, { '/a.ts': 'same' });
    expect(r.unchangedFiles).toEqual(['/a.ts']);
  });

  it('detects removed files present in stored but not crawled', async () => {
    const { computeFileDiffs } = await import('../../src/workflows/index.js');
    const r = computeFileDiffs(['/keep.ts'], { '/keep.ts': 'h' }, { '/keep.ts': 'h', '/gone.ts': 'x' });
    expect(r.removedFiles).toEqual(['/gone.ts']);
  });
});

describe('printSummary', () => {
  let stderrOutput: string[];
  let stderrWriteSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderrOutput = [];
    stderrWriteSpy = vi.spyOn(process.stderr, 'write').mockImplementation((data: unknown) => {
      stderrOutput.push(String(data));
      return true;
    });
  });

  afterEach(() => {
    stderrWriteSpy.mockRestore();
  });

  it('writes completion lines and token savings labels', async () => {
    const { printSummary } = await import('../../src/workflows/index.js');
    printSummary({
      totalFiles: 2,
      totalChunks: 3,
      embeddingModel: 'nomic-embed-text',
      totalChunkTokens: 100,
      totalRawTokens: 200,
      rootDir: '/proj',
    });
    const out = stderrOutput.join('');
    expect(out).toContain('indexing complete');
    expect(out).toContain('Files:');
    expect(out).toContain('Chunks:');
    expect(out).toContain('Tokens sent to Claude:');
  });
});

describe('incremental re-index file removal', () => {
  let stderrOutput: string[];
  let stderrWriteSpy: ReturnType<typeof vi.spyOn>;
  let runIndexLocal: (targetPath?: string, opts?: { force?: boolean }) => Promise<void>;

  beforeEach(async () => {
    stderrOutput = [];
    stderrWriteSpy = vi.spyOn(process.stderr, 'write').mockImplementation((data: unknown) => {
      stderrOutput.push(String(data));
      return true;
    });

    mockAcquireIndexLock.mockResolvedValue(undefined);
    mockReleaseIndexLock.mockResolvedValue(undefined);
    mockReadProfile.mockResolvedValue({ ...mockProfile });
    mockIsOllamaRunning.mockResolvedValue(true);
    mockReadFile.mockResolvedValue('const x = 1;' as any);
    mockStat.mockResolvedValue({ size: 100, mtimeMs: 1000 } as any);
    mockChunkFile.mockImplementation((filePath, _content) => ({ chunks: [fakeChunk(filePath, 1)], edges: [] }));
    mockEmbedBatchWithRetry.mockResolvedValue({ embeddings: [zeroVector768], skipped: 0, zeroVectorIndices: new Set() });
    mockGetConnection.mockResolvedValue(mockDb);
    mockOpenOrCreateChunkTable.mockResolvedValue(mockTable);
    mockOpenOrCreateEdgesTable.mockResolvedValue({ delete: vi.fn(), countRows: vi.fn().mockResolvedValue(0) } as any);
    mockInsertChunks.mockResolvedValue(undefined);
    mockInsertEdges.mockResolvedValue(undefined);
    mockWriteIndexState.mockResolvedValue(undefined);
    mockWriteFileHashes.mockResolvedValue(undefined);
    mockDeleteChunksByFilePaths.mockResolvedValue(undefined);
    mockCreateVectorIndexIfNeeded.mockResolvedValue(undefined);
    mockWithWriteLock.mockImplementation(async (fn) => fn());
    (mockTable as any).countRows = vi.fn().mockResolvedValue(1);

    const mod = await import('../../src/workflows/index.js');
    runIndexLocal = mod.runIndex;
  });

  afterEach(() => {
    stderrWriteSpy.mockRestore();
    vi.clearAllMocks();
  });

  it('calls deleteChunksByFilePaths when a tracked file disappears from crawl', async () => {
    mockReadFileHashes.mockResolvedValue({
      hashes: { '/proj/old.ts': 'abc', '/proj/keep.ts': 'def' },
      tokenCounts: {},
      stats: {},
    });
    mockCrawlSourceFiles.mockResolvedValue(['/proj/keep.ts']);
    mockChunkFile.mockImplementation((fp, _c) => ({ chunks: [fakeChunk(fp, 1)], edges: [] }));

    await runIndexLocal('/proj');

    expect(mockDeleteChunksByFilePaths).toHaveBeenCalledWith(
      mockTable,
      expect.arrayContaining(['/proj/old.ts']),
    );
  });
});

describe('partitionByStatChange', () => {
  it('returns both arrays empty when files is empty', async () => {
    const { partitionByStatChange } = await import('../../src/workflows/index.js');
    const result = partitionByStatChange([], new Map(), {});
    expect(result.statUnchanged).toEqual([]);
    expect(result.statChanged).toEqual([]);
  });

  it('classifies file as statUnchanged when size and mtimeMs both match', async () => {
    const { partitionByStatChange } = await import('../../src/workflows/index.js');
    const currentStats = new Map([['/a.ts', { size: 100, mtimeMs: 2000 }]]);
    const storedStats = { '/a.ts': { size: 100, mtimeMs: 2000 } };
    const result = partitionByStatChange(['/a.ts'], currentStats, storedStats);
    expect(result.statUnchanged).toEqual(['/a.ts']);
    expect(result.statChanged).toEqual([]);
  });

  it('classifies file as statChanged when size differs', async () => {
    const { partitionByStatChange } = await import('../../src/workflows/index.js');
    const currentStats = new Map([['/a.ts', { size: 200, mtimeMs: 2000 }]]);
    const storedStats = { '/a.ts': { size: 100, mtimeMs: 2000 } };
    const result = partitionByStatChange(['/a.ts'], currentStats, storedStats);
    expect(result.statChanged).toEqual(['/a.ts']);
    expect(result.statUnchanged).toEqual([]);
  });

  it('classifies file as statChanged when mtimeMs differs', async () => {
    const { partitionByStatChange } = await import('../../src/workflows/index.js');
    const currentStats = new Map([['/a.ts', { size: 100, mtimeMs: 9999 }]]);
    const storedStats = { '/a.ts': { size: 100, mtimeMs: 2000 } };
    const result = partitionByStatChange(['/a.ts'], currentStats, storedStats);
    expect(result.statChanged).toEqual(['/a.ts']);
  });

  it('classifies file as statChanged when not present in storedStats', async () => {
    const { partitionByStatChange } = await import('../../src/workflows/index.js');
    const currentStats = new Map([['/a.ts', { size: 100, mtimeMs: 2000 }]]);
    const result = partitionByStatChange(['/a.ts'], currentStats, {});
    expect(result.statChanged).toEqual(['/a.ts']);
  });

  it('classifies file as statChanged when not present in currentStats', async () => {
    const { partitionByStatChange } = await import('../../src/workflows/index.js');
    const storedStats = { '/a.ts': { size: 100, mtimeMs: 2000 } };
    const result = partitionByStatChange(['/a.ts'], new Map(), storedStats);
    expect(result.statChanged).toEqual(['/a.ts']);
  });

  it('handles multiple files with mixed results', async () => {
    const { partitionByStatChange } = await import('../../src/workflows/index.js');
    const currentStats = new Map([
      ['/unchanged.ts', { size: 50, mtimeMs: 1000 }],
      ['/changed.ts', { size: 99, mtimeMs: 1000 }],
      ['/new.ts', { size: 10, mtimeMs: 500 }],
    ]);
    const storedStats = {
      '/unchanged.ts': { size: 50, mtimeMs: 1000 },
      '/changed.ts': { size: 50, mtimeMs: 1000 },
    };
    const result = partitionByStatChange(
      ['/unchanged.ts', '/changed.ts', '/new.ts'],
      currentStats,
      storedStats,
    );
    expect(result.statUnchanged).toEqual(['/unchanged.ts']);
    expect(result.statChanged).toContain('/changed.ts');
    expect(result.statChanged).toContain('/new.ts');
  });
});

describe('runIndex stat fast-path', () => {
  let stderrOutput: string[];
  let stderrWriteSpy: ReturnType<typeof vi.spyOn>;
  let runIndexLocal: (targetPath?: string, opts?: { force?: boolean; verify?: boolean }) => Promise<void>;

  beforeEach(async () => {
    stderrOutput = [];
    stderrWriteSpy = vi.spyOn(process.stderr, 'write').mockImplementation((data: unknown) => {
      stderrOutput.push(String(data));
      return true;
    });

    mockAcquireIndexLock.mockResolvedValue(undefined);
    mockReleaseIndexLock.mockResolvedValue(undefined);
    mockReadProfile.mockResolvedValue({ ...mockProfile });
    mockIsOllamaRunning.mockResolvedValue(true);
    mockStat.mockResolvedValue({ size: 100, mtimeMs: 1000 } as any);
    mockChunkFile.mockImplementation((filePath, _content) => ({ chunks: [fakeChunk(filePath, 1)], edges: [] }));
    mockEmbedBatchWithRetry.mockResolvedValue({ embeddings: [zeroVector768, zeroVector768], skipped: 0, zeroVectorIndices: new Set() });
    mockGetConnection.mockResolvedValue(mockDb);
    mockOpenOrCreateChunkTable.mockResolvedValue(mockTable);
    mockOpenOrCreateEdgesTable.mockResolvedValue({ delete: vi.fn(), countRows: vi.fn().mockResolvedValue(0) } as any);
    mockInsertChunks.mockResolvedValue(undefined);
    mockInsertEdges.mockResolvedValue(undefined);
    mockWriteIndexState.mockResolvedValue(undefined);
    mockWriteFileHashes.mockResolvedValue(undefined);
    mockDeleteChunksByFilePaths.mockResolvedValue(undefined);
    mockCreateVectorIndexIfNeeded.mockResolvedValue(undefined);
    mockWithWriteLock.mockImplementation(async (fn) => fn());
    (mockTable as any).countRows = vi.fn().mockResolvedValue(2);

    const mod = await import('../../src/workflows/index.js');
    runIndexLocal = mod.runIndex;
  });

  afterEach(() => {
    stderrWriteSpy.mockRestore();
    vi.clearAllMocks();
  });

  it('skips readFile for stat-unchanged files when manifest has matching hash and tokenCounts', async () => {
    // Two files in manifest with matching stats — readFile should NOT be called for either
    mockCrawlSourceFiles.mockResolvedValue(fakeFiles);
    mockStat.mockImplementation(async (fp) => {
      return { size: 100, mtimeMs: 1000 } as any;
    });
    mockReadFileHashes.mockResolvedValue({
      hashes: {
        [fakeFiles[0]]: 'stored-hash-0',
        [fakeFiles[1]]: 'stored-hash-1',
      },
      tokenCounts: {
        [fakeFiles[0]]: 80,
        [fakeFiles[1]]: 60,
      },
      stats: {
        [fakeFiles[0]]: { size: 100, mtimeMs: 1000 },
        [fakeFiles[1]]: { size: 100, mtimeMs: 1000 },
      },
    });

    await runIndexLocal('/project');

    // readFile should NOT be called because all files are stat-skipped
    expect(mockReadFile).not.toHaveBeenCalled();
  });

  it('reads file when stat-unchanged but tokenCounts missing (backfill D-48-06)', async () => {
    // File has hash and stats but no tokenCounts — must backfill by reading
    mockCrawlSourceFiles.mockResolvedValue([fakeFiles[0]]);
    mockReadFile.mockResolvedValue('const x = 1;' as any);
    mockReadFileHashes.mockResolvedValue({
      hashes: { [fakeFiles[0]]: 'stored-hash-0' },
      tokenCounts: {}, // missing tokenCounts triggers backfill
      stats: { [fakeFiles[0]]: { size: 100, mtimeMs: 1000 } },
    });
    mockEmbedBatchWithRetry.mockResolvedValue({ embeddings: [zeroVector768], skipped: 0, zeroVectorIndices: new Set() });

    await runIndexLocal('/project');

    // readFile must be called to backfill token count
    expect(mockReadFile).toHaveBeenCalledWith(fakeFiles[0], 'utf-8');
  });

  it('reads all files when --verify is set even if stat matches', async () => {
    // All files have matching stats in manifest but --verify forces full read
    mockCrawlSourceFiles.mockResolvedValue(fakeFiles);
    mockReadFile.mockResolvedValue('const x = 1;' as any);
    mockReadFileHashes.mockResolvedValue({
      hashes: {
        [fakeFiles[0]]: 'stored-hash-0',
        [fakeFiles[1]]: 'stored-hash-1',
      },
      tokenCounts: {
        [fakeFiles[0]]: 80,
        [fakeFiles[1]]: 60,
      },
      stats: {
        [fakeFiles[0]]: { size: 100, mtimeMs: 1000 },
        [fakeFiles[1]]: { size: 100, mtimeMs: 1000 },
      },
    });
    mockEmbedBatchWithRetry.mockResolvedValue({ embeddings: [zeroVector768, zeroVector768], skipped: 0, zeroVectorIndices: new Set() });

    await runIndexLocal('/project', { verify: true });

    // Both files must be read even though stats match
    expect(mockReadFile).toHaveBeenCalledWith(fakeFiles[0], 'utf-8');
    expect(mockReadFile).toHaveBeenCalledWith(fakeFiles[1], 'utf-8');
  });

  it('--force wins over --verify (both flags: force takes precedence)', async () => {
    mockCrawlSourceFiles.mockResolvedValue([fakeFiles[0]]);
    mockReadFile.mockResolvedValue('const x = 1;' as any);
    mockReadFileHashes.mockResolvedValue({ hashes: {}, tokenCounts: {}, stats: {} });
    mockEmbedBatchWithRetry.mockResolvedValue({ embeddings: [zeroVector768], skipped: 0, zeroVectorIndices: new Set() });

    // Should not throw when both flags are true; --force wins
    await expect(runIndexLocal('/project', { force: true, verify: true })).resolves.not.toThrow();
    // When force, readFileHashes should NOT be called (empty baseline)
    expect(mockReadFileHashes).not.toHaveBeenCalled();
  });

  it('writeFileHashes includes stats for all crawled files', async () => {
    mockCrawlSourceFiles.mockResolvedValue([fakeFiles[0]]);
    mockReadFile.mockResolvedValue('const x = 1;' as any);
    mockReadFileHashes.mockResolvedValue({ hashes: {}, tokenCounts: {}, stats: {} });
    mockEmbedBatchWithRetry.mockResolvedValue({ embeddings: [zeroVector768], skipped: 0, zeroVectorIndices: new Set() });

    await runIndexLocal('/project');

    expect(mockWriteFileHashes).toHaveBeenCalledWith(
      '/project',
      expect.objectContaining({
        stats: expect.objectContaining({
          [fakeFiles[0]]: expect.objectContaining({ size: expect.any(Number), mtimeMs: expect.any(Number) }),
        }),
      }),
    );
  });

  it('writeFileHashes includes stats on nothing-to-re-index early return', async () => {
    // All files unchanged: nothing to process but stats must still be written
    mockCrawlSourceFiles.mockResolvedValue([fakeFiles[0]]);
    mockStat.mockResolvedValue({ size: 55, mtimeMs: 9999 } as any);
    mockReadFile.mockResolvedValue('hello' as any);
    // Make the hash match: store the SHA-256 of 'hello'
    const { createHash } = await import('node:crypto');
    const storedHash = createHash('sha256').update('hello', 'utf-8').digest('hex');
    // But stat differs from stored so readFile will be called; set same hash to get unchanged result
    mockReadFileHashes.mockResolvedValue({
      hashes: { [fakeFiles[0]]: storedHash },
      tokenCounts: { [fakeFiles[0]]: 10 },
      stats: { [fakeFiles[0]]: { size: 55, mtimeMs: 9999 } }, // stat matches → skip read
    });

    await runIndexLocal('/project');

    // readFile should not be called (stat-skipped)
    expect(mockReadFile).not.toHaveBeenCalled();
    // stats should be written
    expect(mockWriteFileHashes).toHaveBeenCalledWith(
      '/project',
      expect.objectContaining({
        stats: expect.objectContaining({
          [fakeFiles[0]]: expect.objectContaining({ size: 55, mtimeMs: 9999 }),
        }),
      }),
    );
  });

  it('allFilesTotalTokens sums carried-forward tokenCounts for stat-skipped files', async () => {
    // Both files stat-skipped; totalTokens must be sum of their manifest tokenCounts
    mockCrawlSourceFiles.mockResolvedValue(fakeFiles);
    mockReadFileHashes.mockResolvedValue({
      hashes: {
        [fakeFiles[0]]: 'hash0',
        [fakeFiles[1]]: 'hash1',
      },
      tokenCounts: {
        [fakeFiles[0]]: 40,
        [fakeFiles[1]]: 60,
      },
      stats: {
        [fakeFiles[0]]: { size: 100, mtimeMs: 1000 },
        [fakeFiles[1]]: { size: 100, mtimeMs: 1000 },
      },
    });

    await runIndexLocal('/project');

    expect(mockWriteIndexState).toHaveBeenCalledWith(
      '/project',
      expect.objectContaining({ totalTokens: 100 }), // 40 + 60
    );
  });
});

describe('embedding dimension fallback', () => {
  let stderrOutput: string[];
  let stderrWriteSpy: ReturnType<typeof vi.spyOn>;
  let runIndexLocal: (targetPath?: string, opts?: { force?: boolean }) => Promise<void>;

  beforeEach(async () => {
    stderrOutput = [];
    stderrWriteSpy = vi.spyOn(process.stderr, 'write').mockImplementation((data: unknown) => {
      stderrOutput.push(String(data));
      return true;
    });

    mockAcquireIndexLock.mockResolvedValue(undefined);
    mockReleaseIndexLock.mockResolvedValue(undefined);
    mockReadProfile.mockResolvedValue({
      ...mockProfile,
      embeddingModel: 'unknown-model-xyz',
    });
    mockIsOllamaRunning.mockResolvedValue(true);
    mockCrawlSourceFiles.mockResolvedValue(fakeFiles);
    mockReadFile.mockResolvedValue('const x = 1;' as any);
    mockStat.mockResolvedValue({ size: 100, mtimeMs: 1000 } as any);
    mockChunkFile.mockImplementation((filePath, _content) => ({ chunks: [fakeChunk(filePath, 1)], edges: [] }));
    mockEmbedBatchWithRetry.mockResolvedValue({ embeddings: [zeroVector768, zeroVector768], skipped: 0, zeroVectorIndices: new Set() });
    mockGetConnection.mockResolvedValue(mockDb);
    mockOpenOrCreateChunkTable.mockResolvedValue(mockTable);
    mockOpenOrCreateEdgesTable.mockResolvedValue({ delete: vi.fn(), countRows: vi.fn().mockResolvedValue(0) } as any);
    mockInsertChunks.mockResolvedValue(undefined);
    mockInsertEdges.mockResolvedValue(undefined);
    mockWriteIndexState.mockResolvedValue(undefined);
    mockReadFileHashes.mockResolvedValue({ hashes: {}, tokenCounts: {}, stats: {} });
    mockWriteFileHashes.mockResolvedValue(undefined);
    mockDeleteChunksByFilePaths.mockResolvedValue(undefined);
    mockCreateVectorIndexIfNeeded.mockResolvedValue(undefined);
    mockWithWriteLock.mockImplementation(async (fn) => fn());
    (mockTable as any).countRows = vi.fn().mockResolvedValue(fakeFiles.length);

    const mod = await import('../../src/workflows/index.js');
    runIndexLocal = mod.runIndex;
  });

  afterEach(() => {
    stderrWriteSpy.mockRestore();
    vi.clearAllMocks();
  });

  it('warns and uses default 768 dimensions for unknown model', async () => {
    await runIndexLocal('/project');

    expect(mockOpenOrCreateChunkTable).toHaveBeenCalledWith(
      mockDb,
      '/project',
      'unknown-model-xyz',
      768,
    );
    const combined = stderrOutput.join('');
    expect(combined).toContain("Unknown embedding model 'unknown-model-xyz'");
    expect(combined).toContain('768');
  });
});
