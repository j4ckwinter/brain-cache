import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
}));

vi.mock('../../src/lib/grepStyleBaseline.js', () => ({
  computeGrepStyleBaselineFromChunks: vi.fn().mockResolvedValue({
    grepBaselineTokens: 2400,
    filesUsed: 2,
  }),
}));

vi.mock('../../src/services/tokenCounter.js', () => ({
  countChunkTokens: vi.fn(),
}));

import { readFile } from 'node:fs/promises';
import { countChunkTokens } from '../../src/services/tokenCounter.js';
import { computeTokenSavings } from '../../src/lib/tokenSavings.js';
import type { RetrievedChunk } from '../../src/lib/types.js';

const mockReadFile = vi.mocked(readFile);
const mockCountChunkTokens = vi.mocked(countChunkTokens);

function makeChunk(id: string, filePath: string, contentLength: number): RetrievedChunk {
  return {
    id,
    filePath,
    chunkType: 'function',
    scope: null,
    name: `fn_${id}`,
    content: 'x'.repeat(contentLength),
    startLine: 1,
    endLine: 10,
    fileType: 'source',
    similarity: 0.9,
  };
}

const opts = {
  rootDir: '/proj',
  query: 'foo bar baz',
  tokenCounts: {} as Record<string, number>,
};

describe('computeTokenSavings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('computes tokensSent from chunk bodies and uses grep-style baseline', async () => {
    const chunks = [
      makeChunk('1', '/proj/src/a.ts', 400),
      makeChunk('2', '/proj/src/b.ts', 800),
    ];

    mockCountChunkTokens.mockReturnValueOnce(100).mockReturnValueOnce(200);

    const result = await computeTokenSavings(chunks, opts);

    expect(result.tokensSent).toBe(300);
    expect(result.filesInContext).toBe(2);
    expect(result.matchedPoolTokens).toBe(300);
    expect(result.estimatedWithoutBraincache).toBe(2400);
    expect(result.reductionPct).toBe(88);
  });

  it('returns overhead-only baseline when given 0 chunks', async () => {
    const { computeGrepStyleBaselineFromChunks } = await import(
      '../../src/lib/grepStyleBaseline.js'
    );
    vi.mocked(computeGrepStyleBaselineFromChunks).mockResolvedValueOnce({
      grepBaselineTokens: 300,
      filesUsed: 0,
    });

    const result = await computeTokenSavings([], opts);

    expect(result.tokensSent).toBe(0);
    expect(result.filesInContext).toBe(0);
    expect(result.estimatedWithoutBraincache).toBe(300);
  });

  it('deduplicates files for filesInContext count', async () => {
    const chunks = [
      makeChunk('1', '/proj/src/a.ts', 400),
      makeChunk('2', '/proj/src/a.ts', 300),
    ];

    mockCountChunkTokens.mockReturnValueOnce(100).mockReturnValueOnce(75);

    const result = await computeTokenSavings(chunks, opts);

    expect(result.filesInContext).toBe(1);
    expect(result.tokensSent).toBe(175);
  });

  it('returns reductionPct 0 when tokensSent exceeds baseline', async () => {
    const { computeGrepStyleBaselineFromChunks } = await import(
      '../../src/lib/grepStyleBaseline.js'
    );
    vi.mocked(computeGrepStyleBaselineFromChunks).mockResolvedValueOnce({
      grepBaselineTokens: 100,
      filesUsed: 1,
    });

    const chunks = [makeChunk('1', '/proj/src/a.ts', 4000)];
    mockCountChunkTokens.mockReturnValue(500);
    const result = await computeTokenSavings(chunks, opts);
    expect(result.reductionPct).toBe(0);
  });
});
