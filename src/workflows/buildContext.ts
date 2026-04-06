import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { requireProfile, requireOllama } from '../lib/guards.js';
import { openDatabase, readIndexState } from '../services/lancedb.js';
import { embedBatchWithRetry } from '../services/embedder.js';
import {
  searchChunks,
  deduplicateChunks,
  classifyRetrievalMode,
  RETRIEVAL_STRATEGIES,
} from '../services/retriever.js';
import { assembleContext, countChunkTokens } from '../services/tokenCounter.js';
import { DEFAULT_TOKEN_BUDGET, TOOL_CALL_OVERHEAD_TOKENS } from '../lib/config.js';
import type { ContextResult, SearchOptions } from '../lib/types.js';

export interface BuildContextOptions {
  maxTokens?: number;
  limit?: number;
  path?: string;
}

export async function runBuildContext(
  query: string,
  opts?: BuildContextOptions
): Promise<ContextResult> {
  // 1. Read profile and check Ollama
  const profile = await requireProfile();
  await requireOllama();

  // 2. Resolve project root and read index state
  const rootDir = resolve(opts?.path ?? '.');
  const indexState = await readIndexState(rootDir);
  if (indexState === null) {
    throw new Error(`No index found at ${rootDir}. Run 'brain-cache index' first.`);
  }

  // 4. Open database and table
  const db = await openDatabase(rootDir);
  const tableNames = await db.tableNames();
  if (!tableNames.includes('chunks')) {
    throw new Error("No chunks table found. Run 'brain-cache index' first.");
  }
  const table = await db.openTable('chunks');

  // 5. Classify intent and determine search strategy
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

  // 6. Embed query using model from index state
  const { embeddings: vectors } = await embedBatchWithRetry(indexState.embeddingModel, [query]);
  const queryVector = vectors[0];

  // 7. Search and deduplicate
  const results = await searchChunks(table, queryVector, strategy, query);
  const deduped = deduplicateChunks(results);

  // 8. Assemble context within token budget
  const assembled = assembleContext(deduped, { maxTokens });

  // 9. Estimate tokens without brain-cache
  //
  // Baseline represents what Claude would spend without this tool: one tool call
  // to find relevant files, then one full Read per matched file.
  const uniqueFiles = [...new Set(assembled.chunks.map((c) => c.filePath))];
  const numFiles = uniqueFiles.length;
  let fileContentTokens = 0;
  for (const filePath of uniqueFiles) {
    try {
      const fileContent = await readFile(filePath, 'utf-8');
      fileContentTokens += countChunkTokens(fileContent);
    } catch {
      // File may have been deleted since indexing — skip
    }
  }

  const toolCalls = 1 + numFiles;
  const toolCallOverhead = toolCalls * TOOL_CALL_OVERHEAD_TOKENS;
  const estimatedWithoutBraincache = fileContentTokens + toolCallOverhead;

  // 10. Compute reduction percentage
  const reductionPct =
    estimatedWithoutBraincache > 0
      ? Math.max(0, Math.round((1 - assembled.tokenCount / estimatedWithoutBraincache) * 100))
      : 0;

  // 11. Build result
  const result: ContextResult = {
    content: assembled.content,
    chunks: assembled.chunks,
    metadata: {
      tokensSent: assembled.tokenCount,
      estimatedWithoutBraincache,
      reductionPct,
      filesInContext: numFiles,
      localTasksPerformed: ['embed_query', 'vector_search', 'dedup', 'token_budget'],
      cloudCallsMade: 0,
    },
  };

  process.stderr.write(
    `brain-cache: context assembled (${assembled.tokenCount} tokens, ${reductionPct}% reduction, ${assembled.chunks.length} chunks)\n`
  );

  return result;
}
