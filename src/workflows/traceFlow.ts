import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { readProfile } from '../services/capability.js';
import { isOllamaRunning } from '../services/ollama.js';
import { openDatabase, readIndexState } from '../services/lancedb.js';
import { embedBatchWithRetry } from '../services/embedder.js';
import { searchChunks, deduplicateChunks } from '../services/retriever.js';
import { traceFlow, resolveSymbolToChunkId } from '../services/flowTracer.js';
import { compressChunk } from '../services/compression.js';
import { loadUserConfig, resolveStrategy } from '../services/configLoader.js';
import { countChunkTokens } from '../services/tokenCounter.js';
import { TOOL_CALL_OVERHEAD_TOKENS } from '../lib/config.js';

export interface TraceFlowOptions {
  maxHops?: number;
  path?: string;
  limit?: number;
  distanceThreshold?: number;
}

export interface TraceFlowResult {
  hops: Array<{
    filePath: string;
    name: string | null;
    startLine: number;
    content: string;
    callsFound: string[];
    hopDepth: number;
  }>;
  metadata: {
    seedChunkId: string | null;
    totalHops: number;
    localTasksPerformed: string[];
    tokensSent: number;
    estimatedWithoutBraincache: number;
    reductionPct: number;
    filesInContext: number;
  };
}

const BODY_STRIPPED_MARKER = '// [body stripped]';

/**
 * Computes token savings for a set of hops, mirroring the buildContext.ts savings pattern.
 * Returns zeros when hops is empty (no seed found).
 */
async function computeHopSavings(hops: TraceFlowResult['hops']): Promise<{
  tokensSent: number;
  estimatedWithoutBraincache: number;
  reductionPct: number;
  filesInContext: number;
}> {
  if (hops.length === 0) {
    return { tokensSent: 0, estimatedWithoutBraincache: 0, reductionPct: 0, filesInContext: 0 };
  }

  const tokensSent = hops.reduce((sum, h) => sum + countChunkTokens(h.content), 0);
  const uniqueFiles = [...new Set(hops.map(h => h.filePath))];
  const filesInContext = uniqueFiles.length;

  const filesWithUncompressedContent = new Set(
    hops
      .filter(h => !h.content.includes(BODY_STRIPPED_MARKER))
      .map(h => h.filePath)
  );

  let fileContentTokens = 0;
  for (const filePath of uniqueFiles) {
    if (!filesWithUncompressedContent.has(filePath)) continue;
    try {
      const fileContent = await readFile(filePath, 'utf-8');
      fileContentTokens += countChunkTokens(fileContent);
    } catch { /* file deleted since indexing */ }
  }

  const toolCalls = 1 + filesInContext;
  const toolCallOverhead = toolCalls * TOOL_CALL_OVERHEAD_TOKENS;
  const estimatedWithoutBraincache = fileContentTokens + toolCallOverhead;
  const reductionPct = estimatedWithoutBraincache > 0
    ? Math.max(0, Math.round((1 - tokensSent / estimatedWithoutBraincache) * 100))
    : 0;

  return { tokensSent, estimatedWithoutBraincache, reductionPct, filesInContext };
}

/**
 * Extracts a likely symbol name from a natural-language query.
 * Prefers camelCase tokens; falls back to the last non-stop-word identifier.
 * Returns null when no candidate is extractable.
 */
function extractSymbolCandidate(query: string): string | null {
  const tokens = query.match(/\b[a-zA-Z_][a-zA-Z0-9_]{2,}\b/g);
  if (!tokens) return null;

  const stopWords = new Set([
    'how', 'does', 'work', 'the', 'what', 'where', 'trace', 'flow',
    'call', 'path', 'find', 'show', 'into', 'from', 'this', 'that',
    'with', 'when', 'which', 'about', 'explain', 'describe',
  ]);

  // Prefer camelCase tokens (contain lowercase letter followed by uppercase)
  const camel = tokens.filter(t => /[a-z][A-Z]/.test(t));
  if (camel.length > 0) return camel[camel.length - 1];

  // Fall back to last non-stop-word token
  const nonStop = tokens.filter(t => !stopWords.has(t.toLowerCase()));
  return nonStop.length > 0 ? nonStop[nonStop.length - 1] : null;
}

/**
 * Runs a flow trace from an entrypoint symbol description.
 * Embeds the entrypoint query, finds a seed chunk, then performs BFS tracing
 * through call edges to produce a structured hops array.
 *
 * Returns an empty hops array when no seed chunk is found for the query.
 */
export async function runTraceFlow(
  entrypoint: string,
  opts?: TraceFlowOptions
): Promise<TraceFlowResult> {
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

  if (!tableNames.includes('edges')) {
    throw new Error("No edges table found. Re-run 'brain-cache index' to build call edges.");
  }
  const edgesTable = await db.openTable('edges');

  // 3. Load user config and resolve seed search strategy
  const userConfig = await loadUserConfig();
  const toolOverride: Partial<{ limit: number; distanceThreshold: number }> = {};
  if (opts?.limit !== undefined) toolOverride.limit = opts.limit;
  if (opts?.distanceThreshold !== undefined) toolOverride.distanceThreshold = opts.distanceThreshold;
  const strategy = resolveStrategy('trace', userConfig, Object.keys(toolOverride).length > 0 ? toolOverride : undefined);

  // 4. RET-03: Attempt exact SQL name lookup before embedding
  const candidate = extractSymbolCandidate(entrypoint);
  let seedChunkId: string | null = null;

  if (candidate !== null) {
    seedChunkId = await resolveSymbolToChunkId(table, candidate, '');
  }

  if (seedChunkId !== null) {
    // Exact match found — skip embedding entirely
    const maxHops = opts?.maxHops ?? 3;
    const flowHops = await traceFlow(edgesTable, table, seedChunkId, { maxHops });

    const hops = flowHops.map(hop => {
      const asChunk = {
        id: hop.chunkId,
        filePath: hop.filePath,
        chunkType: 'function' as const,
        scope: null,
        name: hop.name,
        content: hop.content,
        startLine: hop.startLine,
        endLine: hop.endLine,
        similarity: 1,
      };
      const compressed = compressChunk(asChunk);
      return {
        filePath: hop.filePath,
        name: hop.name,
        startLine: hop.startLine,
        content: compressed.content,
        callsFound: hop.callsFound,
        hopDepth: hop.hopDepth,
      };
    });

    return {
      hops,
      metadata: {
        seedChunkId,
        totalHops: hops.length,
        localTasksPerformed: ['exact_name_lookup', 'bfs_trace', 'compress'],
      },
    };
  }

  // 5. Fallback: Embed entrypoint query and seed search (pre-fix behavior)
  const { embeddings } = await embedBatchWithRetry(indexState.embeddingModel, [entrypoint]);
  const seedResults = await searchChunks(table, embeddings[0], strategy, entrypoint);
  const seeds = deduplicateChunks(seedResults);

  if (seeds.length === 0) {
    return {
      hops: [],
      metadata: {
        seedChunkId: null,
        totalHops: 0,
        localTasksPerformed: ['embed_query', 'seed_search'],
        tokensSent: 0,
        estimatedWithoutBraincache: 0,
        reductionPct: 0,
        filesInContext: 0,
      },
    };
  }

  // 6. BFS trace from first seed
  const maxHops = opts?.maxHops ?? 3;
  const flowHops = await traceFlow(edgesTable, table, seeds[0].id, { maxHops });

  // 7. Apply compression and map to output format
  const hops = flowHops.map(hop => {
    const asChunk = {
      id: hop.chunkId,
      filePath: hop.filePath,
      chunkType: 'function' as const,
      scope: null,
      name: hop.name,
      content: hop.content,
      startLine: hop.startLine,
      endLine: hop.endLine,
      similarity: 1,
    };
    const compressed = compressChunk(asChunk);
    return {
      filePath: hop.filePath,
      name: hop.name,
      startLine: hop.startLine,
      content: compressed.content,
      callsFound: hop.callsFound,
      hopDepth: hop.hopDepth,
    };
  });

  const savings = await computeHopSavings(hops);

  return {
    hops,
    metadata: {
      seedChunkId: seeds[0].id,
      totalHops: hops.length,
      localTasksPerformed: ['embed_query', 'seed_search', 'bfs_trace', 'compress'],
      ...savings,
    },
  };
}
