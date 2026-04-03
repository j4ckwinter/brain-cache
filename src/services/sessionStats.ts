import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { GLOBAL_CONFIG_DIR, SESSION_STATS_FILENAME } from '../lib/config.js';
import { loadUserConfig } from './configLoader.js';
import { childLogger } from './logger.js';

const log = childLogger('sessionStats');

// ── Constants ──────────────────────────────────────────────────────────────

export const SESSION_STATS_PATH = join(GLOBAL_CONFIG_DIR, SESSION_STATS_FILENAME);

/** Default TTL: 2 hours. Configurable via stats.ttlHours in ~/.brain-cache/config.json. */
export const STATS_TTL_MS = 2 * 60 * 60 * 1000;

// ── Types ──────────────────────────────────────────────────────────────────

export interface StatsDelta {
  tokensSent: number;
  estimatedWithoutBraincache: number;
}

export interface SessionStats {
  tokensSent: number;
  estimatedWithoutBraincache: number;
  callCount: number;
  lastUpdatedAt: string;
}

// ── Mutex ──────────────────────────────────────────────────────────────────

let _statsMutex: Promise<void> = Promise.resolve();

// @internal — test use only
export function _resetMutexForTesting(): void {
  _statsMutex = Promise.resolve();
}

// ── Internal helpers ───────────────────────────────────────────────────────

async function _readStats(): Promise<SessionStats | null> {
  try {
    const raw = await readFile(SESSION_STATS_PATH, 'utf-8');
    return JSON.parse(raw) as SessionStats;
  } catch {
    return null;
  }
}

async function _doAccumulate(delta: StatsDelta, ttlMs?: number): Promise<void> {
  await mkdir(GLOBAL_CONFIG_DIR, { recursive: true });

  // Resolve effective TTL.
  let effectiveTtlMs: number;
  if (ttlMs !== undefined) {
    effectiveTtlMs = ttlMs;
  } else {
    try {
      const config = await loadUserConfig();
      const ttlHours = config.stats?.ttlHours;
      effectiveTtlMs = ttlHours !== undefined ? ttlHours * 60 * 60 * 1000 : STATS_TTL_MS;
    } catch {
      effectiveTtlMs = STATS_TTL_MS;
    }
  }

  const existing = await _readStats();
  const now = Date.now();
  const isExpired =
    existing === null ||
    now - Date.parse(existing.lastUpdatedAt) > effectiveTtlMs;

  const base = isExpired
    ? { tokensSent: 0, estimatedWithoutBraincache: 0, callCount: 0 }
    : existing;

  const updated: SessionStats = {
    tokensSent: base.tokensSent + delta.tokensSent,
    estimatedWithoutBraincache: base.estimatedWithoutBraincache + delta.estimatedWithoutBraincache,
    callCount: base.callCount + 1,
    lastUpdatedAt: new Date(now).toISOString(),
  };

  const tmpPath = SESSION_STATS_PATH + '.tmp';
  await writeFile(tmpPath, JSON.stringify(updated, null, 2), 'utf-8');
  await rename(tmpPath, SESSION_STATS_PATH);
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Accumulates token savings stats to ~/.brain-cache/session-stats.json.
 *
 * Uses a module-level mutex to serialize concurrent calls — no overwrite on
 * concurrent fire-and-forget usage. Errors are swallowed so callers never need
 * to handle failures.
 *
 * @param delta   Token counts for this tool call.
 * @param ttlMs   Optional TTL override in milliseconds (for testing). When absent,
 *                reads `stats.ttlHours` from ~/.brain-cache/config.json (default 2h).
 */
export function accumulateStats(delta: StatsDelta, ttlMs?: number): Promise<void> {
  const next = _statsMutex.then(() =>
    _doAccumulate(delta, ttlMs).catch((err: unknown) => {
      log.warn({ err }, 'stats accumulation failed');
    })
  );
  // Always advance mutex regardless of success/failure — prevents deadlock.
  _statsMutex = next.then(() => undefined, () => undefined);
  return next;
}
