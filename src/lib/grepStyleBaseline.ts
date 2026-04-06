/**
 * Grep-style counterfactual for token savings: simulate "find keywords, open top-N files".
 * Scans the chunks table (same cost class as keyword fallback) and ranks files by
 * aggregate keyword boost score, then sums full-file token counts for the top N files.
 */
import type { Table } from '@lancedb/lancedb';
import {
  computeKeywordBoost,
  extractQueryTokens,
} from '../services/retriever.js';
import { countChunkTokens } from '../services/tokenCounter.js';
import { TOOL_CALL_OVERHEAD_TOKENS } from './config.js';
import type { RetrievedChunk } from './types.js';

/** Max files to assume a developer would open after a keyword search (plan: top 5). */
export const GREP_BASELINE_TOP_FILES = 5;

export interface GrepBaselineResult {
  /** Sum of full-file tokens for top files + tool-call overhead (grep + reads). */
  grepBaselineTokens: number;
  /** 1–5 files included in the sum. */
  filesUsed: number;
}

function rowToChunk(r: Record<string, unknown>): RetrievedChunk {
  return {
    id: r.id as string,
    filePath: r.file_path as string,
    chunkType: r.chunk_type as string,
    scope: (r.scope as string) ?? null,
    name: (r.name as string) ?? null,
    content: r.content as string,
    startLine: r.start_line as number,
    endLine: r.end_line as number,
    similarity: 0,
    fileType: (r.file_type as string) ?? 'source',
  };
}

/**
 * Aggregates keyword boost scores per file, takes top `maxFiles`, sums token counts from manifest/disk.
 */
export async function computeGrepStyleBaseline(
  table: Table,
  query: string,
  tokenCounts: Record<string, number>,
  readFileTokens: (relativePath: string) => Promise<number>,
): Promise<GrepBaselineResult> {
  const queryTokens = extractQueryTokens(query);
  if (queryTokens.length === 0) {
    return {
      grepBaselineTokens: TOOL_CALL_OVERHEAD_TOKENS,
      filesUsed: 0,
    };
  }

  const rows = await table.query().toArray();
  const byFile = new Map<string, number>();

  for (const r of rows) {
    const chunk = rowToChunk(r as Record<string, unknown>);
    const boost = computeKeywordBoost(chunk, queryTokens);
    if (boost <= 0) continue;
    const prev = byFile.get(chunk.filePath) ?? 0;
    byFile.set(chunk.filePath, prev + boost);
  }

  const ranked = [...byFile.entries()]
    .filter(([, score]) => score > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, GREP_BASELINE_TOP_FILES);

  let fileTokens = 0;
  for (const [fp] of ranked) {
    if (tokenCounts[fp] !== undefined) {
      fileTokens += tokenCounts[fp];
    } else {
      fileTokens += await readFileTokens(fp);
    }
  }

  const filesUsed = ranked.length;
  const toolCalls = 1 + filesUsed;
  const grepBaselineTokens = fileTokens + toolCalls * TOOL_CALL_OVERHEAD_TOKENS;

  return { grepBaselineTokens, filesUsed };
}

/**
 * Grep-style baseline using only the chunks returned by search (no full table scan).
 * Ranks files by max keyword boost among returned chunks, sums full-file tokens for top N.
 */
export async function computeGrepStyleBaselineFromChunks(
  chunks: RetrievedChunk[],
  query: string,
  tokenCounts: Record<string, number>,
  readFileTokens: (relativePath: string) => Promise<number>,
): Promise<GrepBaselineResult> {
  const queryTokens = extractQueryTokens(query);
  if (queryTokens.length === 0) {
    return {
      grepBaselineTokens: TOOL_CALL_OVERHEAD_TOKENS,
      filesUsed: 0,
    };
  }

  const maxBoostByFile = new Map<string, number>();
  for (const chunk of chunks) {
    const boost = computeKeywordBoost(chunk, queryTokens);
    const prev = maxBoostByFile.get(chunk.filePath) ?? 0;
    if (boost > prev) maxBoostByFile.set(chunk.filePath, boost);
  }

  const ranked = [...maxBoostByFile.entries()]
    .filter(([, score]) => score > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, GREP_BASELINE_TOP_FILES);

  let fileTokens = 0;
  for (const [fp] of ranked) {
    if (tokenCounts[fp] !== undefined) {
      fileTokens += tokenCounts[fp];
    } else {
      fileTokens += await readFileTokens(fp);
    }
  }

  const filesUsed = ranked.length;
  const toolCalls = 1 + filesUsed;
  const grepBaselineTokens = fileTokens + toolCalls * TOOL_CALL_OVERHEAD_TOKENS;

  return { grepBaselineTokens, filesUsed };
}
