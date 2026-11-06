import type { Table } from '@lancedb/lancedb';
import { isOllamaRunning } from './ollama.js';
import { embedBatchWithRetry } from './embedder.js';
import {
  classifyRetrievalMode,
  RETRIEVAL_STRATEGIES,
  searchChunks,
  keywordSearchChunks,
} from './retriever.js';

export async function retrieveQuery(
  table: Table,
  embeddingModel: string,
  query: string,
  limit?: number,
) {
  const mode = classifyRetrievalMode(query);
  const strategy = { ...RETRIEVAL_STRATEGIES[mode], limit: limit ?? RETRIEVAL_STRATEGIES[mode].limit };
  if (!await isOllamaRunning()) {
    const chunks = await keywordSearchChunks(table, query, strategy.limit);
    return { chunks, mode, fallback: true };
  }

  const { embeddings } = await embedBatchWithRetry(embeddingModel, [query]);
  const chunks = await searchChunks(table, embeddings[0], strategy, query);
  return { chunks, mode, fallback: false };
}
