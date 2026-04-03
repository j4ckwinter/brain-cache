import type { Table } from '@lancedb/lancedb';
import { childLogger } from './logger.js';
import type { RetrievedChunk, SearchOptions, QueryIntent } from '../lib/types.js';
import { HIGH_RELEVANCE_SIMILARITY_THRESHOLD } from '../lib/config.js';

const log = childLogger('retriever');

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
  _distance: number;
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

/** @deprecated Use classifyRetrievalMode instead */
export const classifyQueryIntent = classifyRetrievalMode;

export const RETRIEVAL_STRATEGIES: Record<QueryIntent, SearchOptions> = {
  lookup:  { limit: 5,  distanceThreshold: 0.4, keywordBoostWeight: 0.40 },
  trace:   { limit: 3,  distanceThreshold: 0.5, keywordBoostWeight: 0.20 },
  explore: { limit: 20, distanceThreshold: 0.6, keywordBoostWeight: 0.10 },
};

/**
 * Extracts meaningful tokens from a query for filename/name matching.
 * Splits on whitespace and punctuation, lowercases, and filters short tokens.
 */
function extractQueryTokens(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[\s.,;:!?'"()\[\]{}/\\]+/)
    .filter(t => t.length >= 3);
}

/**
 * Computes a keyword boost score [0, 1] based on how many query tokens appear
 * in the chunk's file path or function name.
 *
 * Motivation: vector similarity alone can miss obvious filename matches
 * (e.g. "compression test" should rank compression.test.ts above compression.ts).
 * This boost reranks results within the filtered set without discarding any.
 */
function computeKeywordBoost(chunk: RetrievedChunk, queryTokens: string[]): number {
  if (queryTokens.length === 0) return 0;

  const fileName = chunk.filePath.split('/').pop()?.toLowerCase() ?? '';
  const chunkName = (chunk.name ?? '').toLowerCase();
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

  const chunks = (rows as RawChunkRow[])
    .filter((r) => r._distance <= opts.distanceThreshold)
    .map((r) => ({
      id: r.id,
      filePath: r.file_path,
      chunkType: r.chunk_type,
      scope: r.scope,
      name: r.name,
      content: r.content,
      startLine: r.start_line,
      endLine: r.end_line,
      similarity: 1 - r._distance,
    }));

  if (queryTokens.length > 0) {
    // Rerank: blend vector similarity with per-mode keyword boost weight, minus config noise penalty.
    // Config noise penalty prevents build tool config files from ranking above application code.
    // RET-02: Promote similarity for name-matched chunks so compressChunk keeps them intact.
    // IMPORTANT: compute sort score FIRST using original similarity, THEN apply promotion.
    const boostWeight = opts.keywordBoostWeight ?? 0.10;
    const scored = chunks.map(chunk => {
      const boost = computeKeywordBoost(chunk, queryTokens);
      const score = chunk.similarity * (1 - boostWeight)
        + boost * boostWeight
        - computeNoisePenalty(chunk, query!);
      // RET-02: Promote similarity for name-matched chunks so compressChunk keeps them intact
      const promotedSimilarity = boost > 0
        ? Math.max(chunk.similarity, HIGH_RELEVANCE_SIMILARITY_THRESHOLD)
        : chunk.similarity;
      return { chunk: { ...chunk, similarity: promotedSimilarity }, score };
    });
    return scored
      .sort((a, b) => b.score - a.score)
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
