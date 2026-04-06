/**
 * Core configuration constants for brain-cache.
 *
 * All tunables live here so they're easy to find, test, and override later.
 */

// ── Paths ──────────────────────────────────────────────────────────────────
import { homedir } from "node:os";
import { join } from "node:path";

export const GLOBAL_CONFIG_DIR = join(homedir(), ".brain-cache");
export const PROFILE_PATH = join(GLOBAL_CONFIG_DIR, "profile.json");
export const CONFIG_PATH = join(GLOBAL_CONFIG_DIR, "config.json");
export const PROJECT_DATA_DIR = ".brain-cache";
export const SESSION_STATS_FILENAME = "session-stats.json";

// ── Embedding ──────────────────────────────────────────────────────────────
/** Maps each supported Ollama embedding model to its output vector dimension. */
export const EMBEDDING_DIMENSIONS: Record<string, number> = {
  'nomic-embed-text': 768,
  'mxbai-embed-large': 1024,
};
/** Fallback dimension used when a model is not listed in EMBEDDING_DIMENSIONS. */
export const DEFAULT_EMBEDDING_DIMENSION = 768;
export const DEFAULT_BATCH_SIZE = 50;
export const FILE_READ_CONCURRENCY = 20; // max parallel file reads during crawl
export const VECTOR_INDEX_THRESHOLD = 256; // rows needed before creating IVF_PQ index
export const EMBED_TIMEOUT_MS = 30_000; // per-batch timeout
export const COLD_START_RETRY_DELAY_MS = 2_000; // wait before retry on first Ollama call
export const EMBED_MAX_TOKENS = 8192; // nomic-embed-text context window
/** Max Anthropic tokens per doc chunk before paragraph sub-splitting (~2100 nomic tokens, under 8192). */
export const DOC_CHUNK_SIZE_THRESHOLD = 1500;

// ── Search defaults ────────────────────────────────────────────────────────
export const DEFAULT_SEARCH_LIMIT = 10;
export const DEFAULT_DISTANCE_THRESHOLD = 0.4; // cosine distance; 0.3 = 0.7 similarity
export const DEFAULT_TOKEN_BUDGET = 4096;
export const FILE_HASHES_FILENAME = "file-hashes.json";

// ── Token estimation ──────────────────────────────────────────────────────
/** Estimated token overhead per tool call (Grep/Glob/Read prompt + response framing) */
export const TOOL_CALL_OVERHEAD_TOKENS = 300;

// ── Compression ────────────────────────────────────────────────────────────
/**
 * Token threshold above which chunks are structurally compressed (signatures only).
 * Set conservatively high so that typical function bodies (30–120 lines) are kept
 * intact for high-relevance queries. Only very large chunks (e.g. generated files,
 * exhaustive switch statements) are compressed unconditionally.
 */
export const COMPRESSION_TOKEN_THRESHOLD = 500;

/**
 * Similarity threshold above which a chunk is considered "high relevance".
 * High-relevance chunks bypass compression even when they exceed
 * COMPRESSION_TOKEN_THRESHOLD, up to COMPRESSION_HARD_LIMIT tokens.
 */
export const HIGH_RELEVANCE_SIMILARITY_THRESHOLD = 0.85;

/**
 * Hard token limit: chunks exceeding this are always compressed, regardless
 * of similarity score. Guards against extremely large chunks consuming the
 * entire token budget.
 */
export const COMPRESSION_HARD_LIMIT = 800;
