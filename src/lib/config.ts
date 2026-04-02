import { homedir } from 'node:os';
import { join } from 'node:path';

export const GLOBAL_CONFIG_DIR = join(homedir(), '.brain-cache');
export const PROFILE_PATH = join(GLOBAL_CONFIG_DIR, 'profile.json');
export const CONFIG_PATH = join(GLOBAL_CONFIG_DIR, 'config.json');
export const PROJECT_DATA_DIR = '.brain-cache';

export const EMBEDDING_DIMENSIONS: Record<string, number> = {
  'nomic-embed-text': 768,
  'mxbai-embed-large': 1024,
};
export const DEFAULT_BATCH_SIZE = 32;
export const FILE_READ_CONCURRENCY = 20;
export const VECTOR_INDEX_THRESHOLD = 10_000;
export const EMBED_TIMEOUT_MS = 120_000;
export const COLD_START_RETRY_DELAY_MS = 5_000;
// Maximum tokens per chunk sent to the embedding model.
// nomic-embed-text in Ollama uses the llama.cpp backend, which caps the context
// at the model's training length of 2048 tokens (BERT tokenizer), not the 8192
// advertised by the HuggingFace model card.
// We guard using the Anthropic tokenizer, which produces ~0.7x fewer tokens than
// BERT for code. A safe Anthropic-token limit that stays under 2048 BERT tokens:
//   2048 * 0.7 ≈ 1433 → use 1400 with extra margin.
// truncate: true in ollama.embed() provides a hard safety net regardless.
export const EMBED_MAX_TOKENS = 1400;
export const DEFAULT_SEARCH_LIMIT = 10;
export const DEFAULT_DISTANCE_THRESHOLD = 0.3; // cosine distance; 0.3 = 0.7 similarity
export const DIAGNOSTIC_DISTANCE_THRESHOLD = 0.4; // looser for diagnostic queries (0.6 similarity)
export const DIAGNOSTIC_SEARCH_LIMIT = 20;
export const DEFAULT_TOKEN_BUDGET = 4096;
export const FILE_HASHES_FILENAME = 'file-hashes.json';
