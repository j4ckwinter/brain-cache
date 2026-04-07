import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NoIndexError as NoIndexErrorType } from '../../src/lib/errors.js';

// Capture registered tool handlers before any imports
const registeredTools = new Map<string, { schema: any; handler: Function }>();

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: vi.fn().mockImplementation(function () {
    return {
      registerTool: vi.fn((name: string, config: any, handler: Function) => {
        registeredTools.set(name, { schema: config, handler });
      }),
      connect: vi.fn().mockResolvedValue(undefined),
    };
  }),
}));

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: vi.fn().mockImplementation(function () { return {}; }),
}));

// Mock all service and workflow dependencies
vi.mock('../../src/services/capability.js', () => ({
  readProfile: vi.fn(),
  detectCapabilities: vi.fn(),
}));

vi.mock('../../src/services/ollama.js', () => ({
  isOllamaInstalled: vi.fn(),
  isOllamaRunning: vi.fn(),
  getOllamaVersion: vi.fn(),
}));

vi.mock('../../src/services/lancedb.js', () => ({
  readIndexState: vi.fn(),
  readFileHashes: vi.fn().mockResolvedValue({ hashes: {}, tokenCounts: {} }),
}));

vi.mock('../../src/workflows/index.js', () => ({
  runIndex: vi.fn(),
}));

vi.mock('../../src/workflows/search.js', () => ({
  runSearch: vi.fn(),
}));

vi.mock('../../src/workflows/buildContext.js', () => ({
  runBuildContext: vi.fn(),
}));

vi.mock('../../src/services/logger.js', () => ({
  childLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  })),
}));

vi.mock('../../src/services/sessionStats.js', () => ({
  accumulateStats: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/lib/tokenSavings.js', () => ({
  computeTokenSavings: vi.fn().mockResolvedValue({
    tokensSent: 100,
    estimatedWithoutBraincache: 1000,
    reductionPct: 90,
    filesInContext: 2,
    matchedPoolTokens: 100,
    filteringPct: 0,
    savingsDisplayMode: 'full',
  }),
}));

import { readProfile, detectCapabilities } from '../../src/services/capability.js';
import {
  isOllamaInstalled,
  isOllamaRunning,
  getOllamaVersion,
} from '../../src/services/ollama.js';
import { readIndexState } from '../../src/services/lancedb.js';
import { runIndex } from '../../src/workflows/index.js';
import { runSearch } from '../../src/workflows/search.js';
import { runBuildContext } from '../../src/workflows/buildContext.js';

const mockReadProfile = vi.mocked(readProfile);
const mockDetectCapabilities = vi.mocked(detectCapabilities);
const mockIsOllamaInstalled = vi.mocked(isOllamaInstalled);
const mockIsOllamaRunning = vi.mocked(isOllamaRunning);
const mockGetOllamaVersion = vi.mocked(getOllamaVersion);
const mockReadIndexState = vi.mocked(readIndexState);
const mockRunIndex = vi.mocked(runIndex);
const mockRunSearch = vi.mocked(runSearch);
const mockRunBuildContext = vi.mocked(runBuildContext);

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
  chunkCount: 42,
};

const mockCapabilities = {
  version: 1 as const,
  detectedAt: '2026-03-31T00:00:00.000Z',
  vramTier: 'large' as const,
  vramGiB: 16,
  gpuVendor: 'nvidia' as const,
  embeddingModel: 'nomic-embed-text',
  ollamaVersion: '0.6.3',
  platform: 'linux',
};

const fakeChunk = (id: string) => ({
  id,
  filePath: `src/test_${id}.ts`,
  chunkType: 'function',
  scope: null,
  name: `fn_${id}`,
  content: `function fn_${id}() {}`,
  startLine: 1,
  endLine: 5,
  similarity: 0.95,
  fileType: 'source',
});

const fakeContextResult = {
  content: 'assembled context here',
  chunks: [fakeChunk('a'), fakeChunk('b')],
  metadata: {
    tokensSent: 150,
    estimatedWithoutBraincache: 1000,
    reductionPct: 85,
    filesInContext: 2,
    matchedPoolTokens: 800,
    filteringPct: 40,
    savingsDisplayMode: 'full' as const,
    localTasksPerformed: ['embed_query', 'vector_search', 'dedup', 'token_budget'],
    cloudCallsMade: 0,
  },
};

describe('MCP tool handlers', () => {
  // Holds the NoIndexError class from the current module generation.
  // Must be re-imported each beforeEach because vi.resetModules() clears the cache
  // and server.js / guards.ts load a fresh errors.ts — making the top-level
  // import stale for instanceof checks.
  let NoIndexError: typeof NoIndexErrorType;

  beforeEach(async () => {
    // Reset the map before each test so module re-import registers fresh handlers
    registeredTools.clear();

    // Reset all mocks
    vi.clearAllMocks();

    // Trigger module load to register tools
    const { createMcpServer } = await import('../../src/mcp/server.js');
    createMcpServer();

    // Import NoIndexError from the same module generation as guards.ts so that
    // instanceof checks work correctly inside the freshly-loaded guards code.
    ({ NoIndexError } = await import('../../src/lib/errors.js'));
  });

  afterEach(() => {
    vi.resetModules();
  });

  // ---- index_repo ----

  describe('index_repo', () => {
    it('returns isError when no profile exists', async () => {
      mockReadProfile.mockResolvedValue(null);

      const { handler } = registeredTools.get('index_repo')!;
      const result = await handler({ path: '/some/project' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("brain-cache init");
    });

    it('returns isError when Ollama is not running', async () => {
      mockReadProfile.mockResolvedValue({ ...mockProfile });
      mockIsOllamaRunning.mockResolvedValue(false);

      const { handler } = registeredTools.get('index_repo')!;
      const result = await handler({ path: '/some/project' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Ollama is not running');
    });

    it('returns JSON with status, fileCount, and chunkCount on success', async () => {
      mockReadProfile.mockResolvedValue({ ...mockProfile });
      mockIsOllamaRunning.mockResolvedValue(true);
      mockRunIndex.mockResolvedValue(undefined);
      mockReadIndexState.mockResolvedValue({ ...mockIndexState });

      const { handler } = registeredTools.get('index_repo')!;
      const result = await handler({ path: '/some/project' });

      expect(result.isError).toBeUndefined();
      const text = result.content[0].text;
      expect(text).toContain('Indexed');
      expect(text).toContain('5 files');
      expect(text).toContain('42 chunks');
    });

    it('returns isError when runIndex throws', async () => {
      mockReadProfile.mockResolvedValue({ ...mockProfile });
      mockIsOllamaRunning.mockResolvedValue(true);
      mockRunIndex.mockRejectedValue(new Error('Embedding failed'));

      const { handler } = registeredTools.get('index_repo')!;
      const result = await handler({ path: '/some/project' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Indexing failed');
      expect(result.content[0].text).toContain('Embedding failed');
    });
  });

  // ---- search_codebase ----

  describe('search_codebase', () => {
    it('returns isError when no profile exists', async () => {
      mockReadProfile.mockResolvedValue(null);

      const { handler } = registeredTools.get('search_codebase')!;
      const result = await handler({ query: 'find auth functions' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("brain-cache init");
    });

    it('runs search when Ollama is not running (keyword fallback inside runSearch)', async () => {
      mockReadProfile.mockResolvedValue({ ...mockProfile });
      mockIsOllamaRunning.mockResolvedValue(false);
      mockRunSearch.mockResolvedValue({ chunks: [fakeChunk('1')], fallback: true });

      const { handler } = registeredTools.get('search_codebase')!;
      const result = await handler({ query: 'find auth functions' });

      expect(result.isError).toBeUndefined();
      expect(mockRunSearch).toHaveBeenCalled();
      expect(result.content[0].text).toContain('[FALLBACK]');
    });

    it('returns formatted results text on success', async () => {
      mockReadProfile.mockResolvedValue({ ...mockProfile });
      mockIsOllamaRunning.mockResolvedValue(true);
      mockRunSearch.mockResolvedValue({ chunks: [fakeChunk('1'), fakeChunk('2')], fallback: false });

      const { handler } = registeredTools.get('search_codebase')!;
      const result = await handler({ query: 'find auth functions', limit: 10 });

      expect(result.isError).toBeUndefined();
      // search_codebase returns formatted text, not JSON
      const text = result.content[0].text;
      expect(typeof text).toBe('string');
      expect(text).toContain('Found 2 result');
      expect(text).toContain('find auth functions');
    });

    it('passes limit and path options to runSearch', async () => {
      mockReadProfile.mockResolvedValue({ ...mockProfile });
      mockIsOllamaRunning.mockResolvedValue(true);
      mockRunSearch.mockResolvedValue({ chunks: [], fallback: false });

      const { handler } = registeredTools.get('search_codebase')!;
      await handler({ query: 'test query', limit: 20, path: '/my/project' });

      expect(mockRunSearch).toHaveBeenCalledWith('test query', { limit: 20, path: '/my/project' });
    });

    it('returns isError when path points to a sensitive system directory', async () => {
      mockReadProfile.mockResolvedValue({ ...mockProfile });
      mockIsOllamaRunning.mockResolvedValue(true);

      const { handler } = registeredTools.get('search_codebase')!;
      const result = await handler({ query: 'find auth functions', path: '/etc' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('sensitive system directory');
    });

    it('auto-indexes and retries search when no index found', async () => {
      mockReadProfile.mockResolvedValue({ ...mockProfile });
      mockIsOllamaRunning.mockResolvedValue(true);
      mockRunSearch
        .mockRejectedValueOnce(new NoIndexError('/some/project'))
        .mockResolvedValueOnce({ chunks: [fakeChunk('1')], fallback: false });
      mockRunIndex.mockResolvedValue(undefined);

      const { handler } = registeredTools.get('search_codebase')!;
      const result = await handler({ query: 'auth functions', path: '/some/project' });

      expect(mockRunIndex).toHaveBeenCalledTimes(1);
      expect(mockRunSearch).toHaveBeenCalledTimes(2);
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain('Found 1 result');
    });

    it('returns error envelope when retry also fails after auto-index', async () => {
      mockReadProfile.mockResolvedValue({ ...mockProfile });
      mockIsOllamaRunning.mockResolvedValue(true);
      mockRunSearch.mockRejectedValue(new NoIndexError('/some/project'));
      mockRunIndex.mockResolvedValue(undefined);

      const { handler } = registeredTools.get('search_codebase')!;
      const result = await handler({ query: 'auth functions', path: '/some/project' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('after auto-index');
    });
  });

  // ---- build_context ----

  describe('build_context', () => {
    it('returns isError when no profile exists', async () => {
      mockReadProfile.mockResolvedValue(null);

      const { handler } = registeredTools.get('build_context')!;
      const result = await handler({ query: 'how does auth work' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("brain-cache init");
    });

    it('returns isError when Ollama is not running', async () => {
      mockReadProfile.mockResolvedValue({ ...mockProfile });
      mockIsOllamaRunning.mockResolvedValue(false);

      const { handler } = registeredTools.get('build_context')!;
      const result = await handler({ query: 'how does auth work' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Ollama is not running');
    });

    it('returns formatted context text with metadata footer on success', async () => {
      mockReadProfile.mockResolvedValue({ ...mockProfile });
      mockIsOllamaRunning.mockResolvedValue(true);
      mockRunBuildContext.mockResolvedValue(fakeContextResult);

      const { handler } = registeredTools.get('build_context')!;
      const result = await handler({ query: 'how does auth work', maxTokens: 2000 });

      expect(result.isError).toBeUndefined();
      // build_context returns formatted text, not JSON
      const text = result.content[0].text;
      expect(typeof text).toBe('string');
      expect(text).toContain('Context assembled for');
      expect(text).toContain('how does auth work');
      expect(text).toContain('assembled context here');
      expect(text).toContain('Tokens sent to Claude:');
    });

    it('auto-indexes and retries build_context when no index found', async () => {
      mockReadProfile.mockResolvedValue({ ...mockProfile });
      mockIsOllamaRunning.mockResolvedValue(true);
      mockRunBuildContext
        .mockRejectedValueOnce(new NoIndexError('/some/project'))
        .mockResolvedValueOnce(fakeContextResult);
      mockRunIndex.mockResolvedValue(undefined);

      const { handler } = registeredTools.get('build_context')!;
      const result = await handler({ query: 'how does auth work', path: '/some/project' });

      expect(mockRunIndex).toHaveBeenCalledTimes(1);
      expect(mockRunBuildContext).toHaveBeenCalledTimes(2);
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain('Context assembled for');
    });

    it('returns error envelope when build_context retry also fails after auto-index', async () => {
      mockReadProfile.mockResolvedValue({ ...mockProfile });
      mockIsOllamaRunning.mockResolvedValue(true);
      mockRunBuildContext.mockRejectedValue(new NoIndexError('/some/project'));
      mockRunIndex.mockResolvedValue(undefined);

      const { handler } = registeredTools.get('build_context')!;
      const result = await handler({ query: 'how does auth work', path: '/some/project' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('after auto-index');
    });
  });

  // ---- doctor ----

  describe('doctor', () => {
    it('returns health text even without profile', async () => {
      // doctor does not require profile — unlike other tools
      mockReadProfile.mockResolvedValue(null);
      mockIsOllamaInstalled.mockResolvedValue(true);
      mockIsOllamaRunning.mockResolvedValue(true);
      mockGetOllamaVersion.mockResolvedValue('0.6.3');
      mockReadIndexState.mockResolvedValue(null);
      mockDetectCapabilities.mockResolvedValue({ ...mockCapabilities });

      const { handler } = registeredTools.get('doctor')!;
      const result = await handler({});

      expect(result.isError).toBeUndefined();
      // doctor returns formatted text, not JSON
      const text = result.content[0].text;
      expect(typeof text).toBe('string');
      expect(text).toContain('Ollama:');
      expect(text).toContain('Index:');
      expect(text).toContain('Embedding model:');
      expect(text).toContain('VRAM:');
    });

    it('reports not_installed when Ollama is missing', async () => {
      mockReadProfile.mockResolvedValue({ ...mockProfile });
      mockIsOllamaInstalled.mockResolvedValue(false);
      mockReadIndexState.mockResolvedValue(null);
      mockDetectCapabilities.mockResolvedValue({ ...mockCapabilities });

      const { handler } = registeredTools.get('doctor')!;
      const result = await handler({});

      expect(result.isError).toBeUndefined();
      const text = result.content[0].text;
      expect(text).toContain('not_installed');
    });

    it('returns full health text when everything is running', async () => {
      mockReadProfile.mockResolvedValue({ ...mockProfile });
      mockIsOllamaInstalled.mockResolvedValue(true);
      mockIsOllamaRunning.mockResolvedValue(true);
      mockGetOllamaVersion.mockResolvedValue('0.6.3');
      mockReadIndexState.mockResolvedValue({ ...mockIndexState });
      mockDetectCapabilities.mockResolvedValue({ ...mockCapabilities });

      const { handler } = registeredTools.get('doctor')!;
      const result = await handler({ path: '/my/project' });

      expect(result.isError).toBeUndefined();
      const text = result.content[0].text;
      expect(text).toContain('running');
      expect(text).toContain('0.6.3');
      expect(text).toContain('indexed');
      expect(text).toContain('nomic-embed-text');
    });

    it('reports not_running when installed but Ollama not running', async () => {
      mockReadProfile.mockResolvedValue({ ...mockProfile });
      mockIsOllamaInstalled.mockResolvedValue(true);
      mockIsOllamaRunning.mockResolvedValue(false);
      mockGetOllamaVersion.mockResolvedValue('0.6.3');
      mockReadIndexState.mockResolvedValue(null);
      mockDetectCapabilities.mockResolvedValue({ ...mockCapabilities });

      const { handler } = registeredTools.get('doctor')!;
      const result = await handler({});

      expect(result.isError).toBeUndefined();
      const text = result.content[0].text;
      expect(text).toContain('not_running');
    });
  });
});
