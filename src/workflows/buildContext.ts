import { withIndexSnapshot } from '../services/indexStorage.js';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { requireProfile } from '../lib/guards.js';
import { withIndexConnection, readIndexState, readFileHashes } from '../services/lancedb.js';
import { NoIndexError } from '../lib/errors.js';
import { retrieveQuery } from '../services/queryRetrieval.js';
import {
  deduplicateChunks,
  filterDedupedForNonTestChunks,
  expandByEdges,
} from '../services/retriever.js';
import { assembleContext, countChunkTokens } from '../services/tokenCounter.js';
import { DEFAULT_TOKEN_BUDGET } from '../lib/config.js';
import { computeGrepStyleBaseline } from '../lib/grepStyleBaseline.js';
import type { ContextResult, SavingsDisplayMode } from '../lib/types.js';
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
  await requireProfile();

  const rootDir = resolve(opts?.path ?? '.');
  return withIndexSnapshot(rootDir, async (dataDirectory) => {
    const indexState = await readIndexState(rootDir, dataDirectory);
    if (indexState === null) {
      throw new NoIndexError(rootDir);
    }

    return withIndexConnection(rootDir, dataDirectory, async (db) => {
      const tableNames = await db.tableNames();
      if (!tableNames.includes('chunks')) {
        throw new Error("No chunks table found. Run 'brain-cache index' first.");
      }
      const table = await db.openTable('chunks');

      const maxTokens = opts?.maxTokens ?? DEFAULT_TOKEN_BUDGET;
      process.stderr.write(`brain-cache: building context (budget=${maxTokens} tokens)\n`);
      const retrieval = await retrieveQuery(table, indexState.embeddingModel, query, opts?.limit);
      const { mode, fallback } = retrieval;
      let results = retrieval.chunks;
      if (fallback) {
        process.stderr.write(
          'brain-cache: [FALLBACK] Ollama is unavailable. Building context from keyword matches — results may be less relevant.\n',
        );
      }

      // Expand trace results by following call edges one hop
      if (mode === 'trace' && tableNames.includes('edges')) {
        const edgesTable = await db.openTable('edges');
        const expanded = await expandByEdges(table, edgesTable, results);
        results = [...results, ...expanded];
      }

      let deduped = deduplicateChunks(results);
      deduped = filterDedupedForNonTestChunks(deduped, query);

      /** Raw chunk body tokens in the retrieval set (before formatting / budget assembly). */
      const matchedPoolTokens = deduped.reduce(
        (sum, c) => sum + countChunkTokens(c.content),
        0,
      );

      const assembled = assembleContext(deduped, { maxTokens });

      const { tokenCounts } = await readFileHashes(rootDir, dataDirectory);

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

      const uniqueFiles = [...new Set(assembled.chunks
        .filter((chunk) => chunk.sourceKind !== 'history')
        .map((chunk) => chunk.filePath))];
      const numFiles = uniqueFiles.length;

      const result: ContextResult = {
        content: assembled.content,
        chunks: assembled.chunks,
        metadata: {
          tokensSent,
          estimatedWithoutBraincache,
          reductionPct,
          filesInContext: numFiles,
          matchedPoolTokens,
          filteringPct,
          savingsDisplayMode,
          localTasksPerformed: [
            ...(!fallback ? ['embed_query', 'vector_search'] : ['keyword_search']),
            'dedup', 'token_budget',
            ...(mode === 'trace' && tableNames.includes('edges') ? ['edge_expansion'] : []),
          ],
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
    });
  });
}
