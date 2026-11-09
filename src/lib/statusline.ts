import { readFileSync } from 'node:fs';
import type { SessionStats } from '../services/sessionStats.js';

export const IDLE_OUTPUT = '🧠 brain-cache → idle\n';
export const STATS_TTL_MS = 2 * 60 * 60 * 1000;

export function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

export function _readStatsFromPath(filePath: string): SessionStats | null {
  try {
    const stats = JSON.parse(readFileSync(filePath, 'utf8')) as SessionStats;
    if (!stats.lastUpdatedAt || Date.now() - Date.parse(stats.lastUpdatedAt) > STATS_TTL_MS) return null;
    if (!stats.estimatedWithoutBraincache || stats.estimatedWithoutBraincache <= 0) return null;
    return stats;
  } catch {
    return null;
  }
}

export function renderOutput(stats: SessionStats | null): string {
  if (!stats) return IDLE_OUTPUT;
  const saved = stats.estimatedWithoutBraincache - stats.tokensSent;
  const pct = Math.min(98, Math.round((1 - stats.tokensSent / stats.estimatedWithoutBraincache) * 100));
  if (pct <= 0 || saved <= 0) return IDLE_OUTPUT;
  let line = `🧠 brain-cache → est. saved ${formatTokenCount(saved)} tokens (${pct}% less)`;
  if (stats.lastEstimatedWithoutBraincache > 0 && stats.lastTokensSent >= 0) {
    const lastSaved = stats.lastEstimatedWithoutBraincache - stats.lastTokensSent;
    if (lastSaved > 0) line += ` · last: ${formatTokenCount(lastSaved)}`;
  }
  return `${line}\n`;
}

