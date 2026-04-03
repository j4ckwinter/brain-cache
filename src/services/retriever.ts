import type { Table } from '@lancedb/lancedb';
import { childLogger } from './logger.js';
import type { RetrievedChunk, SearchOptions, QueryIntent } from '../lib/types.js';

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
  lookup:  { limit: 5,  distanceThreshold: 0.4 },
  trace:   { limit: 3,  distanceThreshold: 0.5 },
  explore: { limit: 20, distanceThreshold: 0.6 },
};

export async function searchChunks(
  table: Table,
  queryVector: number[],
  opts: SearchOptions
): Promise<RetrievedChunk[]> {
  log.debug({ limit: opts.limit, distanceThreshold: opts.distanceThreshold }, 'Searching chunks');

  const rows = await table
    .query()
    .nearestTo(queryVector)
    .distanceType('cosine')
    .limit(opts.limit)
    .toArray();

  return (rows as RawChunkRow[])
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
    }))
    .sort((a: RetrievedChunk, b: RetrievedChunk) => b.similarity - a.similarity);
}

export function deduplicateChunks(chunks: RetrievedChunk[]): RetrievedChunk[] {
  const seen = new Set<string>();
  return chunks.filter((c) => {
    if (seen.has(c.id)) return false;
    seen.add(c.id);
    return true;
  });
}
