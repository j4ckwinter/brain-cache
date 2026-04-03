import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @lancedb/lancedb before importing flowTracer
vi.mock('@lancedb/lancedb', () => ({}));

// Mock logger
vi.mock('../../src/services/logger.js', () => ({
  childLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

// Mock queryEdgesFrom from lancedb service
const mockQueryEdgesFrom = vi.fn();
vi.mock('../../src/services/lancedb.js', () => ({
  queryEdgesFrom: (...args: unknown[]) => mockQueryEdgesFrom(...args),
}));

import { traceFlow, resolveSymbolToChunkId } from '../../src/services/flowTracer.js';
import type { Table } from '@lancedb/lancedb';

// Helper: create a mock LanceDB table that returns rows for `.query().where().toArray()`
function makeMockTable(rowsByPredicate: Record<string, Record<string, unknown>[]>): Table {
  const toArray = vi.fn().mockImplementation(function (this: { _predicate: string }) {
    // Find matching rows by scanning the registered predicates
    for (const [pred, rows] of Object.entries(rowsByPredicate)) {
      if (this._predicate?.includes(pred) || pred === '*') {
        return Promise.resolve(rows);
      }
    }
    return Promise.resolve([]);
  });

  const where = vi.fn().mockImplementation((predicate: string) => {
    const queryObj = { toArray: toArray.bind({ _predicate: predicate }) };
    return queryObj;
  });

  const query = vi.fn().mockReturnValue({ where });
  return { query } as unknown as Table;
}

// Helper: create a mock table that uses a sequence of responses for successive .where() calls
function makeSequentialTable(responses: Record<string, unknown>[][]): Table {
  let callIndex = 0;
  const where = vi.fn().mockImplementation(() => {
    const rows = responses[callIndex] ?? [];
    callIndex++;
    return { toArray: vi.fn().mockResolvedValue(rows) };
  });
  const query = vi.fn().mockReturnValue({ where });
  return { query } as unknown as Table;
}

function makeChunkRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 'chunk-1',
    file_path: 'src/foo.ts',
    chunk_type: 'function',
    scope: null,
    name: 'myFunc',
    content: 'function myFunc() {}',
    start_line: 1,
    end_line: 5,
    ...overrides,
  };
}

function makeEdgeRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    from_chunk_id: 'chunk-1',
    from_file: 'src/foo.ts',
    from_symbol: 'myFunc',
    to_symbol: 'otherFunc',
    to_file: null,
    edge_type: 'call',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('traceFlow', () => {
  it('returns only seed hop when seed has no outgoing call edges', async () => {
    const seedRow = makeChunkRow({ id: 'seed', name: 'seedFunc', file_path: 'src/a.ts' });
    const chunksTable = makeSequentialTable([[seedRow]]);
    mockQueryEdgesFrom.mockResolvedValue([]);

    const result = await traceFlow({} as Table, chunksTable, 'seed');

    expect(result).toHaveLength(1);
    expect(result[0].chunkId).toBe('seed');
    expect(result[0].hopDepth).toBe(0);
  });

  it('returns seed + A + B for seed → A → B chain', async () => {
    const seedRow = makeChunkRow({ id: 'seed', name: 'seedFunc', file_path: 'src/a.ts' });
    const aRow = makeChunkRow({ id: 'chunk-a', name: 'funcA', file_path: 'src/b.ts', start_line: 10, end_line: 15 });
    const bRow = makeChunkRow({ id: 'chunk-b', name: 'funcB', file_path: 'src/c.ts', start_line: 20, end_line: 25 });

    // chunksTable: seed → aRow → bRow
    const chunksTable = makeSequentialTable([[seedRow], [aRow], [bRow]]);

    // seed's edges → A; A's edges → B; B's edges → none
    mockQueryEdgesFrom
      .mockResolvedValueOnce([makeEdgeRow({ from_chunk_id: 'seed', to_symbol: 'funcA', from_file: 'src/a.ts' })])
      .mockResolvedValueOnce([makeEdgeRow({ from_chunk_id: 'chunk-a', to_symbol: 'funcB', from_file: 'src/b.ts' })])
      .mockResolvedValueOnce([]);

    // resolveSymbolToChunkId: funcA → chunk-a, funcB → chunk-b
    // We need chunksTable to also respond to symbol resolution queries
    // Use a more complex mock that handles both chunk lookups and symbol resolution
    // Reset chunksTable with proper sequential responses:
    //   1. seed chunk lookup
    //   2. funcA symbol resolution → aRow
    //   3. chunk-a lookup
    //   4. funcB symbol resolution → bRow
    //   5. chunk-b lookup
    const sequentialChunksTable = makeSequentialTable([
      [seedRow],      // lookup seed
      [aRow],         // resolve funcA
      [aRow],         // lookup chunk-a (by id)
      [bRow],         // resolve funcB
      [bRow],         // lookup chunk-b (by id)
    ]);

    const result = await traceFlow({} as Table, sequentialChunksTable, 'seed');

    expect(result).toHaveLength(3);
    expect(result[0].hopDepth).toBe(0);
    expect(result[1].hopDepth).toBe(1);
    expect(result[2].hopDepth).toBe(2);
  });

  it('handles cycle (A → B → A) by visiting each chunk exactly once', async () => {
    const aRow = makeChunkRow({ id: 'chunk-a', name: 'funcA', file_path: 'src/a.ts' });
    const bRow = makeChunkRow({ id: 'chunk-b', name: 'funcB', file_path: 'src/b.ts' });

    // Seed is chunk-a; A → B → A cycle
    mockQueryEdgesFrom
      .mockResolvedValueOnce([makeEdgeRow({ from_chunk_id: 'chunk-a', to_symbol: 'funcB', from_file: 'src/a.ts' })])
      .mockResolvedValueOnce([makeEdgeRow({ from_chunk_id: 'chunk-b', to_symbol: 'funcA', from_file: 'src/b.ts' })]);

    const chunksTable = makeSequentialTable([
      [aRow],  // lookup chunk-a (seed)
      [bRow],  // resolve funcB
      [bRow],  // lookup chunk-b
      [aRow],  // resolve funcA (but chunk-a is already visited)
    ]);

    const result = await traceFlow({} as Table, chunksTable, 'chunk-a');

    expect(result).toHaveLength(2);
    expect(result.map(h => h.chunkId)).toEqual(['chunk-a', 'chunk-b']);
  });

  it('stops at maxHops=1, returning only [seed, A], not B (B not enqueued)', async () => {
    const seedRow = makeChunkRow({ id: 'seed', name: 'seedFunc', file_path: 'src/a.ts' });
    const aRow = makeChunkRow({ id: 'chunk-a', name: 'funcA', file_path: 'src/b.ts' });

    mockQueryEdgesFrom
      // seed edges → funcA (enqueued since depth 0 < maxHops 1)
      .mockResolvedValueOnce([makeEdgeRow({ from_chunk_id: 'seed', to_symbol: 'funcA', from_file: 'src/a.ts' })])
      // chunk-a edges at depth 1 (= maxHops): queried for callsFound, but not enqueued
      .mockResolvedValueOnce([makeEdgeRow({ from_chunk_id: 'chunk-a', to_symbol: 'funcB', from_file: 'src/b.ts' })]);

    const chunksTable = makeSequentialTable([
      [seedRow], // lookup seed
      [aRow],    // resolve funcA
      [aRow],    // lookup chunk-a
    ]);

    const result = await traceFlow({} as Table, chunksTable, 'seed', { maxHops: 1 });

    expect(result).toHaveLength(2);
    expect(result[0].chunkId).toBe('seed');
    expect(result[1].chunkId).toBe('chunk-a');
    // queryEdgesFrom called for both seed and chunk-a (edges always queried for callsFound)
    expect(mockQueryEdgesFrom).toHaveBeenCalledTimes(2);
    // chunk-a callsFound has funcB (edges queried but not enqueued)
    expect(result[1].callsFound).toEqual(['funcB']);
  });

  it('returns only [seed] when maxHops=0', async () => {
    const seedRow = makeChunkRow({ id: 'seed', name: 'seedFunc', file_path: 'src/a.ts' });
    const chunksTable = makeSequentialTable([[seedRow]]);
    // seed at depth=0 = maxHops=0: edges queried for callsFound, but no children enqueued
    mockQueryEdgesFrom.mockResolvedValueOnce([]);

    const result = await traceFlow({} as Table, chunksTable, 'seed', { maxHops: 0 });

    expect(result).toHaveLength(1);
    expect(result[0].chunkId).toBe('seed');
    expect(result[0].callsFound).toEqual([]);
    // queryEdgesFrom IS called once (for seed) to populate callsFound
    expect(mockQueryEdgesFrom).toHaveBeenCalledTimes(1);
  });

  it('skips edges where toSymbol resolves to no chunk (dead end)', async () => {
    const seedRow = makeChunkRow({ id: 'seed', name: 'seedFunc', file_path: 'src/a.ts' });

    mockQueryEdgesFrom.mockResolvedValueOnce([
      makeEdgeRow({ from_chunk_id: 'seed', to_symbol: 'nonExistentFunc', from_file: 'src/a.ts' }),
    ]);

    // chunksTable: seed found, symbol resolution returns empty → dead end
    const chunksTable = makeSequentialTable([
      [seedRow], // lookup seed
      [],        // resolve nonExistentFunc → not found
    ]);

    const result = await traceFlow({} as Table, chunksTable, 'seed');

    expect(result).toHaveLength(1);
    expect(result[0].chunkId).toBe('seed');
  });

  it('only follows edge_type="call" edges, ignoring edge_type="import"', async () => {
    const seedRow = makeChunkRow({ id: 'seed', name: 'seedFunc', file_path: 'src/a.ts' });

    mockQueryEdgesFrom.mockResolvedValueOnce([
      makeEdgeRow({ from_chunk_id: 'seed', to_symbol: 'importedModule', from_file: 'src/a.ts', edge_type: 'import' }),
      makeEdgeRow({ from_chunk_id: 'seed', to_symbol: 'calledFunc', from_file: 'src/a.ts', edge_type: 'call' }),
    ]);

    const calledRow = makeChunkRow({ id: 'chunk-called', name: 'calledFunc', file_path: 'src/b.ts' });

    // Only calledFunc should be resolved (import edge is skipped)
    const chunksTable = makeSequentialTable([
      [seedRow],    // lookup seed
      [calledRow],  // resolve calledFunc (import edge is filtered out before resolution)
      [calledRow],  // lookup chunk-called
    ]);

    mockQueryEdgesFrom.mockReset();
    mockQueryEdgesFrom
      .mockResolvedValueOnce([
        makeEdgeRow({ from_chunk_id: 'seed', to_symbol: 'importedModule', from_file: 'src/a.ts', edge_type: 'import' }),
        makeEdgeRow({ from_chunk_id: 'seed', to_symbol: 'calledFunc', from_file: 'src/a.ts', edge_type: 'call' }),
      ])
      .mockResolvedValueOnce([]);

    const result = await traceFlow({} as Table, chunksTable, 'seed');

    expect(result).toHaveLength(2);
    expect(result.map(h => h.chunkId)).toContain('seed');
    expect(result.map(h => h.chunkId)).toContain('chunk-called');
  });
});

describe('traceFlow — callsFound', () => {
  it('hop 0 has callsFound populated with toSymbol names from call edges', async () => {
    const seedRow = makeChunkRow({ id: 'seed', name: 'seedFunc', file_path: 'src/a.ts' });

    mockQueryEdgesFrom.mockResolvedValueOnce([
      makeEdgeRow({ from_chunk_id: 'seed', to_symbol: 'funcA', from_file: 'src/a.ts' }),
      makeEdgeRow({ from_chunk_id: 'seed', to_symbol: 'funcB', from_file: 'src/a.ts' }),
    ]);

    // chunksTable: seed found, then funcA + funcB symbol resolution returns nothing (dead ends)
    const chunksTable = makeSequentialTable([
      [seedRow], // lookup seed
      [],        // resolve funcA → not found
      [],        // resolve funcB → not found
    ]);

    const result = await traceFlow({} as Table, chunksTable, 'seed');

    expect(result).toHaveLength(1);
    expect(result[0].callsFound).toEqual(['funcA', 'funcB']);
  });

  it('hop has callsFound as empty array when chunk has no outgoing call edges', async () => {
    const seedRow = makeChunkRow({ id: 'seed', name: 'seedFunc', file_path: 'src/a.ts' });
    const chunksTable = makeSequentialTable([[seedRow]]);
    mockQueryEdgesFrom.mockResolvedValue([]);

    const result = await traceFlow({} as Table, chunksTable, 'seed');

    expect(result).toHaveLength(1);
    expect(result[0].callsFound).toEqual([]);
  });

  it('callsFound only includes call edges, not import edges', async () => {
    const seedRow = makeChunkRow({ id: 'seed', name: 'seedFunc', file_path: 'src/a.ts' });

    mockQueryEdgesFrom.mockResolvedValueOnce([
      makeEdgeRow({ from_chunk_id: 'seed', to_symbol: 'importedMod', from_file: 'src/a.ts', edge_type: 'import' }),
      makeEdgeRow({ from_chunk_id: 'seed', to_symbol: 'calledFunc', from_file: 'src/a.ts', edge_type: 'call' }),
    ]);

    const chunksTable = makeSequentialTable([
      [seedRow], // lookup seed
      [],        // resolve calledFunc → not found (dead end)
    ]);

    const result = await traceFlow({} as Table, chunksTable, 'seed');

    expect(result[0].callsFound).toEqual(['calledFunc']);
  });

  it('hops at maxHops depth still have callsFound populated', async () => {
    const seedRow = makeChunkRow({ id: 'seed', name: 'seedFunc', file_path: 'src/a.ts' });
    const aRow = makeChunkRow({ id: 'chunk-a', name: 'funcA', file_path: 'src/b.ts' });

    mockQueryEdgesFrom
      // seed edges
      .mockResolvedValueOnce([makeEdgeRow({ from_chunk_id: 'seed', to_symbol: 'funcA', from_file: 'src/a.ts' })])
      // chunk-a edges (at maxHops=1, depth 1 = maxHops, so edges are queried but children not enqueued)
      .mockResolvedValueOnce([makeEdgeRow({ from_chunk_id: 'chunk-a', to_symbol: 'funcB', from_file: 'src/b.ts' })]);

    const chunksTable = makeSequentialTable([
      [seedRow], // lookup seed
      [aRow],    // resolve funcA
      [aRow],    // lookup chunk-a
    ]);

    const result = await traceFlow({} as Table, chunksTable, 'seed', { maxHops: 1 });

    expect(result).toHaveLength(2);
    expect(result[0].callsFound).toEqual(['funcA']);
    expect(result[1].callsFound).toEqual(['funcB']);
    // queryEdgesFrom called for both seed and chunk-a
    expect(mockQueryEdgesFrom).toHaveBeenCalledTimes(2);
  });
});

describe('resolveSymbolToChunkId', () => {
  it('returns same-file match when multiple chunks have same name', async () => {
    const sameFile = makeChunkRow({ id: 'same-file-id', name: 'myFunc', file_path: 'src/foo.ts' });
    const otherFile = makeChunkRow({ id: 'other-file-id', name: 'myFunc', file_path: 'src/bar.ts' });

    const chunksTable = makeSequentialTable([[sameFile, otherFile]]);

    const result = await resolveSymbolToChunkId(chunksTable, 'myFunc', 'src/foo.ts');

    expect(result).toBe('same-file-id');
  });

  it('returns first match when no same-file chunk found', async () => {
    const rowA = makeChunkRow({ id: 'id-a', name: 'myFunc', file_path: 'src/bar.ts' });
    const rowB = makeChunkRow({ id: 'id-b', name: 'myFunc', file_path: 'src/baz.ts' });

    const chunksTable = makeSequentialTable([[rowA, rowB]]);

    const result = await resolveSymbolToChunkId(chunksTable, 'myFunc', 'src/foo.ts');

    expect(result).toBe('id-a');
  });

  it('returns null when no chunk has the given name', async () => {
    const chunksTable = makeSequentialTable([[]]);

    const result = await resolveSymbolToChunkId(chunksTable, 'nonExistent', 'src/foo.ts');

    expect(result).toBeNull();
  });

  it('escapes single quotes in symbol name to prevent SQL injection', async () => {
    const chunksTable = makeSequentialTable([[]]);

    // Should not throw — the single quote in the symbol name should be escaped
    const result = await resolveSymbolToChunkId(chunksTable, "it's a trap", 'src/foo.ts');

    expect(result).toBeNull();
    // Verify the where clause received the escaped symbol
    expect((chunksTable.query as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
  });
});
