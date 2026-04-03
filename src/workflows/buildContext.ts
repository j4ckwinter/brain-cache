import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { readProfile } from '../services/capability.js';
import { isOllamaRunning } from '../services/ollama.js';
import { openDatabase, readIndexState } from '../services/lancedb.js';
import { embedBatchWithRetry } from '../services/embedder.js';
import {
  searchChunks,
  deduplicateChunks,
  classifyRetrievalMode,
  RETRIEVAL_STRATEGIES,
} from '../services/retriever.js';
import { assembleContext, countChunkTokens } from '../services/tokenCounter.js';
import { traceFlow } from '../services/flowTracer.js';
import { groupChunksByFile, enrichWithParentClass, formatGroupedContext } from '../services/cohesion.js';
import { DEFAULT_TOKEN_BUDGET, TOOL_CALL_OVERHEAD_TOKENS } from '../lib/config.js';
import type { ContextResult, RetrievedChunk, SearchOptions } from '../lib/types.js';

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

  // Open edges table if it exists
  const hasEdges = tableNames.includes('edges');
  const edgesTable = hasEdges ? await db.openTable('edges') : null;

  // 5. Classify intent and determine search strategy
  const mode = classifyRetrievalMode(query);
  const strategy: SearchOptions = {
    limit: opts?.limit ?? RETRIEVAL_STRATEGIES[mode].limit,
    distanceThreshold: RETRIEVAL_STRATEGIES[mode].distanceThreshold,
  };

  const maxTokens = opts?.maxTokens ?? DEFAULT_TOKEN_BUDGET;

  process.stderr.write(
    `brain-cache: building context (intent=${mode}, budget=${maxTokens} tokens)\n`
  );

  // 6. Embed query using model from index state
  const { embeddings: vectors } = await embedBatchWithRetry(indexState.embeddingModel, [query]);
  const queryVector = vectors[0];

  let finalChunks: RetrievedChunk[];
  let finalContent: string;
  let finalTokenCount: number;
  let localTasksPerformed: string[];

  if (mode === 'trace' && edgesTable !== null) {
    // Trace mode: seed search + BFS flow tracing
    const seedResults = await searchChunks(table, queryVector, strategy);
    const seeds = deduplicateChunks(seedResults);

    if (seeds.length > 0) {
      // BFS trace from first seed
      const hops = await traceFlow(edgesTable, table, seeds[0].id, { maxHops: 3 });

      // Convert FlowHop[] to RetrievedChunk[] for assembleContext compatibility
      const traceChunks: RetrievedChunk[] = hops.map(hop => ({
        id: hop.chunkId,
        filePath: hop.filePath,
        chunkType: 'function',
        scope: null,
        name: hop.name,
        content: hop.content,
        startLine: hop.startLine,
        endLine: hop.endLine,
        similarity: 1 - (hop.hopDepth * 0.1),
      }));

      const assembled = assembleContext(traceChunks, { maxTokens });

      // Apply cohesion grouping
      const groups = groupChunksByFile(assembled.chunks);
      finalContent = formatGroupedContext(groups);
      finalChunks = assembled.chunks;
      finalTokenCount = assembled.tokenCount;
      localTasksPerformed = ['embed_query', 'seed_search', 'bfs_trace', 'cohesion_group', 'token_budget'];
    } else {
      // No seeds found — fall through to explore mode behavior
      const results = await searchChunks(table, queryVector, {
        ...RETRIEVAL_STRATEGIES['explore'],
        limit: opts?.limit ?? RETRIEVAL_STRATEGIES['explore'].limit,
      });
      const deduped = deduplicateChunks(results);
      const assembled = assembleContext(deduped, { maxTokens });
      const enriched = await enrichWithParentClass(assembled.chunks, table, { maxTokens, currentTokens: assembled.tokenCount });
      const groups = groupChunksByFile(enriched);
      finalContent = formatGroupedContext(groups);
      finalChunks = enriched;
      finalTokenCount = assembled.tokenCount;
      localTasksPerformed = ['embed_query', 'vector_search', 'dedup', 'parent_enrich', 'cohesion_group', 'token_budget'];
    }
  } else {
    // Trace mode without edges table: warn and fall through to explore
    if (mode === 'trace' && edgesTable === null) {
      process.stderr.write(
        `brain-cache: No edges table found, falling back to explore mode\n`
      );
    }

    // Lookup or explore mode (or trace fallback): vector search + cohesion
    const results = await searchChunks(table, queryVector, strategy);
    const deduped = deduplicateChunks(results);
    const assembled = assembleContext(deduped, { maxTokens });

    // Enrich with parent class chunks
    const enriched = await enrichWithParentClass(assembled.chunks, table, { maxTokens, currentTokens: assembled.tokenCount });

    // Group by file and format
    const groups = groupChunksByFile(enriched);
    finalContent = formatGroupedContext(groups);
    finalChunks = enriched;
    finalTokenCount = assembled.tokenCount;
    localTasksPerformed = ['embed_query', 'vector_search', 'dedup', 'parent_enrich', 'cohesion_group', 'token_budget'];
  }

  // 9. Estimate tokens without brain-cache
  // Baseline: full file content + tool-call overhead for the search workflow.
  // Without brain-cache, Claude would: 1 Grep to locate files + 1 Read per file.
  const uniqueFiles = [...new Set(finalChunks.map((c) => c.filePath))];
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

  // Tool-call overhead: 1 Grep/Glob search + 1 Read per file
  const toolCalls = 1 + numFiles;
  const toolCallOverhead = toolCalls * TOOL_CALL_OVERHEAD_TOKENS;
  const estimatedWithoutBraincache = fileContentTokens + toolCallOverhead;

  // 10. Compute reduction (assembled output vs realistic alternative)
  const reductionPct =
    estimatedWithoutBraincache > 0
      ? Math.max(0, Math.round((1 - finalTokenCount / estimatedWithoutBraincache) * 100))
      : 0;

  // 11. Build result
  const result: ContextResult = {
    content: finalContent,
    chunks: finalChunks,
    metadata: {
      tokensSent: finalTokenCount,
      estimatedWithoutBraincache,
      reductionPct,
      filesInContext: numFiles,
      localTasksPerformed,
      cloudCallsMade: 0,
    },
  };

  process.stderr.write(
    `brain-cache: context assembled (${finalTokenCount} tokens, ${reductionPct}% reduction, ${finalChunks.length} chunks)\n`
  );

  return result;
}
