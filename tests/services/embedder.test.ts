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
    });
    expect(result).toEqual(fakeEmbeddings);
  });

  it('returns empty array without calling ollama when texts is empty', async () => {
    const result = await embedBatch('nomic-embed-text', []);

    expect(mockOllama.embed).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  it('rejects after EMBED_TIMEOUT_MS when ollama.embed never resolves', async () => {
    // Mock ollama.embed to never resolve
    mockOllama.embed.mockImplementation(
      () => new Promise(() => {}) // never resolves
    );

    // Override EMBED_TIMEOUT_MS by importing with short timeout
    // We test the timeout logic by using fake timers
    vi.useFakeTimers();

    const embedPromise = embedBatch('nomic-embed-text', ['text'], 100); // 100ms timeout override

    // Advance time past the timeout
    await vi.advanceTimersByTimeAsync(200);

    await expect(embedPromise).rejects.toThrow(/timeout/i);

    vi.useRealTimers();
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
    expect(result).toEqual(fakeEmbeddings);
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
    expect(result).toEqual(fakeEmbeddings);
  });

  it('throws on second failure (no infinite retry)', async () => {
    const connectionError = new Error('ECONNRESET');

    mockOllama.embed
      .mockRejectedValueOnce(connectionError)
      .mockRejectedValueOnce(connectionError);

    vi.useFakeTimers();
    const resultPromise = embedBatchWithRetry('nomic-embed-text', ['hello']);
    await vi.advanceTimersByTimeAsync(6000);

    await expect(resultPromise).rejects.toThrow('ECONNRESET');
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
});
