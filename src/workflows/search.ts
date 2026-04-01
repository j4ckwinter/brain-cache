import { resolve } from "node:path";
import { readProfile } from "../services/capability.js";
import { isOllamaRunning } from "../services/ollama.js";
import { openDatabase, readIndexState } from "../services/lancedb.js";
import { embedBatchWithRetry } from "../services/embedder.js";
import {
  searchChunks,
  deduplicateChunks,
  classifyQueryIntent,
  RETRIEVAL_STRATEGIES,
} from "../services/retriever.js";
import type { RetrievedChunk, SearchOptions } from "../lib/types.js";

export interface SearchRunOptions {
  limit?: number;
  path?: string;
}

export async function runSearch(
  query: string,
  opts?: SearchRunOptions,
): Promise<RetrievedChunk[]> {
  // 1. Read profile
  const profile = await readProfile();
  if (profile === null) {
    throw new Error("No profile found. Run 'brain-cache init' first.");
  }

  // 2. Check Ollama
  const running = await isOllamaRunning();
  if (!running) {
    throw new Error(
      "Ollama is not running. Start it with 'ollama serve' or run 'brain-cache init'.",
    );
  }

  // 3. Resolve project root and read index state
  const rootDir = resolve(opts?.path ?? ".");
  const indexState = await readIndexState(rootDir);
  if (indexState === null) {
    throw new Error(
      `No index found at ${rootDir}. Run 'brain-cache index' first.`,
    );
  }

  // 4. Open database and table
  const db = await openDatabase(rootDir);
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

  // 5. Classify intent and determine search strategy
  const intent = classifyQueryIntent(query);
  const strategy: SearchOptions = {
    limit: opts?.limit ?? RETRIEVAL_STRATEGIES[intent].limit,
    distanceThreshold: RETRIEVAL_STRATEGIES[intent].distanceThreshold,
  };

  process.stderr.write(
    `brain-cache: searching (intent=${intent}, limit=${strategy.limit})\n`,
  );

  // 6. Embed the query using the model from index state (not profile — prevents mismatch)
  const vectors = await embedBatchWithRetry(indexState.embeddingModel, [query]);
  const queryVector = vectors[0];

  // 7. Search and deduplicate
  const results = await searchChunks(table, queryVector, strategy);
  const deduped = deduplicateChunks(results);

  // 8. Print results summary to stderr
  process.stderr.write(
    `brain-cache: found ${deduped.length} chunks (${results.length} before dedup)\n`,
  );
  for (const chunk of deduped) {
    process.stderr.write(
      `  ${chunk.similarity.toFixed(3)} ${chunk.filePath}:${chunk.startLine}-${chunk.endLine} [${chunk.chunkType}] ${chunk.name ?? ""}\n`,
    );
  }

  return deduped;
}
