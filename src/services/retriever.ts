import type { Table } from '@lancedb/lancedb';
import { childLogger } from './logger.js';
import { queryEdgesFrom, escapeSqlLiteral } from './lancedb.js';
import type { EdgeRow } from './lancedb.js';
import type { RetrievedChunk, SearchOptions, QueryIntent } from '../lib/types.js';
import { HIGH_RELEVANCE_SIMILARITY_THRESHOLD } from '../lib/config.js';

const log = childLogger('retriever');

const MAX_EDGES_PER_CHUNK = 5;

/** Shape of a raw row returned by LanceDB vector search. */
interface RawChunkRow {
  id: string;
  file_path: string;
  chunk_type: string;
  scope: string | null;
  name: string | null;
  content: string;
  start_line: number;
  end_line: number;
  file_type: string;
  source_kind?: string;
  _distance: number;
}

/** LanceDB may return `vector` as a plain array, TypedArray, or Arrow-backed value without `.every`. */
function isStoredVectorAllZero(vec: unknown): boolean {
  if (vec == null) return false;
  if (Array.isArray(vec)) {
    return vec.every((v) => v === 0);
  }
  const arr = Array.from(vec as ArrayLike<number>);
  return arr.every((v) => v === 0);
}

// Multi-word phrase patterns for trace mode — explicit call-path / flow queries
const TRACE_KEYWORDS = [
  'trace the', 'trace flow', 'call path', 'flow of', 'follows from',
  'calls into', 'invokes', 'trace from',
];

// Regex pattern for 'how does.*flow' (multi-word, can span words)
const TRACE_REGEX = /how does\b.*\bflow\b/i;

// High-confidence lookup signals (formerly DIAGNOSTIC_BIGRAMS)
const LOOKUP_BIGRAMS = [
  'stack trace', 'null pointer', 'not defined',
  'type error', 'reference error', 'syntax error',
  'runtime error', 'segmentation fault',
  'not working', 'throws exception',
];

// Single-keyword lookup signals
const LOOKUP_KEYWORDS = [
  'where is', 'find the', 'definition of', 'signature of',
  'show me the', 'what does', 'what is the type',
];

// Exclusion patterns: when a lookup keyword matches but one of these also matches,
// the query is actually an explore query
const EXPLORE_EXCLUSIONS = [
  'error handler', 'error handling', 'error boundary',
  'error type', 'error message', 'error code', 'error class',
  'null object', 'null check', 'null pattern',
  'undefined behavior',
  'fix the style', 'fix the format', 'fix the lint',
  'fix the config', 'fix the setup',
];

export function classifyRetrievalMode(query: string): QueryIntent {
  const lower = query.toLowerCase();

  // 1. Check TRACE_KEYWORDS first (multi-word phrase signals)
  if (TRACE_KEYWORDS.some((kw) => lower.includes(kw)) || TRACE_REGEX.test(lower)) {
    // Ambiguity guard: if the query contains broad/architectural language, explore wins
    const broadTerms = ['architecture', 'overview', 'structure', 'system', 'design', 'pipeline', 'codebase'];
    const isBroad = broadTerms.some((t) => lower.includes(t));
    if (!isBroad) {
      return 'trace';
    }
  }

  // 2. Check LOOKUP_BIGRAMS (strong, always-lookup signals)
  if (LOOKUP_BIGRAMS.some((bg) => lower.includes(bg))) {
    return 'lookup';
  }

  // 3. Check LOOKUP_KEYWORDS with EXPLORE_EXCLUSIONS guard
  const hasLookupKeyword = LOOKUP_KEYWORDS.some((kw) => lower.includes(kw));
  if (hasLookupKeyword) {
    const isExcluded = EXPLORE_EXCLUSIONS.some((ex) => lower.includes(ex));
    if (!isExcluded) {
      return 'lookup';
    }
  }

  // 4. Default to explore
  return 'explore';
}

export const RETRIEVAL_STRATEGIES: Record<QueryIntent, SearchOptions> = {
  lookup:  { limit: 5,  distanceThreshold: 0.4, keywordBoostWeight: 0.40 },
  trace:   { limit: 3,  distanceThreshold: 0.5, keywordBoostWeight: 0.20 },
  explore: { limit: 20, distanceThreshold: 0.6, keywordBoostWeight: 0.10 },
};

/**
 * Extracts meaningful tokens from a query for filename/name matching.
 * Splits on whitespace and punctuation, lowercases, and filters short tokens.
 */
export function extractQueryTokens(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[\s.,;:!?'"()\[\]{}/\\]+/)
    .filter(t => t.length >= 3);
}

/**
 * Splits a camelCase or PascalCase identifier into lowercase sub-tokens.
 * "compressChunk" -> ["compress", "chunk"]
 * "runBuildContext" -> ["run", "build", "context"]
 * Tokens shorter than 2 characters are filtered out.
 */
function splitCamelCase(name: string): string[] {
  return name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .split(/\s+/)
    .filter(t => t.length >= 2);
}

/**
 * Computes a keyword boost score [0, 1] based on how many query tokens appear
 * in the chunk's file path or function name.
 *
 * Motivation: vector similarity alone can miss obvious filename matches
 * (e.g. "compression test" should rank compression.test.ts above compression.ts).
 * This boost reranks results within the filtered set without discarding any.
 *
 * Tiers (PREC-01, PREC-02):
 * - 1.0: Exact symbol name match — any query token equals chunk.name
 * - 1.0: Near-exact via camelCase sub-tokens — all sub-tokens of chunk name appear in query tokens
 * - 0.8: Filename stem exact match — any query token equals the filename stem (without extension)
 * - fallback: Original partial token presence (matchCount / queryTokens.length)
 */
export function computeKeywordBoost(chunk: Pick<RetrievedChunk, 'filePath' | 'name'>, queryTokens: string[]): number {
  if (queryTokens.length === 0) return 0;

  const fileName = chunk.filePath.split('/').pop()?.toLowerCase() ?? '';
  const fileNameStem = fileName.replace(/\.[^.]+$/, '');
  const chunkName = (chunk.name ?? '').toLowerCase();

  // Tier 1 (PREC-01): Exact symbol name match — any query token equals chunk.name
  if (chunkName.length > 0 && queryTokens.some(t => t === chunkName)) {
    return 1.0;
  }

  // Tier 2 (PREC-01): Near-exact via camelCase sub-token match
  // All sub-tokens of chunk name must appear in query tokens
  const subTokens = chunkName.length > 0 ? splitCamelCase(chunk.name ?? '') : [];
  if (subTokens.length > 1 && subTokens.every(sub => queryTokens.some(t => t.includes(sub) || sub.includes(t)))) {
    return 1.0;
  }

  // Tier 3 (PREC-02): Filename stem exact match — any query token equals the stem
  if (fileNameStem.length > 0 && queryTokens.some(t => t === fileNameStem)) {
    return 0.6;
  }

  // Tier 4: Fallback — original partial token presence
  const target = `${fileName} ${chunkName}`;
  const matchCount = queryTokens.filter(t => target.includes(t)).length;
  return matchCount / queryTokens.length;
}

/** Build tool config file patterns with their corresponding tool name token. */
const CONFIG_NOISE_PATTERNS: Array<{ pattern: RegExp; toolName: string }> = [
  { pattern: /^vitest\.config\./,  toolName: 'vitest' },
  { pattern: /^tsup\.config\./,    toolName: 'tsup' },
  { pattern: /^tsconfig.*\.json$/, toolName: 'tsconfig' },
  { pattern: /^jest\.config\./,    toolName: 'jest' },
  { pattern: /^eslint\.config\./,  toolName: 'eslint' },
  { pattern: /^\.eslintrc/,        toolName: 'eslint' },
];

/**
 * Score penalty applied to build tool config files in blended search results.
 * Prevents vitest.config.ts, tsup.config.ts, tsconfig.json, etc. from
 * surfacing ahead of application code for generic queries.
 * The penalty is not applied when the query explicitly names the tool
 * (e.g. "how does tsup build the project" still surfaces tsup.config.ts).
 */
const CONFIG_FILE_NOISE_PENALTY = 0.15;

/**
 * Returns CONFIG_FILE_NOISE_PENALTY when the chunk is a build tool config file
 * and the query does not explicitly name the corresponding tool; returns 0 otherwise.
 */
function computeNoisePenalty(chunk: RetrievedChunk, query: string): number {
  const fileName = chunk.filePath.split('/').pop() ?? '';
  const lowerQuery = query.toLowerCase();

  for (const { pattern, toolName } of CONFIG_NOISE_PATTERNS) {
    if (pattern.test(fileName)) {
      if (lowerQuery.includes(toolName)) return 0;
      return CONFIG_FILE_NOISE_PENALTY;
    }
  }
  return 0;
}

/**
 * Score penalty subtracted from blended score for test file chunks.
 * Range 0.3-0.5 per RANK-01; increased so impl files win over specs for generic queries.
 */
const TEST_FILE_NOISE_PENALTY = 0.55;
const HISTORY_CHUNK_PENALTY = 0.07;

function computeHistoryPenalty(chunk: RetrievedChunk): number {
  return chunk.sourceKind === 'history' ? HISTORY_CHUNK_PENALTY : 0;
}

/** True when the query likely targets tests (skip test-file down-ranking / filtering). */
export function querySignalsTestIntent(query: string): boolean {
  const lower = query.toLowerCase();
  if (/\btests?\b/.test(lower)) return true;
  if (/\bspec\b/.test(lower)) return true;
  const phrases = [
    'coverage',
    'tested',
    'how to test',
    'jest',
    'vitest',
    'mock',
    '__tests__',
  ];
  return phrases.some((kw) => lower.includes(kw));
}

/**
 * For build_context: drop test chunks when the query is not test-focused and enough
 * non-test chunks exist; otherwise pad with test chunks to preserve a minimum count.
 */
export function filterDedupedForNonTestChunks(
  chunks: RetrievedChunk[],
  query: string,
  minTotal = 3,
): RetrievedChunk[] {
  if (querySignalsTestIntent(query)) return chunks;

  const isTestPath = (filePath: string): boolean =>
    /\.test\.[jt]sx?$/.test(filePath) ||
    /\.spec\.[jt]sx?$/.test(filePath) ||
    filePath.includes('__tests__/');

  const nonTest = chunks.filter((c) => !isTestPath(c.filePath));
  const testChunks = chunks.filter((c) => isTestPath(c.filePath));

  if (nonTest.length >= minTotal) return nonTest;
  if (nonTest.length > 0) {
    const pad = Math.min(minTotal - nonTest.length, testChunks.length);
    return [...nonTest, ...testChunks.slice(0, pad)];
  }
  return chunks;
}

/**
 * Returns TEST_FILE_NOISE_PENALTY when the chunk belongs to a test file
 * and the query does not signal test intent; returns 0 otherwise.
 *
 * Test file detection uses file path regex (not LanceDB metadata):
 * - *.test.{js,jsx,ts,tsx}
 * - *.spec.{js,jsx,ts,tsx}
 * - __tests__/ directory
 */
function computeTestFilePenalty(chunk: RetrievedChunk, query: string): number {
  const filePath = chunk.filePath;
  const isTestFile =
    /\.test\.[jt]sx?$/.test(filePath) ||
    /\.spec\.[jt]sx?$/.test(filePath) ||
    filePath.includes('__tests__/');

  if (!isTestFile) return 0;

  if (querySignalsTestIntent(query)) return 0;

  return TEST_FILE_NOISE_PENALTY;
}

const CHUNK_COLUMNS = ['id', 'file_path', 'chunk_type', 'scope', 'name', 'content', 'start_line', 'end_line', 'file_type', 'source_kind'];
const MAX_EXACT_CANDIDATES = 500;

function exactSymbolTokens(query: string, tokens: string[]): string[] {
  const identifier = query.trim().replace(/^`([^`]+)`$/, '$1');
  return /^[a-zA-Z_$][\w$]*$/.test(identifier) ? [identifier.toLowerCase()] : [...new Set(tokens)];
}

function isExactName(name: string | null, tokens: string[]): boolean {
  return name != null && tokens.includes(name.toLowerCase());
}

function compareIds(a: RetrievedChunk, b: RetrievedChunk): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function rowToChunk(r: Record<string, unknown>, similarity = 0): RetrievedChunk {
  return {
    id: r.id as string,
    filePath: r.file_path as string,
    chunkType: r.chunk_type as string,
    sourceKind: r.source_kind === 'history' ? 'history' : 'file',
    scope: (r.scope as string) ?? null,
    name: (r.name as string) ?? null,
    content: r.content as string,
    startLine: r.start_line as number,
    endLine: r.end_line as number,
    similarity,
    fileType: (r.file_type as string) ?? 'source',
  };
}

async function chunkColumns(table: Table): Promise<string[]> {
  const fields = new Set((await table.schema()).fields.map(field => field.name));
  return CHUNK_COLUMNS.filter(column =>
    (column !== 'source_kind' && column !== 'file_type') || fields.has(column));
}

async function exactNameCandidates(table: Table, tokens: string[], columns?: string[]): Promise<RetrievedChunk[]> {
  if (tokens.length === 0) return [];
  const projection = columns ?? await chunkColumns(table);
  const names = tokens.map(token => `'${escapeSqlLiteral(token)}'`).join(', ');
  const rows = await table.query().where(`lower(name) IN (${names})`)
    .select(projection).limit(MAX_EXACT_CANDIDATES).toArray();
  return rows.map(row => rowToChunk(row));
}

export async function searchChunks(
  table: Table,
  queryVector: number[],
  opts: SearchOptions,
  query?: string
): Promise<RetrievedChunk[]> {
  log.debug({ limit: opts.limit, distanceThreshold: opts.distanceThreshold }, 'Searching chunks');

  const rows = await table
    .query()
    .nearestTo(queryVector)
    .distanceType('cosine')
    .limit(opts.limit)
    .toArray();

  const queryTokens = query ? extractQueryTokens(query) : [];
  const exactTokens = query ? exactSymbolTokens(query, queryTokens) : [];
  const exactCandidates = await exactNameCandidates(table, exactTokens);

  const chunks: RetrievedChunk[] = (rows as RawChunkRow[])
    .filter((r) => r._distance <= opts.distanceThreshold || isExactName(r.name, exactTokens))
    .filter((r) => {
      const vec = (r as unknown as { vector?: unknown }).vector;
      return vec == null || !isStoredVectorAllZero(vec);
    })
    .map((r) => rowToChunk(r as unknown as Record<string, unknown>, 1 - r._distance));
  const merged = deduplicateChunks([...chunks, ...exactCandidates]);

  if (queryTokens.length > 0 || exactTokens.length > 0) {
    // Rerank: blend vector similarity with per-mode keyword boost weight, minus noise penalties.
    // Config noise penalty prevents build tool config files from ranking above application code.
    // Test file noise penalty prevents test files from ranking above impl files for generic queries.
    // IMPORTANT: compute sort score FIRST using original similarity, THEN apply promotion.
    const boostWeight = opts.keywordBoostWeight ?? 0.10;
    const scored = merged.map(chunk => {
      const exact = isExactName(chunk.name, exactTokens);
      const boost = computeKeywordBoost(chunk, queryTokens);
      const score = chunk.similarity * (1 - boostWeight)
        + boost * boostWeight
        - computeNoisePenalty(chunk, query!)
        - computeTestFilePenalty(chunk, query!)
        - computeHistoryPenalty(chunk);
      const promotedSimilarity = !exact && boost > 0
        ? Math.max(chunk.similarity, HIGH_RELEVANCE_SIMILARITY_THRESHOLD)
        : chunk.similarity;
      return { chunk: { ...chunk, similarity: promotedSimilarity }, score, exact };
    });
    return scored
      .sort((a, b) => Number(b.exact) - Number(a.exact) || b.score - a.score || compareIds(a.chunk, b.chunk))
      .slice(0, opts.limit)
      .map(({ chunk }) => chunk);
  }

  return chunks.sort((a: RetrievedChunk, b: RetrievedChunk) => b.similarity - a.similarity);
}

export function deduplicateChunks(chunks: RetrievedChunk[]): RetrievedChunk[] {
  const seen = new Set<string>();
  return chunks.filter((c) => {
    if (seen.has(c.id)) return false;
    seen.add(c.id);
    return true;
  });
}

/**
 * Keyword-only search fallback when Ollama is unavailable.
 * Filters case-insensitively in LanceDB and caps materialized candidates, excluding vectors.
 */
export async function keywordSearchChunks(
  table: Table,
  query: string,
  limit: number,
): Promise<RetrievedChunk[]> {
  const queryTokens = [...new Set(query.toLowerCase()
    .split(/[\s.,;:!?"()\[\]{}/]+/)
    .filter(token => token.length >= 3))];
  const exactTokens = exactSymbolTokens(query, queryTokens);
  if (queryTokens.length === 0 && exactTokens.length === 0) return [];
  const columns = await chunkColumns(table);
  const exactCandidates = await exactNameCandidates(table, exactTokens, columns);

  const predicate = queryTokens
    .map(t => {
      const escaped = t.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_').replace(/'/g, "''");
      return ['file_path', 'name', 'content']
        .map(column => `lower(${column}) LIKE '%${escaped}%' ESCAPE '\\'`)
        .join(' OR ');
    })
    .join(' OR ');

  const rows = queryTokens.length === 0 ? [] : await table
    .query()
    .where(predicate)
    .select(columns)
    .limit(Math.min(limit * 10, 500))
    .toArray();

  const scored = deduplicateChunks([...exactCandidates, ...rows.map(row => rowToChunk(row))]).map(chunk => {
    const exact = isExactName(chunk.name, exactTokens);
    const identifiers = `${chunk.filePath} ${chunk.name ?? ''}`.toLowerCase();
    const identifierScore = Math.max(
      computeKeywordBoost(chunk, queryTokens),
      queryTokens.filter(token => identifiers.includes(token)).length / Math.max(1, queryTokens.length),
    );
    const body = chunk.content.toLowerCase();
    const bodyScore = queryTokens.filter(token => body.includes(token)).length / Math.max(1, queryTokens.length);
    return { chunk, identifierScore, bodyScore, exact };
  });

  return scored
    .filter(({ identifierScore, bodyScore, exact }) => exact || identifierScore > 0 || bodyScore > 0)
    .sort((a, b) => Number(b.exact) - Number(a.exact) || b.identifierScore - a.identifierScore
      || b.bodyScore - a.bodyScore
      || compareIds(a.chunk, b.chunk))
    .slice(0, limit)
    .map(({ chunk }) => chunk);
}

/**
 * Expands a set of seed chunks by following call edges one hop out.
 * For each seed chunk, queries the edges table for outgoing call edges,
 * then looks up the callee chunk in the chunks table.
 *
 * Filters:
 * - Only follows 'call' edges (not 'import')
 * - Skips edges where to_file is null (external library calls)
 * - Deduplicates against seed chunk IDs and within expanded results
 * - Caps at MAX_EDGES_PER_CHUNK (5) edges per seed chunk
 *
 * Returns expanded chunks with similarity set to 0.5 (hop-expanded, no vector score).
 */
export async function expandByEdges(
  chunksTable: Table,
  edgesTable: Table,
  seedChunks: RetrievedChunk[],
  maxHops = 1
): Promise<RetrievedChunk[]> {
  if (maxHops <= 0 || seedChunks.length === 0) {
    return [];
  }

  const seenIds = new Set(seedChunks.map((c) => c.id));
  const expanded: RetrievedChunk[] = [];

  for (const chunk of seedChunks) {
    let edges: EdgeRow[];
    try {
      edges = await queryEdgesFrom(edgesTable, chunk.id);
    } catch {
      // Edges table may not exist on legacy indexes — skip gracefully
      continue;
    }

    // Filter: only call edges to known files
    const callEdges = edges
      .filter((e) => e.edge_type === 'call' && e.to_file != null)
      .slice(0, MAX_EDGES_PER_CHUNK);

    for (const edge of callEdges) {
      const toFile = edge.to_file as string;
      const toSymbol = edge.to_symbol;
      const predicate = `file_path = '${escapeSqlLiteral(toFile)}' AND name = '${escapeSqlLiteral(toSymbol)}'`;

      let rows: Record<string, unknown>[];
      try {
        rows = await chunksTable.query().where(predicate).limit(1).toArray() as Record<string, unknown>[];
      } catch {
        continue;
      }

      if (rows.length === 0) continue;
      const r = rows[0];
      const id = r.id as string;
      if (seenIds.has(id)) continue;

      seenIds.add(id);
      expanded.push({
        id,
        filePath: r.file_path as string,
        chunkType: r.chunk_type as string,
        sourceKind: r.source_kind === 'history' ? 'history' : 'file',
        scope: (r.scope as string | null) ?? null,
        name: (r.name as string | null) ?? null,
        content: r.content as string,
        startLine: r.start_line as number,
        endLine: r.end_line as number,
        fileType: (r.file_type as string) ?? 'source',
        similarity: 0.5,
      });
    }
  }

  return expanded;
}
