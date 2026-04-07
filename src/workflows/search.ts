import { resolve } from "node:path";
import { requireProfile } from "../lib/guards.js";
import { isOllamaRunning } from "../services/ollama.js";
import { getConnection, readIndexState } from "../services/lancedb.js";
import { NoIndexError } from "../lib/errors.js";
import { embedBatchWithRetry } from "../services/embedder.js";
import {
  searchChunks,
  deduplicateChunks,
  classifyRetrievalMode,
  RETRIEVAL_STRATEGIES,
  keywordSearchChunks,
} from "../services/retriever.js";
import type { RetrievedChunk, SearchOptions } from "../lib/types.js";

export interface SearchRunOptions {
  limit?: number;
  path?: string;
}

export interface SearchResult {
  chunks: RetrievedChunk[];
  fallback: boolean;
}

export async function runSearch(
  query: string,
  opts?: SearchRunOptions,
): Promise<SearchResult> {
  await requireProfile();
  const ollamaAvailable = await isOllamaRunning();

  const rootDir = resolve(opts?.path ?? ".");
  const indexState = await readIndexState(rootDir);
  if (indexState === null) {
    throw new NoIndexError(rootDir);
  }

  const db = await getConnection(rootDir);
  const tableNames = await db.tableNames();
  if (!tableNames.includes("chunks")) {
    throw new Error("No chunks table found. Run 'brain-cache index' first.");
  }
  const table = await db.openTable("chunks");

  const rowCount = await table.countRows();
  if (rowCount === 0) {
    throw new Error(
      `Index is empty at ${rootDir}. No source files were indexed.`,
    );
  }

  if (!ollamaAvailable) {
    process.stderr.write(
      "brain-cache: [FALLBACK] Ollama is unavailable. Using keyword search — results may be less relevant.\n",
    );
    const mode = classifyRetrievalMode(query);
    const limit = opts?.limit ?? RETRIEVAL_STRATEGIES[mode].limit;
    const results = await keywordSearchChunks(table, query, limit);
    const deduped = deduplicateChunks(results);

    process.stderr.write(
      `brain-cache: found ${deduped.length} chunks via keyword fallback\n`,
    );

    return { chunks: deduped, fallback: true };
  }

  const mode = classifyRetrievalMode(query);
  const strategy: SearchOptions = {
    limit: opts?.limit ?? RETRIEVAL_STRATEGIES[mode].limit,
    distanceThreshold: RETRIEVAL_STRATEGIES[mode].distanceThreshold,
    keywordBoostWeight: RETRIEVAL_STRATEGIES[mode].keywordBoostWeight,
  };

  process.stderr.write(
    `brain-cache: searching (mode=${mode}, limit=${strategy.limit})\n`,
  );

  const { embeddings: vectors } = await embedBatchWithRetry(indexState.embeddingModel, [query]);
  const queryVector = vectors[0];

  const results = await searchChunks(table, queryVector, strategy, query);
  const deduped = deduplicateChunks(results);

  process.stderr.write(
    `brain-cache: found ${deduped.length} chunks (${results.length} before dedup)\n`,
  );
  for (const chunk of deduped) {
    process.stderr.write(
      `  ${chunk.similarity.toFixed(3)} ${chunk.filePath}:${chunk.startLine}-${chunk.endLine} [${chunk.chunkType}] ${chunk.name ?? ""}\n`,
    );
  }

  return { chunks: deduped, fallback: false };
}
