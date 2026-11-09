import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it('uses the configured host for health, model listing, pulling, and embedding', async () => {
  vi.stubEnv('OLLAMA_HOST', 'http://127.0.0.1:19999');
  const fetchMock = vi.fn(async (url: string | URL | Request) => {
    const path = String(url);
    if (path.endsWith('/api/tags')) return Response.json({ models: [] });
    if (path.endsWith('/api/pull')) {
      return new Response('{"status":"success"}\n');
    }
    return Response.json({ embeddings: [[1, 0]] });
  });
  vi.stubGlobal('fetch', fetchMock);

  const { isOllamaRunning, pullModelIfMissing } = await import('../../src/services/ollama.js');
  const { embedBatch } = await import('../../src/services/embedder.js');
  expect(await isOllamaRunning()).toBe(true);
  await pullModelIfMissing('nomic-embed-text', () => {});
  expect(await embedBatch('nomic-embed-text', ['probe'])).toEqual([[1, 0]]);
  expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
    'http://127.0.0.1:19999',
    'http://127.0.0.1:19999/api/tags',
    'http://127.0.0.1:19999/api/pull',
    'http://127.0.0.1:19999/api/embed',
  ]);
});
