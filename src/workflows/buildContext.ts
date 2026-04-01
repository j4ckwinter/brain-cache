import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { readProfile } from '../services/capability.js';
import { isOllamaRunning } from '../services/ollama.js';
import { openDatabase, readIndexState } from '../services/lancedb.js';
import { embedBatchWithRetry } from '../services/embedder.js';
import {
  searchChunks,
  deduplicateChunks,
  classifyQueryIntent,
  RETRIEVAL_STRATEGIES,
} from '../services/retriever.js';
import { assembleContext, countChunkTokens } from '../services/tokenCounter.js';
import { DEFAULT_TOKEN_BUDGET } from '../lib/config.js';
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
  // 1. Read profile
  const profile = await readProfile();
  if (profile === null) {
    throw new Error("No profile found. Run 'brain-cache init' first.");
  }

  // 2. Check Ollama
  const running = await isOllamaRunning();
  if (!running) {
    throw new Error("Ollama is not running. Start it with 'ollama serve' or run 'brain-cache init'.");
  }

  // 3. Resolve project root and read index state
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
  const intent = classifyQueryIntent(query);
  const strategy: SearchOptions = {
    limit: opts?.limit ?? RETRIEVAL_STRATEGIES[intent].limit,
    distanceThreshold: RETRIEVAL_STRATEGIES[intent].distanceThreshold,
  };

  const maxTokens = opts?.maxTokens ?? DEFAULT_TOKEN_BUDGET;

  process.stderr.write(
    `brain-cache: building context (intent=${intent}, budget=${maxTokens} tokens)\n`
  );

  // 6. Embed query using model from index state
  const vectors = await embedBatchWithRetry(indexState.embeddingModel, [query]);
  const queryVector = vectors[0];

  // 7. Search and deduplicate
  const results = await searchChunks(table, queryVector, strategy);
  const deduped = deduplicateChunks(results);

  // 8. Assemble context within token budget
  const assembled = assembleContext(deduped, { maxTokens });

  // 9. Estimate tokens without Braincache (sum tokens of unique source files in result set)
  const uniqueFiles = [...new Set(assembled.chunks.map((c) => c.filePath))];
  let estimatedWithoutBraincache = 0;
  for (const filePath of uniqueFiles) {
    try {
      const fileContent = await readFile(filePath, 'utf-8');
      estimatedWithoutBraincache += countChunkTokens(fileContent);
    } catch {
      // File may have been deleted since indexing — skip
    }
  }

  // 10. Compute reduction percentage
  const reductionPct =
    estimatedWithoutBraincache > 0
      ? Math.round((1 - assembled.tokenCount / estimatedWithoutBraincache) * 100)
      : 0;

  // 11. Build result
  const result: ContextResult = {
    content: assembled.content,
    chunks: assembled.chunks,
    metadata: {
      tokensSent: assembled.tokenCount,
      estimatedWithoutBraincache,
      reductionPct,
      localTasksPerformed: ['embed_query', 'vector_search', 'dedup', 'token_budget'],
      cloudCallsMade: 0,
    },
  };

  process.stderr.write(
    `brain-cache: context assembled (${assembled.tokenCount} tokens, ${reductionPct}% reduction, ${assembled.chunks.length} chunks)\n`
  );

  return result;
}
