import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { requireProfile, requireOllama } from '../lib/guards.js';
import { getConnection, readIndexState, readFileHashes } from '../services/lancedb.js';
import { NoIndexError } from '../lib/errors.js';
import { embedBatchWithRetry } from '../services/embedder.js';
import {
  searchChunks,
  deduplicateChunks,
  classifyRetrievalMode,
  RETRIEVAL_STRATEGIES,
  filterDedupedForNonTestChunks,
} from '../services/retriever.js';
import { assembleContext, countChunkTokens } from '../services/tokenCounter.js';
import { DEFAULT_TOKEN_BUDGET } from '../lib/config.js';
import { computeGrepStyleBaseline } from '../lib/grepStyleBaseline.js';
import type { ContextResult, SearchOptions, SavingsDisplayMode } from '../lib/types.js';
import { childLogger } from '../services/logger.js';

const log = childLogger('build-context');

export interface BuildContextOptions {
  maxTokens?: number;
  limit?: number;
  path?: string;
}

export async function runBuildContext(
  query: string,
  opts?: BuildContextOptions
): Promise<ContextResult> {
  const profile = await requireProfile();
  await requireOllama();

  const rootDir = resolve(opts?.path ?? '.');
  const indexState = await readIndexState(rootDir);
  if (indexState === null) {
    throw new NoIndexError(rootDir);
  }

  const db = await getConnection(rootDir);
  const tableNames = await db.tableNames();
  if (!tableNames.includes('chunks')) {
    throw new Error("No chunks table found. Run 'brain-cache index' first.");
  }
  const table = await db.openTable('chunks');

  const mode = classifyRetrievalMode(query);
  const strategy: SearchOptions = {
    limit: opts?.limit ?? RETRIEVAL_STRATEGIES[mode].limit,
    distanceThreshold: RETRIEVAL_STRATEGIES[mode].distanceThreshold,
    keywordBoostWeight: RETRIEVAL_STRATEGIES[mode].keywordBoostWeight,
  };

  const maxTokens = opts?.maxTokens ?? DEFAULT_TOKEN_BUDGET;

  process.stderr.write(
    `brain-cache: building context (intent=${mode}, budget=${maxTokens} tokens)\n`
  );

  const { embeddings: vectors } = await embedBatchWithRetry(indexState.embeddingModel, [query]);
  const queryVector = vectors[0];

  const results = await searchChunks(table, queryVector, strategy, query);
  let deduped = deduplicateChunks(results);
  deduped = filterDedupedForNonTestChunks(deduped, query);
  const sourceChunks = deduped.filter((chunk) => chunk.sourceKind !== 'history');
  const historyChunks = deduped.filter((chunk) => chunk.sourceKind === 'history');

  /** Raw chunk body tokens in the retrieval set (before formatting / budget assembly). */
  const matchedPoolTokens = deduped.reduce(
    (sum, c) => sum + countChunkTokens(c.content),
    0,
  );

  const assembled = assembleContext(sourceChunks, { maxTokens });
  const historySection = historyChunks
    .map(
      (chunk) =>
        `### ${chunk.name ?? chunk.id}\n${chunk.content}`,
    )
    .join('\n\n');
  const contentWithHistory = historySection.length > 0
    ? `${assembled.content}\n\n## Git History\n\n${historySection}`
    : assembled.content;

  const { tokenCounts } = await readFileHashes(rootDir);

  const readFileTokens = async (fp: string): Promise<number> => {
    try {
      const fileContent = await readFile(resolve(rootDir, fp), 'utf-8');
      return countChunkTokens(fileContent);
    } catch {
      return 0;
    }
  };

  const { grepBaselineTokens } = await computeGrepStyleBaseline(
    table,
    query,
    tokenCounts,
    readFileTokens,
  );

  const estimatedWithoutBraincache = grepBaselineTokens;

  const tokensSent = assembled.tokenCount;
  const rawReductionPct =
    estimatedWithoutBraincache > 0
      ? Math.round((1 - tokensSent / estimatedWithoutBraincache) * 100)
      : 0;

  let savingsDisplayMode: SavingsDisplayMode = 'full';
  if (rawReductionPct >= 99) {
    log.warn(
      {
        tokensSent,
        estimatedWithoutBraincache,
        rawReductionPct,
        mode: 'grep_baseline',
      },
      'Token savings reduction >= 99% — showing filtering stats instead of reduction %',
    );
    savingsDisplayMode = 'filtering_only';
  }

  const reductionPct =
    savingsDisplayMode === 'filtering_only'
      ? Math.min(98, rawReductionPct)
      : Math.min(98, Math.max(0, rawReductionPct));

  let filteringPct = 0;
  if (matchedPoolTokens > 0 && tokensSent < matchedPoolTokens) {
    filteringPct = Math.round((1 - tokensSent / matchedPoolTokens) * 100);
  }

  const uniqueFiles = [...new Set(assembled.chunks.map((c) => c.filePath))];
  const numFiles = uniqueFiles.length;

  const result: ContextResult = {
    content: contentWithHistory,
    chunks: assembled.chunks,
    metadata: {
      tokensSent,
      estimatedWithoutBraincache,
      reductionPct,
      filesInContext: numFiles,
      matchedPoolTokens,
      filteringPct,
      savingsDisplayMode,
      localTasksPerformed: ['embed_query', 'vector_search', 'dedup', 'token_budget'],
      cloudCallsMade: 0,
    },
  };

  const stderrNote =
    savingsDisplayMode === 'filtering_only'
      ? `${tokensSent} tokens, ${filteringPct}% of matched chunk pool filtered by budget`
      : `${tokensSent} tokens, ~${reductionPct}% vs grep-style baseline, ${filteringPct}% of chunk pool filtered`;
  process.stderr.write(
    `brain-cache: context assembled (${stderrNote}, ${assembled.chunks.length} chunks)\n`
  );

  return result;
}
