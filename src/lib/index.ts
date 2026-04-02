// Lib barrel — re-exports all public types and config
export {
  GLOBAL_CONFIG_DIR,
  PROFILE_PATH,
  CONFIG_PATH,
  PROJECT_DATA_DIR,
  EMBEDDING_DIMENSIONS,
  DEFAULT_BATCH_SIZE,
  EMBED_TIMEOUT_MS,
  COLD_START_RETRY_DELAY_MS,
  DEFAULT_SEARCH_LIMIT,
  DEFAULT_DISTANCE_THRESHOLD,
  DIAGNOSTIC_DISTANCE_THRESHOLD,
  DIAGNOSTIC_SEARCH_LIMIT,
  DEFAULT_TOKEN_BUDGET,
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
} from './types.js';

export { formatTokenSavings, type TokenSavingsInput } from './format.js';
