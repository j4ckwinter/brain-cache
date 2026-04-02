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

vi.mock('../../src/services/logger.js', () => ({
  setLogLevel: vi.fn(),
  childLogger: vi.fn().mockReturnValue({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../../src/services/lancedb.js', () => ({
  openDatabase: vi.fn(),
  openOrCreateChunkTable: vi.fn(),
  insertChunks: vi.fn(),
  createVectorIndexIfNeeded: vi.fn(),
  writeIndexState: vi.fn(),
  readFileHashes: vi.fn(),
  writeFileHashes: vi.fn(),
  deleteChunksByFilePath: vi.fn(),
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
import { crawlSourceFiles } from '../../src/services/crawler.js';
import { chunkFile } from '../../src/services/chunker.js';
import { embedBatchWithRetry } from '../../src/services/embedder.js';
import {
  openDatabase,
  openOrCreateChunkTable,
  insertChunks,
  createVectorIndexIfNeeded,
  writeIndexState,
  readFileHashes,
  writeFileHashes,
  deleteChunksByFilePath,
} from '../../src/services/lancedb.js';
import { readFile } from 'node:fs/promises';
import { countChunkTokens } from '../../src/services/tokenCounter.js';

const mockReadProfile = vi.mocked(readProfile);
const mockIsOllamaRunning = vi.mocked(isOllamaRunning);
const mockCrawlSourceFiles = vi.mocked(crawlSourceFiles);
const mockChunkFile = vi.mocked(chunkFile);
const mockEmbedBatchWithRetry = vi.mocked(embedBatchWithRetry);
const mockOpenDatabase = vi.mocked(openDatabase);
const mockOpenOrCreateChunkTable = vi.mocked(openOrCreateChunkTable);
const mockInsertChunks = vi.mocked(insertChunks);
const mockCreateVectorIndexIfNeeded = vi.mocked(createVectorIndexIfNeeded);
const mockWriteIndexState = vi.mocked(writeIndexState);
const mockReadFile = vi.mocked(readFile);
const mockCountChunkTokens = vi.mocked(countChunkTokens);
const mockReadFileHashes = vi.mocked(readFileHashes);
const mockWriteFileHashes = vi.mocked(writeFileHashes);
const mockDeleteChunksByFilePath = vi.mocked(deleteChunksByFilePath);

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
const mockTable = { countRows: vi.fn().mockResolvedValue(2) } as any;

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

let runIndex: (targetPath?: string, opts?: { force?: boolean }) => Promise<void>;

describe('runIndex', () => {
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
    mockCrawlSourceFiles.mockResolvedValue(fakeFiles);
    mockReadFile.mockResolvedValue('const x = 1;' as any);
    mockChunkFile.mockImplementation((filePath, _content) => [fakeChunk(filePath, 1)]);
    mockEmbedBatchWithRetry.mockResolvedValue({ embeddings: [zeroVector768, zeroVector768], skipped: 0 });
    mockOpenDatabase.mockResolvedValue(mockDb);
    mockOpenOrCreateChunkTable.mockResolvedValue(mockTable);
    mockInsertChunks.mockResolvedValue(undefined);
    mockCreateVectorIndexIfNeeded.mockResolvedValue(undefined);
    mockWriteIndexState.mockResolvedValue(undefined);
    // Default: no stored hashes (first run)
    mockReadFileHashes.mockResolvedValue({});
    mockWriteFileHashes.mockResolvedValue(undefined);
    mockDeleteChunksByFilePath.mockResolvedValue(undefined);
    mockTable.countRows.mockResolvedValue(2);

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
    mockChunkFile.mockImplementation((fp, _c) => { callOrder.push('chunk'); return [fakeChunk(fp, 1)]; });
    mockEmbedBatchWithRetry.mockImplementation(async () => { callOrder.push('embed'); return { embeddings: [zeroVector768, zeroVector768], skipped: 0 }; });
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

  it('calls embedBatchWithRetry with model name and chunk texts', async () => {
    await runIndex('/project');
    expect(mockEmbedBatchWithRetry).toHaveBeenCalledWith(
      'nomic-embed-text',
      expect.arrayContaining([expect.any(String)]),
      768
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

  it('calls writeIndexState with correct model, dimension, and counts', async () => {
    await runIndex('/project');
    expect(mockWriteIndexState).toHaveBeenCalledWith(
      '/project',
      expect.objectContaining({
        version: 1,
        embeddingModel: 'nomic-embed-text',
        dimension: 768,
        fileCount: fakeFiles.length,
      })
    );
  });

  it('throws with message when no profile found', async () => {
    mockReadProfile.mockResolvedValue(null);
    await expect(runIndex('/project')).rejects.toThrow("No profile found. Run 'brain-cache init' first.");
  });

  it('throws with message when Ollama is not running', async () => {
    mockIsOllamaRunning.mockResolvedValue(false);
    await expect(runIndex('/project')).rejects.toThrow('Ollama is not running');
  });

  it('handles zero source files gracefully: returns without calling embedBatchWithRetry', async () => {
    mockCrawlSourceFiles.mockResolvedValue([]);
    await runIndex('/project');
    expect(mockEmbedBatchWithRetry).not.toHaveBeenCalled();
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

  // --- Incremental indexing tests ---

  it('first run (no manifest): treats all files as new and embeds all', async () => {
    mockReadFileHashes.mockResolvedValue({});
    await runIndex('/project');
    // All files are new, so embed should be called
    expect(mockEmbedBatchWithRetry).toHaveBeenCalled();
    expect(mockChunkFile).toHaveBeenCalledTimes(fakeFiles.length);
  });

  it('second run with same content: calls embedBatchWithRetry zero times', async () => {
    // Simulate all files already hashed with matching content
    const content = 'const x = 1;';
    const { createHash } = await import('node:crypto');
    const hash = createHash('sha256').update(content, 'utf-8').digest('hex');
    const storedHashes: Record<string, string> = {
      [fakeFiles[0]]: hash,
      [fakeFiles[1]]: hash,
    };
    mockReadFileHashes.mockResolvedValue(storedHashes);
    mockReadFile.mockResolvedValue(content as any);

    await runIndex('/project');

    expect(mockEmbedBatchWithRetry).not.toHaveBeenCalled();
  });

  it('second run with same content: logs nothing to re-index', async () => {
    const content = 'const x = 1;';
    const { createHash } = await import('node:crypto');
    const hash = createHash('sha256').update(content, 'utf-8').digest('hex');
    const storedHashes: Record<string, string> = {
      [fakeFiles[0]]: hash,
      [fakeFiles[1]]: hash,
    };
    mockReadFileHashes.mockResolvedValue(storedHashes);
    mockReadFile.mockResolvedValue(content as any);

    await runIndex('/project');

    const combined = stderrOutput.join('');
    expect(combined).toContain('nothing to re-index');
  });

  it('changed file: only re-embeds the changed file, not the unchanged one', async () => {
    const content = 'const x = 1;';
    const { createHash } = await import('node:crypto');
    const oldHash = createHash('sha256').update(content, 'utf-8').digest('hex');
    const newContent = 'const x = 2;'; // changed
    const storedHashes: Record<string, string> = {
      [fakeFiles[0]]: oldHash, // unchanged
      [fakeFiles[1]]: oldHash, // will be changed
    };
    mockReadFileHashes.mockResolvedValue(storedHashes);
    // foo.ts unchanged, bar.ts changed
    mockReadFile.mockImplementation(async (filePath: unknown) => {
      if (filePath === fakeFiles[1]) return newContent as any;
      return content as any;
    });

    await runIndex('/project');

    // Only bar.ts (changed) should be chunked
    expect(mockChunkFile).toHaveBeenCalledTimes(1);
    expect(mockChunkFile).toHaveBeenCalledWith(fakeFiles[1], newContent);
  });

  it('changed file: calls deleteChunksByFilePath for the changed file before re-embed', async () => {
    const content = 'const x = 1;';
    const { createHash } = await import('node:crypto');
    const oldHash = createHash('sha256').update(content, 'utf-8').digest('hex');
    const storedHashes: Record<string, string> = {
      [fakeFiles[0]]: oldHash,
      [fakeFiles[1]]: oldHash,
    };
    mockReadFileHashes.mockResolvedValue(storedHashes);
    mockReadFile.mockImplementation(async (filePath: unknown) => {
      if (filePath === fakeFiles[1]) return 'const x = 2;' as any;
      return content as any;
    });

    await runIndex('/project');

    expect(mockDeleteChunksByFilePath).toHaveBeenCalledWith(mockTable, fakeFiles[1]);
  });

  it('removed file: calls deleteChunksByFilePath for removed file', async () => {
    const content = 'const x = 1;';
    const { createHash } = await import('node:crypto');
    const hash = createHash('sha256').update(content, 'utf-8').digest('hex');
    // Stored has both files, but crawl only returns one (bar.ts removed)
    const storedHashes: Record<string, string> = {
      [fakeFiles[0]]: hash,
      [fakeFiles[1]]: hash, // this one is "removed"
    };
    mockReadFileHashes.mockResolvedValue(storedHashes);
    mockCrawlSourceFiles.mockResolvedValue([fakeFiles[0]]); // only foo.ts present
    mockReadFile.mockResolvedValue(content as any);

    await runIndex('/project');

    expect(mockDeleteChunksByFilePath).toHaveBeenCalledWith(mockTable, fakeFiles[1]);
  });

  it('force=true: ignores manifest and re-embeds all files', async () => {
    const content = 'const x = 1;';
    const { createHash } = await import('node:crypto');
    const hash = createHash('sha256').update(content, 'utf-8').digest('hex');
    const storedHashes: Record<string, string> = {
      [fakeFiles[0]]: hash,
      [fakeFiles[1]]: hash,
    };
    mockReadFileHashes.mockResolvedValue(storedHashes);
    mockReadFile.mockResolvedValue(content as any);

    await runIndex('/project', { force: true });

    // Force bypasses incremental, so all files are embedded
    expect(mockChunkFile).toHaveBeenCalledTimes(fakeFiles.length);
    expect(mockEmbedBatchWithRetry).toHaveBeenCalled();
  });

  it('writes updated hash manifest after successful indexing', async () => {
    await runIndex('/project');
    expect(mockWriteFileHashes).toHaveBeenCalledWith('/project', expect.any(Object));
  });

  it('logs incremental stats to stderr', async () => {
    await runIndex('/project');
    const combined = stderrOutput.join('');
    expect(combined).toContain('incremental index');
  });
});
