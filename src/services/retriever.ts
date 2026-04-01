import type { Table } from '@lancedb/lancedb';
import { childLogger } from './logger.js';
import type { RetrievedChunk, SearchOptions, QueryIntent } from '../lib/types.js';
import {
  DEFAULT_SEARCH_LIMIT,
  DEFAULT_DISTANCE_THRESHOLD,
  DIAGNOSTIC_SEARCH_LIMIT,
  DIAGNOSTIC_DISTANCE_THRESHOLD,
} from '../lib/config.js';

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

const DIAGNOSTIC_KEYWORDS = [
  'why', 'broken', 'error', 'bug', 'fail', 'crash', 'exception',
  'undefined', 'null', 'wrong', 'issue', 'problem',
  'causes', 'caused', 'debug', 'fix', 'incorrect', 'unexpected',
];

const DIAGNOSTIC_BIGRAMS = [
  'stack trace', 'null pointer', 'not defined',
  'type error', 'reference error', 'syntax error',
  'runtime error', 'segmentation fault',
  'not working', 'throws exception',
];

const DIAGNOSTIC_EXCLUSIONS = [
  'error handler', 'error handling', 'error boundary',
  'error type', 'error message', 'error code', 'error class',
  'null object', 'null check', 'null pattern',
  'undefined behavior',
  'fix the style', 'fix the format', 'fix the lint',
  'fix the config', 'fix the setup',
];

export function classifyQueryIntent(query: string): QueryIntent {
  const lower = query.toLowerCase();

  // Bigram match -> always diagnostic (strong signal, per D-07)
  if (DIAGNOSTIC_BIGRAMS.some((bg) => lower.includes(bg))) {
    return 'diagnostic';
  }

  // Single keyword match, but check exclusion patterns first (per D-08)
  const hasKeyword = DIAGNOSTIC_KEYWORDS.some((kw) => lower.includes(kw));
  if (hasKeyword) {
    const isExcluded = DIAGNOSTIC_EXCLUSIONS.some((ex) => lower.includes(ex));
    if (!isExcluded) {
      return 'diagnostic';
    }
  }

  return 'knowledge';
}

export const RETRIEVAL_STRATEGIES: Record<QueryIntent, SearchOptions> = {
  diagnostic: { limit: DIAGNOSTIC_SEARCH_LIMIT, distanceThreshold: DIAGNOSTIC_DISTANCE_THRESHOLD },
  knowledge: { limit: DEFAULT_SEARCH_LIMIT, distanceThreshold: DEFAULT_DISTANCE_THRESHOLD },
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
