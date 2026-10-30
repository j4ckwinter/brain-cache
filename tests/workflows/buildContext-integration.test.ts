import { randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { insertChunks, openDatabase, openOrCreateChunkTable, writeIndexState } from '../../src/services/lancedb.js';
import { embedBatchWithRetry } from '../../src/services/embedder.js';
import { countChunkTokens } from '../../src/services/tokenCounter.js';
import { runBuildContext } from '../../src/workflows/buildContext.js';

vi.mock('../../src/services/capability.js', () => ({
  readProfile: vi.fn().mockResolvedValue({ embeddingModel: 'nomic-embed-text' }),
}));
vi.mock('../../src/services/ollama.js', () => ({
  isOllamaRunning: vi.fn().mockResolvedValue(false),
}));
vi.mock('../../src/services/embedder.js', () => ({
  embedBatchWithRetry: vi.fn().mockRejectedValue(new Error('Unexpected embedding call')),
}));

describe('offline context with a real LanceDB index', () => {
  let project: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    project = join(tmpdir(), `bc-offline-context-${randomUUID()}`);
    await mkdir(project, { recursive: true });
  });

  afterEach(async () => {
    await rm(project, { recursive: true, force: true });
  });

  async function createIndex(withChunks: boolean) {
    const db = await openDatabase(project);
    const table = await openOrCreateChunkTable(db, project, 'nomic-embed-text', 768);
    if (withChunks) {
      await insertChunks(table, [{
        id: 'auth', file_path: 'src/auth.ts', chunk_type: 'function', scope: null,
        name: 'authenticateUser', content: 'export function authenticateUser() { return true; }',
        start_line: 1, end_line: 1, file_type: 'source', source_kind: 'file', vector: new Array(768).fill(0),
      }]);
    }
    await writeIndexState(project, {
      version: 1, embeddingModel: 'nomic-embed-text', dimension: 768,
      indexedAt: new Date().toISOString(), fileCount: withChunks ? 1 : 0, chunkCount: withChunks ? 1 : 0, totalTokens: 0,
    });
  }

  it('returns budgeted keyword context without calling the embedder', async () => {
    await createIndex(true);
    const result = await runBuildContext('authenticateUser', { path: project, maxTokens: 100 });
    expect(result.content).toContain('export function authenticateUser');
    expect(result.chunks.map(chunk => chunk.id)).toEqual(['auth']);
    expect(result.metadata.tokensSent).toBe(countChunkTokens(result.content));
    expect(result.metadata.tokensSent).toBeLessThanOrEqual(100);
    expect(result.metadata.localTasksPerformed).toEqual(['keyword_search', 'dedup', 'token_budget']);
    expect(result.content).not.toContain('[FALLBACK]');
    expect(embedBatchWithRetry).not.toHaveBeenCalled();
  });

  it('returns empty context for an existing empty index', async () => {
    await createIndex(false);
    const result = await runBuildContext('authenticateUser', { path: project, maxTokens: 100 });
    expect(result.content).toBe('');
    expect(result.chunks).toEqual([]);
    expect(result.metadata.tokensSent).toBe(0);
    expect(embedBatchWithRetry).not.toHaveBeenCalled();
  });

  it('rejects a missing index rather than presenting an empty success', async () => {
    await expect(runBuildContext('authenticateUser', { path: project })).rejects.toThrow('No index found');
    expect(embedBatchWithRetry).not.toHaveBeenCalled();
  });
});
