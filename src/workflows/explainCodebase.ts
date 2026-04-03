import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { readProfile } from '../services/capability.js';
import { isOllamaRunning } from '../services/ollama.js';
import { openDatabase, readIndexState } from '../services/lancedb.js';
import { embedBatchWithRetry } from '../services/embedder.js';
import { searchChunks, deduplicateChunks } from '../services/retriever.js';
import { assembleContext, countChunkTokens } from '../services/tokenCounter.js';
import { groupChunksByFile, enrichWithParentClass, formatGroupedContext } from '../services/cohesion.js';
import { compressChunk } from '../services/compression.js';
import { loadUserConfig, resolveStrategy } from '../services/configLoader.js';
import { DEFAULT_TOKEN_BUDGET, TOOL_CALL_OVERHEAD_TOKENS } from '../lib/config.js';
import type { ContextResult } from '../lib/types.js';

const FALLBACK_QUERY = 'module structure and component responsibilities';

export interface ExplainCodebaseOptions {
  question?: string;
  maxTokens?: number;
  path?: string;
  limit?: number;
  distanceThreshold?: number;
}

/**
 * Explains the overall architecture and structure of an indexed codebase.
 * Uses explore-mode retrieval to get a broad view of the codebase,
 * then groups results by file for a module-oriented presentation.
 *
 * When no question is provided, uses a fallback query for a broad architecture overview.
 */
export async function runExplainCodebase(
  opts?: ExplainCodebaseOptions
): Promise<ContextResult> {
  // 1. Guards
  const profile = await readProfile();
  if (profile === null) {
    throw new Error("No profile found. Run 'brain-cache init' first.");
  }
  const running = await isOllamaRunning();
  if (!running) {
    throw new Error('Ollama is not running.');
  }

  // 2. Open database
  const rootDir = resolve(opts?.path ?? '.');
  const indexState = await readIndexState(rootDir);
  if (indexState === null) {
    throw new Error(`No index found at ${rootDir}. Run 'brain-cache index' first.`);
  }
  const db = await openDatabase(rootDir);
  const tableNames = await db.tableNames();
  if (!tableNames.includes('chunks')) {
    throw new Error("No chunks table found. Run 'brain-cache index' first.");
  }
  const table = await db.openTable('chunks');

  // 3. Load user config and resolve explore strategy
  const userConfig = await loadUserConfig();
  const toolOverride: Partial<{ limit: number; distanceThreshold: number }> = {};
  if (opts?.limit !== undefined) toolOverride.limit = opts.limit;
  if (opts?.distanceThreshold !== undefined) toolOverride.distanceThreshold = opts.distanceThreshold;
  const strategy = resolveStrategy('explore', userConfig, Object.keys(toolOverride).length > 0 ? toolOverride : undefined);

  const query = opts?.question ?? FALLBACK_QUERY;
  const maxTokens = opts?.maxTokens ?? DEFAULT_TOKEN_BUDGET;

  process.stderr.write(`brain-cache: explaining codebase (budget=${maxTokens} tokens)\n`);

  // 4. Embed query and retrieve
  const { embeddings } = await embedBatchWithRetry(indexState.embeddingModel, [query]);
  const results = await searchChunks(table, embeddings[0], strategy);
  const deduped = deduplicateChunks(results);
  const assembled = assembleContext(deduped, { maxTokens });

  // 5. Enrich with parent class chunks
  const enriched = await enrichWithParentClass(assembled.chunks, table, {
    maxTokens,
    currentTokens: assembled.tokenCount,
  });

  // 6. Apply compression to oversized chunks
  const compressed = enriched.map(compressChunk);

  // 7. Group by file and format
  const groups = groupChunksByFile(compressed);
  const content = formatGroupedContext(groups);

  // 8. Estimate tokens without brain-cache
  const uniqueFiles = [...new Set(compressed.map(c => c.filePath))];
  let fileContentTokens = 0;
  for (const filePath of uniqueFiles) {
    try {
      const fileContent = await readFile(filePath, 'utf-8');
      fileContentTokens += countChunkTokens(fileContent);
    } catch {
      // File may have been deleted since indexing — skip
    }
  }
  const toolCalls = 1 + uniqueFiles.length;
  const estimatedWithoutBraincache = fileContentTokens + toolCalls * TOOL_CALL_OVERHEAD_TOKENS;
  const tokensSent = assembled.tokenCount;
  const reductionPct =
    estimatedWithoutBraincache > 0
      ? Math.max(0, Math.round((1 - tokensSent / estimatedWithoutBraincache) * 100))
      : 0;

  return {
    content,
    chunks: compressed,
    metadata: {
      tokensSent,
      estimatedWithoutBraincache,
      reductionPct,
      filesInContext: uniqueFiles.length,
      localTasksPerformed: [
        'embed_query',
        'vector_search',
        'dedup',
        'parent_enrich',
        'compress',
        'cohesion_group',
        'token_budget',
      ],
      cloudCallsMade: 0,
    },
  };
}
