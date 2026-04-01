import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createVectorIndexIfNeeded } from '../../src/services/lancedb.js';

// Mock the config module to control threshold
vi.mock('../../src/lib/config.js', async () => {
  const actual = await vi.importActual('../../src/lib/config.js');
  return {
    ...actual,
    VECTOR_INDEX_THRESHOLD: 100, // low threshold for testing
  };
});

describe('createVectorIndexIfNeeded', () => {
  function mockTable(rowCount: number, existingIndices: Array<{ columns: string[] }> = []) {
    return {
      countRows: vi.fn().mockResolvedValue(rowCount),
      listIndices: vi.fn().mockResolvedValue(existingIndices),
      createIndex: vi.fn().mockResolvedValue(undefined),
    };
  }

  it('skips index creation when row count is below threshold', async () => {
    const table = mockTable(50);
    await createVectorIndexIfNeeded(table as any, 'nomic-embed-text');
    expect(table.createIndex).not.toHaveBeenCalled();
  });

  it('skips index creation when vector index already exists', async () => {
    const table = mockTable(200, [{ columns: ['vector'] }]);
    await createVectorIndexIfNeeded(table as any, 'nomic-embed-text');
    expect(table.createIndex).not.toHaveBeenCalled();
  });

  it('creates IVF-PQ index when above threshold and no index exists', async () => {
    const table = mockTable(200, []);
    await createVectorIndexIfNeeded(table as any, 'nomic-embed-text');
    expect(table.createIndex).toHaveBeenCalledOnce();
    expect(table.createIndex).toHaveBeenCalledWith('vector', expect.objectContaining({
      config: expect.any(Object),
    }));
  });

  it('uses correct numSubVectors for 1024-dim model', async () => {
    const table = mockTable(200, []);
    await createVectorIndexIfNeeded(table as any, 'mxbai-embed-large');
    expect(table.createIndex).toHaveBeenCalledOnce();
  });
});
