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
import { groupChunksByFile, enrichWithParentClass, formatGroupedContext } from '../services/cohesion.js';
import { compressChunk } from '../services/compression.js';
import { loadUserConfig, resolveStrategy } from '../services/configLoader.js';
import { runTraceFlow } from './traceFlow.js';
import { runExplainCodebase } from './explainCodebase.js';
import { DEFAULT_TOKEN_BUDGET, TOOL_CALL_OVERHEAD_TOKENS } from '../lib/config.js';
import type { ContextResult, RetrievedChunk, SearchOptions } from '../lib/types.js';

function splitCamelCase(name: string): string[] {
  return name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .split(/\s+/)
    .filter(t => t.length >= 2);
}

function extractQueryTokens(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[\s.,;:!?'"()\[\]{}/\\]+/)
    .filter(t => t.length >= 3);
}

function isPrimaryMatch(chunk: RetrievedChunk, queryTokens: string[]): boolean {
  if (queryTokens.length === 0) return false;
  const fileName = chunk.filePath.split('/').pop()?.toLowerCase() ?? '';
  const fileNameStem = fileName.replace(/\.[^.]+$/, '');
  const originalName = chunk.name ?? '';
  const chunkName = originalName.toLowerCase();

  // Tier 1: exact symbol name match
  if (chunkName.length > 0 && queryTokens.some(t => t === chunkName)) return true;

  // Tier 2: camelCase sub-token match (all sub-tokens in query)
  // Use original (non-lowercased) name so splitCamelCase can detect uppercase boundaries
  const subTokens = originalName.length > 0 ? splitCamelCase(originalName) : [];
  if (subTokens.length > 1 && subTokens.every(sub => queryTokens.some(t => t.includes(sub) || sub.includes(t)))) return true;

  // Tier 3: filename stem exact match
  if (fileNameStem.length > 0 && queryTokens.some(t => t === fileNameStem)) return true;

  return false;
}

const TEST_FILE_PATTERNS = ['.test.', '.spec.', '/__tests__/', '/tests/'];

function isTestFile(filePath: string): boolean {
  return TEST_FILE_PATTERNS.some(p => filePath.includes(p));
}

const CONFIG_FILE_PATTERNS = [
  /vitest\.config\./,
  /tsup\.config\./,
  /tsconfig.*\.json$/,
  /jest\.config\./,
  /eslint\.config\./,
  /\.eslintrc/,
];

function isConfigFile(filePath: string): boolean {
  const fileName = filePath.split('/').pop() ?? '';
  return CONFIG_FILE_PATTERNS.some(p => p.test(fileName));
}

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

  // Check if edges table exists (needed for trace mode routing decision)
  const hasEdges = tableNames.includes('edges');

  // 5. Classify intent
  const mode = classifyRetrievalMode(query);

  const maxTokens = opts?.maxTokens ?? DEFAULT_TOKEN_BUDGET;

  process.stderr.write(
    `brain-cache: building context (intent=${mode}, budget=${maxTokens} tokens)\n`
  );

  // 6. Load user config and resolve strategy
  const userConfig = await loadUserConfig();
  const strategy: SearchOptions = resolveStrategy(
    mode,
    userConfig,
    opts?.limit !== undefined ? { limit: opts.limit } : undefined
  );

  let finalChunks: RetrievedChunk[];
  let finalContent: string;
  let finalTokenCount: number;
  let localTasksPerformed: string[];

  if (mode === 'trace' && hasEdges) {
    // Delegate to runTraceFlow workflow
    const traceResult = await runTraceFlow(query, {
      maxHops: 3,
      path: opts?.path,
      limit: strategy.limit,
      distanceThreshold: strategy.distanceThreshold,
    });

    // Convert TraceFlowResult hops to RetrievedChunk[] for ContextResult compatibility
    const traceChunks: RetrievedChunk[] = traceResult.hops.map((hop, i) => ({
      id: `trace-hop-${i}`,
      filePath: hop.filePath,
      chunkType: 'function',
      scope: null,
      name: hop.name,
      content: hop.content,
      startLine: hop.startLine,
      endLine: 0,
      similarity: 1 - (hop.hopDepth * 0.1),
    }));

    const assembled = assembleContext(traceChunks, { maxTokens });
    const groups = groupChunksByFile(assembled.chunks);
    finalContent = formatGroupedContext(groups);
    finalChunks = assembled.chunks;
    finalTokenCount = assembled.tokenCount;
    localTasksPerformed = traceResult.metadata.localTasksPerformed;
  } else if (mode === 'explore') {
    // Delegate to runExplainCodebase workflow
    const exploreResult = await runExplainCodebase({
      question: query,
      maxTokens,
      path: opts?.path,
      limit: strategy.limit,
      distanceThreshold: strategy.distanceThreshold,
    });
    finalContent = exploreResult.content;
    finalChunks = exploreResult.chunks;
    finalTokenCount = exploreResult.metadata.tokensSent;
    localTasksPerformed = exploreResult.metadata.localTasksPerformed;
  } else {
    // Lookup mode (or trace fallback without edges table)
    if (mode === 'trace' && !hasEdges) {
      process.stderr.write(`brain-cache: No edges table found, falling back to explore mode\n`);
    }

    // 6. Embed query using model from index state
    const { embeddings: vectors } = await embedBatchWithRetry(indexState.embeddingModel, [query]);
    const queryVector = vectors[0];

    const results = await searchChunks(table, queryVector, strategy, query);
    const deduped = deduplicateChunks(results);
    const assembled = assembleContext(deduped, { maxTokens });
    const enriched = await enrichWithParentClass(assembled.chunks, table, { maxTokens, currentTokens: assembled.tokenCount });

    // COMP-02: Drop peripheral chunks (test files, config files) before compression
    const withoutPeripheral = enriched.filter(chunk => !isTestFile(chunk.filePath) && !isConfigFile(chunk.filePath));

    // COMP-01: Primary result protection — skip compression for query-matched chunks
    const queryTokens = extractQueryTokens(query);
    const compressed = withoutPeripheral.map(chunk =>
      isPrimaryMatch(chunk, queryTokens) ? chunk : compressChunk(chunk)
    );

    const groups = groupChunksByFile(compressed);
    finalContent = formatGroupedContext(groups);
    finalChunks = compressed;
    finalTokenCount = assembled.tokenCount;
    localTasksPerformed = ['embed_query', 'vector_search', 'dedup', 'parent_enrich', 'drop_peripheral', 'compress', 'cohesion_group', 'token_budget'];
  }

  // 9. Estimate tokens without brain-cache
  //
  // Baseline represents what Claude would spend without this tool: one grep/search
  // call to find relevant files, then one full Read per matched file.
  //
  // Accuracy constraint: only count files where brain-cache actually saved tokens.
  // A file whose chunks were ALL compressed (body stripped) would need to be read
  // by Claude anyway to get the function bodies — counting those files as "savings"
  // inflates the reduction percentage. Only files with at least one uncompressed
  // chunk contributed genuine savings.
  const BODY_STRIPPED_MARKER = '// [body stripped]';
  const filesWithUncompressedContent = new Set(
    finalChunks
      .filter(c => !c.content.includes(BODY_STRIPPED_MARKER))
      .map(c => c.filePath)
  );

  const uniqueFiles = [...new Set(finalChunks.map((c) => c.filePath))];
  const numFiles = uniqueFiles.length;
  let fileContentTokens = 0;
  for (const filePath of uniqueFiles) {
    if (!filesWithUncompressedContent.has(filePath)) {
      // All chunks from this file were compressed — Claude would read this file
      // anyway, so don't count it as a saved read.
      continue;
    }
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

  // 10. Compute reduction
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
