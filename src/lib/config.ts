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
export const EMBED_TIMEOUT_MS = 120_000;
export const COLD_START_RETRY_DELAY_MS = 5_000;
