import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock ollama module before importing embedder
vi.mock('ollama', () => ({
  default: {
    embed: vi.fn(),
  },
}));

import ollama from 'ollama';
import { embedBatch, embedBatchWithRetry } from '../../src/services/embedder.js';

const mockOllama = vi.mocked(ollama);

describe('embedBatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls ollama.embed with model and input array, returns embeddings', async () => {
    const fakeEmbeddings = [[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]];
    mockOllama.embed.mockResolvedValue({
      embeddings: fakeEmbeddings,
      model: 'nomic-embed-text',
      total_duration: 100,
      load_duration: 50,
      prompt_eval_count: 2,
    });

    const result = await embedBatch('nomic-embed-text', ['hello world', 'foo bar']);

    expect(mockOllama.embed).toHaveBeenCalledWith({
      model: 'nomic-embed-text',
      input: ['hello world', 'foo bar'],
      truncate: true,
    });
    expect(result).toEqual(fakeEmbeddings);
  });

  it('returns empty array without calling ollama when texts is empty', async () => {
    const result = await embedBatch('nomic-embed-text', []);

    expect(mockOllama.embed).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  it('rejects after EMBED_TIMEOUT_MS when ollama.embed never resolves', async () => {
    // Use a real short timeout (1ms) rather than fake timers to avoid
    // vitest fake-timer PromiseRejectionHandledWarning edge case
    mockOllama.embed.mockImplementation(
      () => new Promise<never>(() => {}) // never resolves
    );

    // Pass 1ms timeout — in real time this will fire almost immediately
    await expect(embedBatch('nomic-embed-text', ['text'], 1)).rejects.toThrow(/timeout/i);
  });
});

describe('embedBatchWithRetry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns embeddings on first success without retry', async () => {
    const fakeEmbeddings = [[0.1, 0.2, 0.3]];
    mockOllama.embed.mockResolvedValue({
      embeddings: fakeEmbeddings,
      model: 'nomic-embed-text',
      total_duration: 100,
      load_duration: 50,
      prompt_eval_count: 1,
    });

    const result = await embedBatchWithRetry('nomic-embed-text', ['hello']);

    expect(mockOllama.embed).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ embeddings: fakeEmbeddings, skipped: 0 });
    expect(result.zeroVectorIndices).toBeInstanceOf(Set);
    expect(result.zeroVectorIndices.size).toBe(0);
  });

  it('retries once on ECONNRESET connection error then succeeds', async () => {
    const fakeEmbeddings = [[0.7, 0.8, 0.9]];

    mockOllama.embed
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce({
        embeddings: fakeEmbeddings,
        model: 'nomic-embed-text',
        total_duration: 100,
        load_duration: 50,
        prompt_eval_count: 1,
      });

    vi.useFakeTimers();
    const resultPromise = embedBatchWithRetry('nomic-embed-text', ['hello']);
    // Advance past cold-start retry delay (5s)
    await vi.advanceTimersByTimeAsync(6000);
    const result = await resultPromise;

    expect(mockOllama.embed).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ embeddings: fakeEmbeddings, skipped: 0 });
  });

  it('throws on second failure (no infinite retry)', async () => {
    vi.useFakeTimers();

    const connectionError = new Error('ECONNRESET');

    mockOllama.embed
      .mockRejectedValueOnce(connectionError)
      .mockRejectedValueOnce(connectionError);

    // Use catch to consume the rejection before asserting
    let caughtError: Error | undefined;
    const resultPromise = embedBatchWithRetry('nomic-embed-text', ['hello']).catch((e) => {
      caughtError = e;
    });
    await vi.advanceTimersByTimeAsync(6000);
    await resultPromise;

    expect(caughtError?.message).toBe('ECONNRESET');
    expect(mockOllama.embed).toHaveBeenCalledTimes(2);
  });

  it('does not retry on non-connection errors (rethrows immediately)', async () => {
    const nonConnectionError = new Error('Model not found');

    mockOllama.embed.mockRejectedValueOnce(nonConnectionError);

    await expect(embedBatchWithRetry('nomic-embed-text', ['hello'])).rejects.toThrow(
      'Model not found'
    );
    expect(mockOllama.embed).toHaveBeenCalledTimes(1);
  });

  it('returns zeroVectorIndices containing index of text that exceeded context length', async () => {
    // Batch fails with context-length error, falls back to per-text embedding
    // text[0] succeeds, text[1] still exceeds context
    const contextLengthError = new Error('input length exceeds the context length');
    const successEmbedding = [[0.1, 0.2, 0.3]];

    mockOllama.embed
      .mockRejectedValueOnce(contextLengthError) // batch call fails
      .mockResolvedValueOnce({ embeddings: successEmbedding, model: 'nomic-embed-text', total_duration: 100, load_duration: 50, prompt_eval_count: 1 }) // text[0] succeeds
      .mockRejectedValueOnce(contextLengthError); // text[1] still fails

    const result = await embedBatchWithRetry('nomic-embed-text', ['short text', 'very long text that exceeds limit'], 3);

    expect(result.zeroVectorIndices).toBeInstanceOf(Set);
    expect(result.zeroVectorIndices.has(0)).toBe(false);
    expect(result.zeroVectorIndices.has(1)).toBe(true);
    expect(result.zeroVectorIndices.size).toBe(1);
    // The zero-vector is still in embeddings array (for index alignment)
    expect(result.embeddings[1]).toEqual([0, 0, 0]);
  });

  it('returns empty zeroVectorIndices when all texts embed successfully', async () => {
    const fakeEmbeddings = [[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]];
    mockOllama.embed.mockResolvedValue({
      embeddings: fakeEmbeddings,
      model: 'nomic-embed-text',
      total_duration: 100,
      load_duration: 50,
      prompt_eval_count: 2,
    });

    const result = await embedBatchWithRetry('nomic-embed-text', ['hello', 'world']);

    expect(result.zeroVectorIndices).toBeInstanceOf(Set);
    expect(result.zeroVectorIndices.size).toBe(0);
  });
});

describe('embedBatchWithRetry binary search fallback', () => {
  // Helper to make a success response
  function makeSuccess(embeddings: number[][]): { embeddings: number[][], model: string, total_duration: number, load_duration: number, prompt_eval_count: number } {
    return { embeddings, model: 'nomic-embed-text', total_duration: 100, load_duration: 50, prompt_eval_count: embeddings.length };
  }

  const contextLengthError = new Error('input length exceeds the context length');

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Test 1: single bad chunk in batch of 8 — binary search isolates in O(log 8) calls', async () => {
    // 8 texts, index 5 is "OVERSIZED"
    const texts = ['a', 'b', 'c', 'd', 'e', 'OVERSIZED', 'g', 'h'];
    const realVec = [0.1, 0.2, 0.3];

    let callCount = 0;

    mockOllama.embed.mockImplementation(async ({ input }: { input: string[] }) => {
      callCount++;
      if (input.includes('OVERSIZED')) {
        throw contextLengthError;
      }
      return makeSuccess(input.map(() => realVec));
    });

    const result = await embedBatchWithRetry('nomic-embed-text', texts, 3);

    // Binary search should use O(log 8) ~ 3-4 calls to isolate + 1 final batch
    // Upper bound: ceil(log2(8)) + 2 = 5
    expect(callCount).toBeLessThanOrEqual(Math.ceil(Math.log2(8)) + 2);

    // Bad index is 5
    expect(result.zeroVectorIndices).toBeInstanceOf(Set);
    expect(result.zeroVectorIndices).toEqual(new Set([5]));
    expect(result.skipped).toBe(1);

    // Zero vector at index 5
    expect(result.embeddings[5]).toEqual([0, 0, 0]);

    // Good texts get real vectors
    expect(result.embeddings.length).toBe(8);
    for (let i = 0; i < 8; i++) {
      if (i !== 5) {
        expect(result.embeddings[i]).toEqual(realVec);
      }
    }
  });

  it('Test 2: two bad chunks in batch of 8 — both isolated, total calls < 16', async () => {
    // index 2 and 6 are oversized
    const texts = ['a', 'b', 'OVERSIZED_2', 'd', 'e', 'f', 'OVERSIZED_6', 'h'];
    const realVec = [0.4, 0.5, 0.6];

    let callCount = 0;

    mockOllama.embed.mockImplementation(async ({ input }: { input: string[] }) => {
      callCount++;
      if (input.includes('OVERSIZED_2') || input.includes('OVERSIZED_6')) {
        throw contextLengthError;
      }
      return makeSuccess(input.map(() => realVec));
    });

    const result = await embedBatchWithRetry('nomic-embed-text', texts, 3);

    // Total embed calls should be well below O(N)=8 individual calls
    expect(callCount).toBeLessThan(16);

    expect(result.zeroVectorIndices).toEqual(new Set([2, 6]));
    expect(result.skipped).toBe(2);

    expect(result.embeddings[2]).toEqual([0, 0, 0]);
    expect(result.embeddings[6]).toEqual([0, 0, 0]);
    expect(result.embeddings.length).toBe(8);

    for (let i = 0; i < 8; i++) {
      if (i !== 2 && i !== 6) {
        expect(result.embeddings[i]).toEqual(realVec);
      }
    }
  });

  it('Test 3: all chunks good — returns normally without entering fallback, exactly 1 embed call', async () => {
    const texts = ['a', 'b', 'c', 'd'];
    const realVecs = texts.map((_, i) => [i * 0.1, i * 0.2, i * 0.3]);

    mockOllama.embed.mockImplementation(async ({ input }: { input: string[] }) => {
      return makeSuccess(input.map((_, i) => realVecs[i] ?? [0.1, 0.1, 0.1]));
    });

    let callCount = 0;
    const origMock = mockOllama.embed.getMockImplementation()!;
    mockOllama.embed.mockImplementation(async (args: { input: string[] }) => {
      callCount++;
      return origMock(args);
    });

    const result = await embedBatchWithRetry('nomic-embed-text', texts, 3);

    expect(callCount).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.zeroVectorIndices.size).toBe(0);
    expect(result.embeddings.length).toBe(4);
  });

  it('Test 4: single chunk that exceeds context — marked as zero vector', async () => {
    const texts = ['OVERSIZED_ONLY'];

    mockOllama.embed.mockImplementation(async ({ input }: { input: string[] }) => {
      if (input.includes('OVERSIZED_ONLY')) {
        throw contextLengthError;
      }
      return makeSuccess(input.map(() => [0.1, 0.2, 0.3]));
    });

    const result = await embedBatchWithRetry('nomic-embed-text', texts, 3);

    expect(result.zeroVectorIndices).toEqual(new Set([0]));
    expect(result.skipped).toBe(1);
    expect(result.embeddings[0]).toEqual([0, 0, 0]);
    expect(result.embeddings.length).toBe(1);
  });

  it('Test 5: non-context-length error during binary search — throws without catching', async () => {
    const texts = ['a', 'b', 'c', 'd'];
    const unexpectedError = new Error('Model not found');

    mockOllama.embed
      .mockRejectedValueOnce(contextLengthError) // initial batch fails with context-length
      .mockRejectedValueOnce(unexpectedError);    // binary search sub-call throws unexpected error

    await expect(embedBatchWithRetry('nomic-embed-text', texts, 3)).rejects.toThrow('Model not found');
  });

  it('Test 6: return type shape unchanged — embeddings array, skipped count, zeroVectorIndices Set', async () => {
    const texts = ['a', 'b', 'OVERSIZED', 'd'];

    mockOllama.embed.mockImplementation(async ({ input }: { input: string[] }) => {
      if (input.includes('OVERSIZED')) throw contextLengthError;
      return makeSuccess(input.map(() => [0.5, 0.5, 0.5]));
    });

    const result = await embedBatchWithRetry('nomic-embed-text', texts, 3);

    expect(result).toHaveProperty('embeddings');
    expect(result).toHaveProperty('skipped');
    expect(result).toHaveProperty('zeroVectorIndices');
    expect(Array.isArray(result.embeddings)).toBe(true);
    expect(typeof result.skipped).toBe('number');
    expect(result.zeroVectorIndices).toBeInstanceOf(Set);
    expect(result.embeddings.length).toBe(texts.length);
  });

  it('Test 7: cold-start retry path (attempt=0, connection error) still works as before', async () => {
    const fakeEmbeddings = [[0.7, 0.8, 0.9]];

    mockOllama.embed
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce(makeSuccess(fakeEmbeddings));

    vi.useFakeTimers();
    const resultPromise = embedBatchWithRetry('nomic-embed-text', ['hello'], 3);
    await vi.advanceTimersByTimeAsync(6000);
    const result = await resultPromise;
    vi.useRealTimers();

    expect(mockOllama.embed).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ embeddings: fakeEmbeddings, skipped: 0 });
    expect(result.zeroVectorIndices.size).toBe(0);
  });
});
