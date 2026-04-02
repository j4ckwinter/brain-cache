// Lib barrel — re-exports all public types and config
export {
  GLOBAL_CONFIG_DIR,
  PROFILE_PATH,
  CONFIG_PATH,
  PROJECT_DATA_DIR,
  EMBEDDING_DIMENSIONS,
  DEFAULT_EMBEDDING_DIMENSION,
  DEFAULT_BATCH_SIZE,
  FILE_READ_CONCURRENCY,
  VECTOR_INDEX_THRESHOLD,
  EMBED_TIMEOUT_MS,
  COLD_START_RETRY_DELAY_MS,
  EMBED_MAX_TOKENS,
  DEFAULT_SEARCH_LIMIT,
  DEFAULT_DISTANCE_THRESHOLD,
  DEFAULT_TOKEN_BUDGET,
  FILE_HASHES_FILENAME,
} from './config.js';

export {
  type VRAMTier,
  CapabilityProfileSchema,
  type CapabilityProfile,
  CodeChunkSchema,
  type CodeChunk,
  IndexStateSchema,
  type IndexState,
  type QueryIntent,
  type SearchOptions,
  type RetrievedChunk,
  type ContextMetadata,
  type ContextResult,
  type FlowHop,
} from './types.js';

export { formatTokenSavings, type TokenSavingsInput } from './format.js';
