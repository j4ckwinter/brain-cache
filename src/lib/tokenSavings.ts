import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { countChunkTokens } from '../services/tokenCounter.js';
import type { RetrievedChunk, SavingsDisplayMode } from './types.js';
import {
  computeGrepStyleBaselineFromChunks,
} from './grepStyleBaseline.js';

export interface TokenSavingsResult {
  tokensSent: number;
  estimatedWithoutBraincache: number;
  reductionPct: number;
  filesInContext: number;
  /** Sum of raw chunk content tokens (search result pool). */
  matchedPoolTokens: number;
  /** Share of chunk-pool tokens not represented in tokensSent (search uses chunk bodies only). */
  filteringPct: number;
  savingsDisplayMode: SavingsDisplayMode;
}

export interface ComputeTokenSavingsOptions {
  /** Project root for resolving file paths and reading file-hashes.json */
  rootDir: string;
  query: string;
  /** From readFileHashes(rootDir).hashes or merged tokenCounts */
  tokenCounts: Record<string, number>;
}

/**
 * Token savings for search_codebase: tokens sent vs grep-style baseline (top files
 * among returned chunks by keyword match).
 */
export async function computeTokenSavings(
  chunks: RetrievedChunk[],
  options: ComputeTokenSavingsOptions,
): Promise<TokenSavingsResult> {
  const { rootDir, query, tokenCounts } = options;

  const tokensSent = chunks.reduce(
    (sum, c) => sum + countChunkTokens(c.content),
    0,
  );

  const matchedPoolTokens = tokensSent;

  const readFileTokens = async (fp: string): Promise<number> => {
    try {
      const fileContent = await readFile(resolve(rootDir, fp), 'utf-8');
      return countChunkTokens(fileContent);
    } catch {
      return 0;
    }
  };

  const { grepBaselineTokens } = await computeGrepStyleBaselineFromChunks(
    chunks,
    query,
    tokenCounts,
    readFileTokens,
  );

  const estimatedWithoutBraincache = grepBaselineTokens;

  const uniqueFiles = [...new Set(chunks.map((c) => c.filePath))];
  const filesInContext = uniqueFiles.length;

  const rawReductionPct =
    estimatedWithoutBraincache > 0
      ? Math.round((1 - tokensSent / estimatedWithoutBraincache) * 100)
      : 0;

  let savingsDisplayMode: SavingsDisplayMode = 'full';
  if (rawReductionPct >= 99) {
    savingsDisplayMode = 'filtering_only';
  }

  const reductionPct = Math.min(98, Math.max(0, rawReductionPct));

  const filteringPct =
    matchedPoolTokens > 0 && tokensSent < matchedPoolTokens
      ? Math.round((1 - tokensSent / matchedPoolTokens) * 100)
      : 0;

  return {
    tokensSent,
    estimatedWithoutBraincache,
    reductionPct,
    filesInContext,
    matchedPoolTokens,
    filteringPct,
    savingsDisplayMode,
  };
}
