import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fs/promises readFile
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
}));

// Mock countChunkTokens to return predictable values
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

describe('computeTokenSavings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('computes savings from 2 chunks from 2 different files', async () => {
    // Chunk 1: 400 chars content from file A
    // Chunk 2: 800 chars content from file B
    const chunks = [
      makeChunk('1', '/proj/src/a.ts', 400),
      makeChunk('2', '/proj/src/b.ts', 800),
    ];

    // File A has 500 tokens, file B has 1000 tokens
    mockReadFile
      .mockResolvedValueOnce('file-a-content' as any)
      .mockResolvedValueOnce('file-b-content' as any);
    mockCountChunkTokens
      .mockReturnValueOnce(500) // file A
      .mockReturnValueOnce(1000); // file B

    const result = await computeTokenSavings(chunks);

    // tokensSent = round((400 + 800) / 4) = round(300) = 300
    expect(result.tokensSent).toBe(300);
    // filesInContext = 2
    expect(result.filesInContext).toBe(2);
    // estimatedWithoutBraincache = (500 + 1000) + (1 + 2) * 300 = 1500 + 900 = 2400
    expect(result.estimatedWithoutBraincache).toBe(2400);
    // reductionPct = max(0, round((1 - 300/2400) * 100)) = round(87.5) = 88
    expect(result.reductionPct).toBe(88);
  });

  it('returns zeros-with-overhead when given 0 chunks', async () => {
    const result = await computeTokenSavings([]);

    expect(result.tokensSent).toBe(0);
    expect(result.filesInContext).toBe(0);
    // toolCalls = 1 + 0 = 1, estimatedWithout = 0 + 1 * 300 = 300
    expect(result.estimatedWithoutBraincache).toBe(300);
    // reductionPct = max(0, round((1 - 0/300)*100)) = 100
    expect(result.reductionPct).toBe(100);
  });

  it('handles missing files gracefully (file deleted since indexing)', async () => {
    const chunks = [
      makeChunk('1', '/proj/src/exists.ts', 400),
      makeChunk('2', '/proj/src/deleted.ts', 200),
    ];

    // First file reads OK, second throws (deleted)
    mockReadFile
      .mockResolvedValueOnce('existing-content' as any)
      .mockRejectedValueOnce(new Error('ENOENT: no such file'));
    mockCountChunkTokens.mockReturnValueOnce(600); // only called for first file

    const result = await computeTokenSavings(chunks);

    // Should not throw, should skip the missing file
    expect(result.tokensSent).toBe(Math.round((400 + 200) / 4)); // 150
    expect(result.filesInContext).toBe(2);
    // Only existing file counted: 600 + (1 + 2) * 300 = 600 + 900 = 1500
    expect(result.estimatedWithoutBraincache).toBe(1500);
  });

  it('deduplicates files (2 chunks from same file count the file once)', async () => {
    const chunks = [
      makeChunk('1', '/proj/src/a.ts', 400),
      makeChunk('2', '/proj/src/a.ts', 300), // same file
    ];

    mockReadFile.mockResolvedValueOnce('file-a-content' as any); // called once
    mockCountChunkTokens.mockReturnValueOnce(800); // file A counted once

    const result = await computeTokenSavings(chunks);

    // tokensSent = round((400 + 300) / 4) = round(175) = 175
    expect(result.tokensSent).toBe(175);
    // filesInContext = 1 (deduplicated)
    expect(result.filesInContext).toBe(1);
    // estimatedWithout = 800 + (1 + 1) * 300 = 800 + 600 = 1400
    expect(result.estimatedWithoutBraincache).toBe(1400);
    // readFile called only once
    expect(mockReadFile).toHaveBeenCalledTimes(1);
    expect(mockReadFile).toHaveBeenCalledWith('/proj/src/a.ts', 'utf-8');
  });

  it('returns reductionPct of 0 when estimatedWithout is 0', async () => {
    // This would be unusual but the guard prevents division by zero
    // We can achieve this by having a chunk with a file that has 0 tokens
    // and 0 tool call overhead - not directly possible with current formula.
    // Instead test the guard: when computed estimatedWithout is 0.
    // The formula always adds at least 1 toolCall * 300 = 300, so this
    // tests the edge case via direct internal check.
    //
    // Since TOOL_CALL_OVERHEAD_TOKENS is always > 0, estimatedWithout
    // can't be 0 in practice. We test that reductionPct clamps at 0
    // when tokensSent > estimatedWithoutBraincache.
    const chunks = [makeChunk('1', '/proj/src/tiny.ts', 99999)]; // huge chunk

    // File has very few tokens so estimatedWithout < tokensSent
    mockReadFile.mockResolvedValueOnce('tiny' as any);
    mockCountChunkTokens.mockReturnValueOnce(1); // 1 token in file

    const result = await computeTokenSavings(chunks);

    // tokensSent = round(99999 / 4) = 24999 (chunk tokens)
    // estimatedWithout = 1 + (1 + 1) * 300 = 601
    // Without clamp: (1 - 24999/601)*100 = highly negative
    // With clamp: max(0, ...) = 0
    expect(result.reductionPct).toBe(0);
  });
});
