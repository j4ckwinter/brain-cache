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

// ── Embedding ──────────────────────────────────────────────────────────────
export const EMBEDDING_DIMENSIONS = 768; // nomic-embed-text default
export const DEFAULT_BATCH_SIZE = 50;
export const FILE_READ_CONCURRENCY = 20; // max parallel file reads during crawl
export const VECTOR_INDEX_THRESHOLD = 256; // rows needed before creating IVF_PQ index
export const EMBED_TIMEOUT_MS = 30_000; // per-batch timeout
export const COLD_START_RETRY_DELAY_MS = 2_000; // wait before retry on first Ollama call
export const EMBED_MAX_TOKENS = 8192; // nomic-embed-text context window

// ── Search defaults ────────────────────────────────────────────────────────
export const DEFAULT_SEARCH_LIMIT = 10;
export const DEFAULT_DISTANCE_THRESHOLD = 0.4; // cosine distance; 0.3 = 0.7 similarity
export const DIAGNOSTIC_DISTANCE_THRESHOLD = 0.45; // looser for diagnostic queries (0.6 similarity)
export const DIAGNOSTIC_SEARCH_LIMIT = 20;
export const DEFAULT_TOKEN_BUDGET = 4096;
export const FILE_HASHES_FILENAME = "file-hashes.json";
