import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @lancedb/lancedb before importing retriever
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

// Mock lancedb service before importing retriever (needed for expandByEdges)
vi.mock('../../src/services/lancedb.js', () => ({
  queryEdgesFrom: vi.fn(),
  escapeSqlLiteral: vi.fn((v: string) => v.replace(/'/g, "''")),
}));

import {
  searchChunks,
  deduplicateChunks,
  classifyRetrievalMode,
  RETRIEVAL_STRATEGIES,
  filterDedupedForNonTestChunks,
  querySignalsTestIntent,
  expandByEdges,
} from '../../src/services/retriever.js';
import { queryEdgesFrom } from '../../src/services/lancedb.js';
import type { RetrievedChunk } from '../../src/lib/types.js';

const mockQueryEdgesFrom = vi.mocked(queryEdgesFrom);

// Helper to create a mock LanceDB table
function makeMockTable(rows: Record<string, unknown>[]) {
  const toArray = vi.fn().mockResolvedValue(rows);
  const limit = vi.fn().mockReturnValue({ toArray });
  const distanceType = vi.fn().mockReturnValue({ limit });
  const nearestTo = vi.fn().mockReturnValue({ distanceType });
  const query = vi.fn().mockReturnValue({ nearestTo });
  return { query } as unknown as import('@lancedb/lancedb').Table;
}

function makeRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 'chunk-1',
    file_path: 'src/foo.ts',
    chunk_type: 'function',
    scope: null,
    name: 'myFunc',
    content: 'function myFunc() {}',
    start_line: 1,
    end_line: 5,
    file_type: 'source',
    source_kind: 'file',
    _distance: 0.2,
    ...overrides,
  };
}

describe('searchChunks', () => {
  it('converts _distance to similarity (1 - _distance)', async () => {
    const row = makeRow({ _distance: 0.2 });
    const table = makeMockTable([row]);
    const results = await searchChunks(table, [0.1, 0.2], { limit: 10, distanceThreshold: 0.3 });

    expect(results).toHaveLength(1);
    expect(results[0].similarity).toBe(0.8);
  });

  it('filters rows with _distance above distanceThreshold', async () => {
    const rowClose = makeRow({ id: 'close', _distance: 0.2 });
    const rowFar = makeRow({ id: 'far', _distance: 0.5 });
    const table = makeMockTable([rowClose, rowFar]);

    const results = await searchChunks(table, [0.1, 0.2], { limit: 10, distanceThreshold: 0.3 });

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('close');
  });

  it('sorts results by similarity descending', async () => {
    const rowA = makeRow({ id: 'a', _distance: 0.3 });
    const rowB = makeRow({ id: 'b', _distance: 0.1 });
    const rowC = makeRow({ id: 'c', _distance: 0.2 });
    const table = makeMockTable([rowA, rowB, rowC]);

    const results = await searchChunks(table, [0.1], { limit: 10, distanceThreshold: 0.4 });

    expect(results.map((r) => r.id)).toEqual(['b', 'c', 'a']);
  });

  it('converts snake_case LanceDB fields to camelCase RetrievedChunk', async () => {
    const row = makeRow({
      id: 'chunk-abc',
      file_path: 'src/bar.ts',
      chunk_type: 'class',
      scope: 'MyClass',
      name: 'MyClass',
      content: 'class MyClass {}',
      start_line: 10,
      end_line: 20,
      _distance: 0.15,
    });
    const table = makeMockTable([row]);

    const results = await searchChunks(table, [0.1], { limit: 10, distanceThreshold: 0.3 });

    expect(results[0]).toMatchObject({
      id: 'chunk-abc',
      filePath: 'src/bar.ts',
      chunkType: 'class',
      sourceKind: 'file',
      scope: 'MyClass',
      name: 'MyClass',
      content: 'class MyClass {}',
      startLine: 10,
      endLine: 20,
      similarity: 0.85,
    });
  });

  it('maps file_type from RawChunkRow to fileType on RetrievedChunk', async () => {
    const sourceRow = makeRow({ id: 'source-chunk', file_path: 'src/services/foo.ts', file_type: 'source', _distance: 0.1 });
    const testRow = makeRow({ id: 'test-chunk', file_path: 'tests/foo.test.ts', file_type: 'test', _distance: 0.15 });
    const table = makeMockTable([sourceRow, testRow]);

    const results = await searchChunks(table, [0.1], { limit: 10, distanceThreshold: 0.3 });

    expect(results).toHaveLength(2);
    const sourceResult = results.find(r => r.id === 'source-chunk');
    const testResult = results.find(r => r.id === 'test-chunk');
    expect(sourceResult?.fileType).toBe('source');
    expect(testResult?.fileType).toBe('test');
  });

  it('filters out rows where vector is all zeros (zero-vector belt-and-suspenders)', async () => {
    const zeroVectorRow = makeRow({
      id: 'zero-vec',
      _distance: 0.1,
      vector: new Array(768).fill(0),
    });
    const normalRow = makeRow({
      id: 'normal',
      _distance: 0.2,
      vector: [0.1, 0.2, 0.3],
    });
    const table = makeMockTable([zeroVectorRow, normalRow]);

    const results = await searchChunks(table, [0.1, 0.2], { limit: 10, distanceThreshold: 0.5 });

    // zero-vector row should be excluded
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('normal');
  });

  it('passes through rows with non-zero vectors unchanged', async () => {
    const normalRow = makeRow({
      id: 'normal',
      _distance: 0.1,
      vector: [0.1, 0.0, 0.3],
    });
    const table = makeMockTable([normalRow]);

    const results = await searchChunks(table, [0.1, 0.2], { limit: 10, distanceThreshold: 0.5 });

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('normal');
  });

  it('returns empty array when all rows are above distanceThreshold', async () => {
    const row = makeRow({ _distance: 0.9 });
    const table = makeMockTable([row]);

    const results = await searchChunks(table, [0.1], { limit: 10, distanceThreshold: 0.3 });

    expect(results).toHaveLength(0);
  });

  it('returns empty array when table returns no rows', async () => {
    const table = makeMockTable([]);

    const results = await searchChunks(table, [0.1], { limit: 10, distanceThreshold: 0.3 });

    expect(results).toHaveLength(0);
  });

  describe('config file noise penalty', () => {
    it('penalizes config files for generic queries', async () => {
      const configRow = makeRow({ id: 'config', file_path: 'vitest.config.ts', _distance: 0.20 });
      const appRow = makeRow({ id: 'app', file_path: 'src/services/configLoader.ts', _distance: 0.25 });
      const table = makeMockTable([configRow, appRow]);

      const results = await searchChunks(table, [0.1], { limit: 10, distanceThreshold: 0.4 }, 'config values');

      // app code ranks first despite higher distance because vitest.config.ts receives noise penalty
      expect(results[0].id).toBe('app');
    });

    it('does not penalize config files when query names the tool', async () => {
      const tsupRow = makeRow({ id: 'tsup-config', file_path: 'tsup.config.ts', _distance: 0.20 });
      const buildRow = makeRow({ id: 'build', file_path: 'src/build.ts', _distance: 0.25 });
      const table = makeMockTable([tsupRow, buildRow]);

      const results = await searchChunks(table, [0.1], { limit: 10, distanceThreshold: 0.4 }, 'how does tsup build the project');

      // tsup.config.ts ranks first because query contains "tsup" — penalty is bypassed
      expect(results[0].id).toBe('tsup-config');
    });

    it('does not penalize non-config files with config in the name', async () => {
      const appRow = makeRow({ id: 'app-config', file_path: 'src/lib/config.ts', _distance: 0.20 });
      const table = makeMockTable([appRow]);

      const results = await searchChunks(table, [0.1], { limit: 10, distanceThreshold: 0.4 }, 'config values');

      // src/lib/config.ts is not a build tool config file — no penalty
      expect(results[0].id).toBe('app-config');
      expect(results).toHaveLength(1);
    });

    it('penalized config files are still returned, not excluded', async () => {
      const vitestRow = makeRow({ id: 'vitest-cfg', file_path: 'vitest.config.ts', _distance: 0.20 });
      const table = makeMockTable([vitestRow]);

      const results = await searchChunks(table, [0.1], { limit: 10, distanceThreshold: 0.4 }, 'config values');

      // Penalty is a score subtraction, not a hard filter — file still appears
      expect(results).toHaveLength(1);
    });
  });

  describe('test file noise penalty', () => {
    it('penalizes test file chunks for generic queries', async () => {
      const implRow = makeRow({ id: 'impl', file_path: 'src/services/chunker.ts', _distance: 0.25 });
      const testRow = makeRow({ id: 'test', file_path: 'tests/services/chunker.test.ts', _distance: 0.20 });
      const table = makeMockTable([testRow, implRow]); // test has better raw distance

      const results = await searchChunks(table, [0.1], { limit: 10, distanceThreshold: 0.4 }, 'how does chunkFile work');

      // impl ranks first because test file is penalized
      expect(results[0].id).toBe('impl');
    });

    it('does not penalize test file chunks for test-intent queries', async () => {
      const implRow = makeRow({ id: 'impl', file_path: 'src/services/chunker.ts', _distance: 0.25 });
      const testRow = makeRow({ id: 'test', file_path: 'tests/services/chunker.test.ts', _distance: 0.20 });
      const table = makeMockTable([testRow, implRow]);

      const results = await searchChunks(table, [0.1], { limit: 10, distanceThreshold: 0.4 }, 'how is chunkFile tested');

      // test file keeps its raw advantage — "tested" bypasses penalty
      expect(results[0].id).toBe('test');
    });

    it('bypasses penalty when query contains spec keyword', async () => {
      const specRow = makeRow({ id: 'spec', file_path: 'src/services/chunker.spec.ts', _distance: 0.20 });
      const implRow = makeRow({ id: 'impl', file_path: 'src/services/chunker.ts', _distance: 0.25 });
      const table = makeMockTable([specRow, implRow]);

      const results = await searchChunks(table, [0.1], { limit: 10, distanceThreshold: 0.4 }, 'spec for chunker');

      // "spec" bypasses penalty
      expect(results[0].id).toBe('spec');
    });

    it('config file and test file penalties apply independently', async () => {
      const configRow = makeRow({ id: 'cfg', file_path: 'vitest.config.ts', _distance: 0.20 });
      const testRow = makeRow({ id: 'test', file_path: 'tests/chunker.test.ts', _distance: 0.22 });
      const implRow = makeRow({ id: 'impl', file_path: 'src/chunker.ts', _distance: 0.28 });
      const table = makeMockTable([configRow, testRow, implRow]);

      const results = await searchChunks(table, [0.1], { limit: 10, distanceThreshold: 0.4 }, 'how does chunking work');

      // impl first, both config and test penalized
      expect(results[0].id).toBe('impl');
    });

    it('does not penalize files with test in directory name but not test file extension', async () => {
      const contestRow = makeRow({ id: 'contest', file_path: 'src/contest/solution.ts', _distance: 0.20 });
      const implRow = makeRow({ id: 'impl', file_path: 'src/services/solver.ts', _distance: 0.25 });
      const table = makeMockTable([contestRow, implRow]);

      const results = await searchChunks(table, [0.1], { limit: 10, distanceThreshold: 0.4 }, 'contest solution');

      // not penalized, keeps raw advantage
      expect(results[0].id).toBe('contest');
    });

    it('penalizes __tests__ directory files for generic queries', async () => {
      const testsRow = makeRow({ id: 'testdir', file_path: 'src/__tests__/chunker.ts', _distance: 0.20 });
      const implRow = makeRow({ id: 'impl', file_path: 'src/services/chunker.ts', _distance: 0.25 });
      const table = makeMockTable([testsRow, implRow]);

      const results = await searchChunks(table, [0.1], { limit: 10, distanceThreshold: 0.4 }, 'how does chunker work');

      // __tests__ file penalized
      expect(results[0].id).toBe('impl');
    });
  });

  describe('history chunk penalty', () => {
    it('applies a small score penalty so source beats equal-similarity history', async () => {
      const sourceRow = makeRow({
        id: 'source',
        file_path: 'src/workflows/index.ts',
        source_kind: 'file',
        _distance: 0.2,
      });
      const historyRow = makeRow({
        id: 'history',
        file_path: '',
        chunk_type: 'commit',
        source_kind: 'history',
        _distance: 0.2,
      });
      const table = makeMockTable([historyRow, sourceRow]);

      const results = await searchChunks(
        table,
        [0.1],
        { limit: 10, distanceThreshold: 0.4, keywordBoostWeight: 0.1 },
        'why did indexing change',
      );

      expect(results[0].id).toBe('source');
      const history = results.find((chunk) => chunk.id === 'history');
      expect(history?.sourceKind).toBe('history');
    });
  });
});

describe('deduplicateChunks', () => {
  it('removes duplicate chunks by id, preserving first occurrence', () => {
    const chunks: RetrievedChunk[] = [
      { id: 'a', filePath: 'f1', chunkType: 'function', sourceKind: 'file', scope: null, name: 'a', content: '', startLine: 1, endLine: 5, fileType: 'source', similarity: 0.9 },
      { id: 'b', filePath: 'f2', chunkType: 'function', sourceKind: 'file', scope: null, name: 'b', content: '', startLine: 1, endLine: 5, fileType: 'source', similarity: 0.8 },
      { id: 'a', filePath: 'f1', chunkType: 'function', sourceKind: 'file', scope: null, name: 'a', content: '', startLine: 1, endLine: 5, fileType: 'source', similarity: 0.7 },
    ];

    const result = deduplicateChunks(chunks);

    expect(result).toHaveLength(2);
    expect(result.map((c) => c.id)).toEqual(['a', 'b']);
    // First occurrence of 'a' has similarity 0.9
    expect(result[0].similarity).toBe(0.9);
  });

  it('returns empty array for empty input', () => {
    expect(deduplicateChunks([])).toEqual([]);
  });

  it('preserves original order (not sorted)', () => {
    const chunks: RetrievedChunk[] = [
      { id: 'z', filePath: 'f', chunkType: 'function', sourceKind: 'file', scope: null, name: 'z', content: '', startLine: 1, endLine: 5, fileType: 'source', similarity: 0.5 },
      { id: 'a', filePath: 'f', chunkType: 'function', sourceKind: 'file', scope: null, name: 'a', content: '', startLine: 1, endLine: 5, fileType: 'source', similarity: 0.9 },
    ];

    const result = deduplicateChunks(chunks);

    expect(result.map((c) => c.id)).toEqual(['z', 'a']);
  });
});

describe('classifyRetrievalMode', () => {
  // --- lookup mode ---
  it('returns "lookup" for "find the definition of foo"', () => {
    expect(classifyRetrievalMode('find the definition of foo')).toBe('lookup');
  });

  it('returns "lookup" for "where is the auth handler"', () => {
    expect(classifyRetrievalMode('where is the auth handler')).toBe('lookup');
  });

  it('returns "lookup" for "signature of classifyQueryIntent"', () => {
    expect(classifyRetrievalMode('signature of classifyQueryIntent')).toBe('lookup');
  });

  // Bigram-based lookup (formerly diagnostic bigrams)
  it('returns "lookup" for bigram "stack trace"', () => {
    expect(classifyRetrievalMode('I got a stack trace')).toBe('lookup');
  });

  it('returns "lookup" for bigram "null pointer"', () => {
    expect(classifyRetrievalMode('null pointer in the loop')).toBe('lookup');
  });

  it('returns "lookup" for bigram "type error"', () => {
    expect(classifyRetrievalMode('it throws a type error')).toBe('lookup');
  });

  it('returns "lookup" for bigram "not working"', () => {
    expect(classifyRetrievalMode('the feature is not working')).toBe('lookup');
  });

  // --- trace mode ---
  it('returns "trace" for "trace the call path from CLI to LanceDB"', () => {
    expect(classifyRetrievalMode('trace the call path from CLI to LanceDB')).toBe('trace');
  });

  it('returns "trace" for "how does indexing flow from CLI to storage"', () => {
    expect(classifyRetrievalMode('how does indexing flow from CLI to storage')).toBe('trace');
  });

  it('returns "trace" for "trace flow of build_context"', () => {
    expect(classifyRetrievalMode('trace flow of build_context')).toBe('trace');
  });

  // --- explore mode ---
  it('returns "explore" for "explain the architecture"', () => {
    expect(classifyRetrievalMode('explain the architecture')).toBe('explore');
  });

  it('returns "explore" for "how does auth work"', () => {
    expect(classifyRetrievalMode('how does auth work')).toBe('explore');
  });

  it('returns "explore" for "walk me through the retrieval pipeline"', () => {
    expect(classifyRetrievalMode('walk me through the retrieval pipeline')).toBe('explore');
  });

  // Exclusion tests — lookup keyword present but exclusion pattern overrides to explore
  it('returns "explore" for "how does the error handler work" (exclusion)', () => {
    expect(classifyRetrievalMode('how does the error handler work')).toBe('explore');
  });

  it('returns "explore" for "explain the null object pattern" (exclusion)', () => {
    expect(classifyRetrievalMode('explain the null object pattern')).toBe('explore');
  });

  // Ambiguity test: "trace the" prefix but architecture context → explore wins
  it('returns "explore" for "trace the architecture of this repo" (ambiguity)', () => {
    expect(classifyRetrievalMode('trace the architecture of this repo')).toBe('explore');
  });
});

describe('RETRIEVAL_STRATEGIES', () => {
  it('lookup strategy has limit=5 and distanceThreshold=0.4', () => {
    expect(RETRIEVAL_STRATEGIES['lookup']).toMatchObject({
      limit: 5,
      distanceThreshold: 0.4,
    });
  });

  it('trace strategy has limit=3 and distanceThreshold=0.5', () => {
    expect(RETRIEVAL_STRATEGIES['trace']).toMatchObject({
      limit: 3,
      distanceThreshold: 0.5,
    });
  });

  it('explore strategy has limit=20 and distanceThreshold=0.6', () => {
    expect(RETRIEVAL_STRATEGIES['explore']).toMatchObject({
      limit: 20,
      distanceThreshold: 0.6,
    });
  });
});

describe('per-mode keyword boost weight (RET-01)', () => {
  it('RETRIEVAL_STRATEGIES.lookup has keywordBoostWeight === 0.40', () => {
    expect(RETRIEVAL_STRATEGIES['lookup'].keywordBoostWeight).toBe(0.40);
  });

  it('RETRIEVAL_STRATEGIES.trace has keywordBoostWeight === 0.20', () => {
    expect(RETRIEVAL_STRATEGIES['trace'].keywordBoostWeight).toBe(0.20);
  });

  it('RETRIEVAL_STRATEGIES.explore has keywordBoostWeight === 0.10', () => {
    expect(RETRIEVAL_STRATEGIES['explore'].keywordBoostWeight).toBe(0.10);
  });

  it('searchChunks applies 0.40 boost weight and promotes similarity for name-matched chunk (lookup)', async () => {
    // buildContext.ts matches the filename 'buildContext' in the query
    const row = makeRow({
      id: 'ctx-chunk',
      file_path: 'src/workflows/buildContext.ts',
      name: 'runBuildContext',
      _distance: 0.4, // raw similarity = 0.60
    });
    const table = makeMockTable([row]);

    const results = await searchChunks(
      table,
      [0.1, 0.2],
      { limit: 10, distanceThreshold: 0.4, keywordBoostWeight: 0.40 },
      'buildContext'
    );

    expect(results).toHaveLength(1);
    // RET-02: name-matched chunk similarity should be promoted to >= 0.85
    expect(results[0].similarity).toBeGreaterThanOrEqual(0.85);
  });

  it('searchChunks with 0.10 boost and non-matching filename keeps original similarity', async () => {
    const row = makeRow({
      id: 'no-match',
      file_path: 'src/foo/bar.ts',
      name: 'someFunc',
      _distance: 0.4, // raw similarity = 0.60
    });
    const table = makeMockTable([row]);

    const results = await searchChunks(
      table,
      [0.1, 0.2],
      { limit: 10, distanceThreshold: 0.4, keywordBoostWeight: 0.10 },
      'buildContext'
    );

    expect(results).toHaveLength(1);
    // No name match — similarity stays at raw value (0.60)
    expect(results[0].similarity).toBeCloseTo(0.60, 5);
  });
});

describe('similarity promotion (RET-02)', () => {
  it('name-matched chunk (query="compression") with raw similarity 0.60 gets promoted to >= 0.85', async () => {
    const row = makeRow({
      id: 'comp-chunk',
      file_path: 'src/services/compression.ts',
      name: 'compressChunk',
      _distance: 0.4, // raw similarity = 0.60
    });
    const table = makeMockTable([row]);

    const results = await searchChunks(
      table,
      [0.1],
      { limit: 10, distanceThreshold: 0.5 },
      'compression'
    );

    expect(results).toHaveLength(1);
    expect(results[0].similarity).toBeGreaterThanOrEqual(0.85);
  });

  it('non-name-matched chunk keeps its original similarity', async () => {
    const row = makeRow({
      id: 'unrelated',
      file_path: 'src/services/retriever.ts',
      name: 'searchChunks',
      _distance: 0.4, // raw similarity = 0.60
    });
    const table = makeMockTable([row]);

    const results = await searchChunks(
      table,
      [0.1],
      { limit: 10, distanceThreshold: 0.5 },
      'compression'
    );

    expect(results).toHaveLength(1);
    // 'compression' does not match 'retriever.ts' or 'searchChunks' — no promotion
    expect(results[0].similarity).toBeCloseTo(0.60, 5);
  });
});

describe('PREC-01 / PREC-02: tiered keyword boost', () => {
  // Test A: Exact symbol name match must rank above semantically adjacent symbol with much higher vector similarity.
  // The gap is designed so that the old partial-match boost (returns 0.5 for "compresschunk" in 2-token query)
  // cannot overcome a 0.25 similarity gap — but Tier 1 (returns 1.0 for exact name) can.
  //   Old exactMatch score:    0.45 * 0.60 + 0.5 * 0.40 = 0.27 + 0.20 = 0.47
  //   Old adjacentMatch score: 0.80 * 0.60 + 0.0 * 0.40 = 0.48
  //   Old result: adjacentMatch wins (0.48 > 0.47) — FAIL
  //   New Tier-1 exactMatch score: 0.45 * 0.60 + 1.0 * 0.40 = 0.27 + 0.40 = 0.67 — PASS
  it('exact symbol name match ranks above semantically adjacent symbol (PREC-01)', async () => {
    const exactMatch = makeRow({ id: 'exact', file_path: 'src/services/compression.ts', name: 'compressChunk', _distance: 0.55 });
    const adjacentMatch = makeRow({ id: 'adjacent', file_path: 'src/services/retriever.ts', name: 'searchChunks', _distance: 0.20 });
    const table = makeMockTable([exactMatch, adjacentMatch]);

    const results = await searchChunks(
      table,
      [0.1],
      { limit: 10, distanceThreshold: 0.6, keywordBoostWeight: 0.40 },
      'compressChunk function'
    );

    // compressChunk must rank first despite much lower raw similarity (0.45 vs 0.80)
    expect(results[0].id).toBe('exact');
  });

  // Test B: camelCase sub-token match — "searchChunks" decomposed to ["search", "chunks"],
  // both appear in query "search chunks function".
  // Old behavior: target "retriever.ts searchchunks" includes "search" and "chunks" — also partial match!
  // Gap: set noMatch similarity high enough that old fallback can't overcome it.
  //   Old camelMatch (d=0.45 → sim=0.55): "search" in "searchchunks" and "chunks" in "searchchunks" → 2/3 = 0.667 boost
  //     score = 0.55 * 0.60 + 0.667 * 0.40 = 0.33 + 0.267 = 0.597
  //   Old noMatch (d=0.18 → sim=0.82): "format" NOT in "formatchunk"? wait — "formatChunk" target = "formatter.ts formatchunk"
  //     "search" not in target, "chunks" not in target, "function" not in target → 0 boost
  //     score = 0.82 * 0.60 = 0.492
  //   Actually old impl passes too! We need noMatch to have a name that accidentally matches tokens.
  // Solution: use a noMatch whose name and file have no overlap with query at all, but a VERY high similarity.
  //   Old camelMatch score: 0.597; Old noMatch score (d=0.10→sim=0.90): 0.90*0.60=0.54 — noMatch wins!
  //   New Tier-2: all sub-tokens ["search","chunks"] in query → return 1.0
  //     camelMatch score: 0.55 * 0.60 + 1.0 * 0.40 = 0.33 + 0.40 = 0.73 > 0.54 — PASS
  it('camelCase sub-token match boosts matching chunk (PREC-01)', async () => {
    const camelMatch = makeRow({ id: 'camel', file_path: 'src/services/retriever.ts', name: 'searchChunks', _distance: 0.45 });
    const noMatch = makeRow({ id: 'nomatch', file_path: 'src/services/emitter.ts', name: 'emitEvent', _distance: 0.10 });
    const table = makeMockTable([camelMatch, noMatch]);

    const results = await searchChunks(
      table,
      [0.1],
      { limit: 10, distanceThreshold: 0.5, keywordBoostWeight: 0.40 },
      'search chunks function'
    );

    // searchChunks must rank first via camelCase sub-token decomposition
    expect(results[0].id).toBe('camel');
  });

  // Test C: Filename stem match (PREC-02).
  // Query "compression service" → tokens: ["compression", "service"]
  // fileMatch (compression.ts): old behavior — "compression" appears in "compression.ts" target → 1/2 = 0.5 boost
  //   But with large similarity gap, old boost may not suffice.
  //   fileMatch score (d=0.45→sim=0.55): 0.55*0.60 + 0.5*0.40 = 0.33+0.20 = 0.53
  //   otherFile (d=0.15→sim=0.85): 0 matches → score = 0.85*0.60 = 0.51 — fileMatch wins by old impl (0.53 > 0.51)!
  // Increase gap further: otherFile d=0.10 → sim=0.90 → score=0.54 — old impl fails (0.54 > 0.53)!
  // New Tier-3: "compression" === fileNameStem → return 0.8
  //   fileMatch score: 0.55*0.60 + 0.8*0.40 = 0.33 + 0.32 = 0.65 > 0.54 — PASS
  it('filename stem match boosts file-matching chunks (PREC-02)', async () => {
    const fileMatch = makeRow({ id: 'filematch', file_path: 'src/services/compression.ts', name: 'compressChunk', _distance: 0.45 });
    const otherFile = makeRow({ id: 'other', file_path: 'src/services/retriever.ts', name: 'searchChunks', _distance: 0.10 });
    const table = makeMockTable([fileMatch, otherFile]);

    const results = await searchChunks(
      table,
      [0.1],
      { limit: 10, distanceThreshold: 0.5, keywordBoostWeight: 0.40 },
      'compression service'
    );

    // compression.ts chunk must rank first because "compression" === filename stem
    expect(results[0].id).toBe('filematch');
  });

  // Test D: Filename stem "chunker" — exact stem match.
  // Query "chunker implementation" → tokens: ["chunker", "implementation"]
  // Old: "chunker" in "chunker.ts chunkfile" → yes, 1/2 = 0.5. But with large gap it fails.
  //   stemMatch (d=0.45→sim=0.55): 0.55*0.60+0.5*0.40=0.53; otherStem (d=0.08→sim=0.92): 0.92*0.60=0.552 — otherStem wins!
  // New Tier-3: "chunker" === fileNameStem → 0.8
  //   stemMatch score: 0.55*0.60+0.8*0.40=0.33+0.32=0.65 > 0.552 — PASS
  it('filePath stem token boosts matching file (PREC-02)', async () => {
    const stemMatch = makeRow({ id: 'stem', file_path: 'src/services/chunker.ts', name: 'chunkFile', _distance: 0.45 });
    const otherStem = makeRow({ id: 'otherstem', file_path: 'src/services/retriever.ts', name: 'searchChunks', _distance: 0.08 });
    const table = makeMockTable([stemMatch, otherStem]);

    const results = await searchChunks(
      table,
      [0.1],
      { limit: 10, distanceThreshold: 0.5, keywordBoostWeight: 0.40 },
      'chunker implementation'
    );

    // chunker.ts chunk must rank first because "chunker" exactly equals the filename stem
    expect(results[0].id).toBe('stem');
  });

  it('no name or file match preserves similarity-based ranking (fallback)', async () => {
    // logger.ts / initLogger: no match for "how does logging work", raw similarity 0.85 (higher)
    // config.ts / loadConfig: no match, raw similarity 0.70 (lower)
    const highSim = makeRow({ id: 'high', file_path: 'src/services/logger.ts', name: 'initLogger', _distance: 0.15 });
    const lowSim = makeRow({ id: 'low', file_path: 'src/services/config.ts', name: 'loadConfig', _distance: 0.30 });
    const table = makeMockTable([highSim, lowSim]);

    const results = await searchChunks(
      table,
      [0.1],
      { limit: 10, distanceThreshold: 0.5, keywordBoostWeight: 0.40 },
      'how does logging work'
    );

    // Higher raw similarity wins when no name or file boost applies
    expect(results[0].id).toBe('high');
  });
});

describe('querySignalsTestIntent', () => {
  it('detects test-focused queries', () => {
    expect(querySignalsTestIntent('how to test the parser')).toBe(true);
    expect(querySignalsTestIntent('jest setup')).toBe(true);
  });

  it('returns false for generic behaviour questions', () => {
    expect(querySignalsTestIntent('how does authentication work')).toBe(false);
  });
});

describe('filterDedupedForNonTestChunks', () => {
  const src = (id: string, path: string): RetrievedChunk => ({
    id,
    filePath: path,
    chunkType: 'function',
    sourceKind: 'file',
    scope: null,
    name: 'f',
    content: 'x',
    startLine: 1,
    endLine: 2,
    fileType: 'source',
    similarity: 0.9,
  });

  it('removes test chunks when enough source chunks remain', () => {
    const chunks = [
      src('1', 'src/a.ts'),
      src('2', 'src/a.spec.ts'),
      src('3', 'src/b.ts'),
      src('4', 'src/c.ts'),
    ];
    const out = filterDedupedForNonTestChunks(chunks, 'how does it work');
    expect(out.map((c) => c.filePath)).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts']);
  });

  it('keeps all chunks when query signals test intent', () => {
    const chunks = [src('1', 'src/a.ts'), src('2', 'src/a.spec.ts')];
    const out = filterDedupedForNonTestChunks(chunks, 'jest unit test');
    expect(out).toHaveLength(2);
  });
});

describe('expandByEdges', () => {
  /** Helper: builds a mock Table that returns `chunkRows` from .query().where().limit().toArray() */
  function makeEdgesChunksTable(chunkRows: Record<string, unknown>[]): import('@lancedb/lancedb').Table {
    const toArray = vi.fn().mockResolvedValue(chunkRows);
    const limit = vi.fn().mockReturnValue({ toArray });
    const where = vi.fn().mockReturnValue({ limit });
    const query = vi.fn().mockReturnValue({ where });
    return { query } as unknown as import('@lancedb/lancedb').Table;
  }

  /** A minimal seed chunk. */
  function makeSeedChunk(id: string): RetrievedChunk {
    return {
      id,
      filePath: 'src/seed.ts',
      chunkType: 'function',
      sourceKind: 'file',
      scope: null,
      name: 'seedFn',
      content: 'function seedFn() {}',
      startLine: 1,
      endLine: 5,
      fileType: 'source',
      similarity: 0.9,
    };
  }

  /** A minimal EdgeRow for a call edge. */
  function makeEdge(overrides: Partial<{
    from_chunk_id: string;
    to_symbol: string;
    to_file: string | null;
    edge_type: 'call' | 'import';
  }> = {}): Record<string, unknown> {
    return {
      from_chunk_id: 'seed-1',
      from_file: 'src/seed.ts',
      from_symbol: 'seedFn',
      to_symbol: 'targetFn',
      to_file: 'src/target.ts',
      edge_type: 'call',
      ...overrides,
    };
  }

  /** A minimal chunk row as returned by LanceDB. */
  function makeChunkRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
    return {
      id: 'target-1',
      file_path: 'src/target.ts',
      chunk_type: 'function',
      scope: null,
      name: 'targetFn',
      content: 'function targetFn() {}',
      start_line: 10,
      end_line: 20,
      file_type: 'source',
      source_kind: 'file',
      ...overrides,
    };
  }

  beforeEach(() => {
    mockQueryEdgesFrom.mockReset();
  });

  it('returns empty array when seedChunks is empty', async () => {
    const chunksTable = makeEdgesChunksTable([]);
    const edgesTable = makeEdgesChunksTable([]);
    mockQueryEdgesFrom.mockResolvedValue([]);

    const result = await expandByEdges(chunksTable, edgesTable, []);
    expect(result).toEqual([]);
  });

  it('returns empty array when maxHops is 0', async () => {
    const seed = makeSeedChunk('seed-1');
    const chunksTable = makeEdgesChunksTable([]);
    const edgesTable = makeEdgesChunksTable([]);
    mockQueryEdgesFrom.mockResolvedValue([]);

    const result = await expandByEdges(chunksTable, edgesTable, [seed], 0);
    expect(result).toEqual([]);
  });

  it('follows call edges and returns callee chunks', async () => {
    const seed = makeSeedChunk('seed-1');
    const chunkRow = makeChunkRow();
    const chunksTable = makeEdgesChunksTable([chunkRow]);
    const edgesTable = makeEdgesChunksTable([]);

    mockQueryEdgesFrom.mockResolvedValue([makeEdge() as any]);

    const result = await expandByEdges(chunksTable, edgesTable, [seed]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('target-1');
    expect(result[0].filePath).toBe('src/target.ts');
    expect(result[0].name).toBe('targetFn');
    expect(result[0].similarity).toBe(0.5);
  });

  it('skips edges where to_file is null (external calls)', async () => {
    const seed = makeSeedChunk('seed-1');
    const chunksTable = makeEdgesChunksTable([]);
    const edgesTable = makeEdgesChunksTable([]);

    mockQueryEdgesFrom.mockResolvedValue([makeEdge({ to_file: null }) as any]);

    const result = await expandByEdges(chunksTable, edgesTable, [seed]);
    expect(result).toEqual([]);
  });

  it('skips import edges (only follows call edges)', async () => {
    const seed = makeSeedChunk('seed-1');
    const chunksTable = makeEdgesChunksTable([]);
    const edgesTable = makeEdgesChunksTable([]);

    mockQueryEdgesFrom.mockResolvedValue([makeEdge({ edge_type: 'import' }) as any]);

    const result = await expandByEdges(chunksTable, edgesTable, [seed]);
    expect(result).toEqual([]);
  });

  it('deduplicates — does not return chunks already in seedChunks by id', async () => {
    const seed = makeSeedChunk('seed-1');
    // The callee chunk has the same id as the seed
    const dupChunkRow = makeChunkRow({ id: 'seed-1' });
    const chunksTable = makeEdgesChunksTable([dupChunkRow]);
    const edgesTable = makeEdgesChunksTable([]);

    mockQueryEdgesFrom.mockResolvedValue([makeEdge({ to_symbol: 'seedFn' }) as any]);

    const result = await expandByEdges(chunksTable, edgesTable, [seed]);
    expect(result).toEqual([]);
  });

  it('deduplicates within expanded results — same callee from multiple seeds returned once', async () => {
    const seed1 = makeSeedChunk('seed-1');
    const seed2 = makeSeedChunk('seed-2');
    const chunkRow = makeChunkRow(); // id = 'target-1'
    const chunksTable = makeEdgesChunksTable([chunkRow]);
    const edgesTable = makeEdgesChunksTable([]);

    // Both seeds point to same callee
    mockQueryEdgesFrom.mockResolvedValue([makeEdge() as any]);

    const result = await expandByEdges(chunksTable, edgesTable, [seed1, seed2]);
    // target-1 should appear only once even though two seeds point to it
    expect(result.filter((c) => c.id === 'target-1')).toHaveLength(1);
  });

  it('caps at MAX_EDGES_PER_CHUNK (5) edges followed per seed', async () => {
    const seed = makeSeedChunk('seed-1');
    // 8 call edges from the seed, each pointing to a different chunk
    const manyEdges = Array.from({ length: 8 }, (_, i) =>
      makeEdge({ to_symbol: `fn${i}`, to_file: `src/target${i}.ts` })
    );
    // The chunks table returns a unique row for each target
    const chunksTableRows = Array.from({ length: 8 }, (_, i) =>
      makeChunkRow({ id: `target-${i}`, file_path: `src/target${i}.ts`, name: `fn${i}` })
    );

    // Mock: query().where().limit(1).toArray() returns one row per call
    let callIndex = 0;
    const toArray = vi.fn().mockImplementation(() => {
      const row = chunksTableRows[callIndex++];
      return Promise.resolve(row ? [row] : []);
    });
    const limit = vi.fn().mockReturnValue({ toArray });
    const where = vi.fn().mockReturnValue({ limit });
    const query = vi.fn().mockReturnValue({ where });
    const chunksTable = { query } as unknown as import('@lancedb/lancedb').Table;
    const dummyEdgesTable = makeEdgesChunksTable([]);

    mockQueryEdgesFrom.mockResolvedValue(manyEdges as any);

    const result = await expandByEdges(chunksTable, dummyEdgesTable, [seed]);
    // Should only have followed 5 edges (MAX_EDGES_PER_CHUNK)
    expect(result.length).toBeLessThanOrEqual(5);
  });

  it('sets similarity to 0.5 for all expanded chunks', async () => {
    const seed = makeSeedChunk('seed-1');
    const chunkRow = makeChunkRow();
    const chunksTable = makeEdgesChunksTable([chunkRow]);
    const edgesTable = makeEdgesChunksTable([]);

    mockQueryEdgesFrom.mockResolvedValue([makeEdge() as any]);

    const result = await expandByEdges(chunksTable, edgesTable, [seed]);
    expect(result.every((c) => c.similarity === 0.5)).toBe(true);
  });
});
