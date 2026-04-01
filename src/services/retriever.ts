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

const DIAGNOSTIC_KEYWORDS = [
  'why', 'broken', 'error', 'bug', 'fail', 'crash', 'exception',
  'undefined', 'null', 'not working', 'wrong', 'issue', 'problem',
  'causes', 'caused', 'debug', 'fix', 'incorrect', 'unexpected',
];

export function classifyQueryIntent(query: string): QueryIntent {
  const lower = query.toLowerCase();
  return DIAGNOSTIC_KEYWORDS.some((kw) => lower.includes(kw))
    ? 'diagnostic'
    : 'knowledge';
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

  return rows
    .filter((r: any) => r._distance <= opts.distanceThreshold)
    .map((r: any) => ({
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
