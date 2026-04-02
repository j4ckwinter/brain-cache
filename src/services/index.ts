// Services barrel — re-exports primary service APIs
export {
  readProfile,
  writeProfile,
  detectCapabilities,
  classifyVRAMTier,
  selectEmbeddingModel,
} from './capability.js';

export { chunkFile } from './chunker.js';

export { crawlSourceFiles, SOURCE_EXTENSIONS } from './crawler.js';

export { loadIgnorePatterns } from './ignorePatterns.js';

export { embedBatchWithRetry } from './embedder.js';

export {
  openDatabase,
  openOrCreateChunkTable,
  insertChunks,
  readIndexState,
  writeIndexState,
  createVectorIndexIfNeeded,
  readFileHashes,
  writeFileHashes,
  deleteChunksByFilePath,
  chunkSchema,
  type ChunkRow,
} from './lancedb.js';

export { logger, childLogger } from './logger.js';

export {
  isOllamaInstalled,
  isOllamaRunning,
  startOllama,
  pullModelIfMissing,
  getOllamaVersion,
  getOllamaHost,
} from './ollama.js';

export {
  classifyQueryIntent,
  searchChunks,
  deduplicateChunks,
  RETRIEVAL_STRATEGIES,
} from './retriever.js';

export { countChunkTokens, assembleContext, formatChunk } from './tokenCounter.js';
