import { readFile } from 'node:fs/promises';
import { CONFIG_PATH } from '../lib/config.js';
import { RETRIEVAL_STRATEGIES } from './retriever.js';
import type { QueryIntent, SearchOptions } from '../lib/types.js';
import { childLogger } from './logger.js';

const log = childLogger('configLoader');

export interface UserConfig {
  retrieval?: {
    lookup?: Partial<SearchOptions>;
    trace?: Partial<SearchOptions>;
    explore?: Partial<SearchOptions>;
  };
  stats?: {
    /** Default: 2. Session stats older than this many hours reset on next accumulation. */
    ttlHours?: number;
  };
}

/**
 * Reads ~/.brain-cache/config.json on every call (no caching).
 * Returns {} when file is missing or contains invalid JSON.
 */
export async function loadUserConfig(): Promise<UserConfig> {
  try {
    const raw = await readFile(CONFIG_PATH, 'utf-8');
    return JSON.parse(raw) as UserConfig;
  } catch {
    log.debug({ configPath: CONFIG_PATH }, 'Config file not found or invalid — using defaults');
    return {};
  }
}

/**
 * Merges retrieval strategy with precedence: defaults < user config < tool override.
 */
export function resolveStrategy(
  mode: QueryIntent,
  userConfig: UserConfig,
  toolOverride?: Partial<SearchOptions>
): SearchOptions {
  const base = RETRIEVAL_STRATEGIES[mode];
  const userOverride = userConfig.retrieval?.[mode] ?? {};
  return { ...base, ...userOverride, ...toolOverride };
}
