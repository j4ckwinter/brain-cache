// Source content of src/scripts/statusline.mjs
// This string must stay in sync with src/scripts/statusline.mjs
export const STATUSLINE_SCRIPT_CONTENT = `#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const STATS_PATH = join(homedir(), '.brain-cache', 'session-stats.json');
const STATS_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours — must match sessionStats.ts STATS_TTL_MS
export const IDLE_OUTPUT = '\\ud83e\\udde0 brain-cache \\u2192 idle\\n';

/**
 * Formats a token count into a human-readable string.
 * - < 1000: plain number (e.g. "500")
 * - >= 1000 and < 1,000,000: rounded k suffix (e.g. "2k")
 * - >= 1,000,000: M suffix with one decimal (e.g. "1.5M")
 *
 * @param {number} n
 * @returns {string}
 */
export function formatTokenCount(n) {
  if (n >= 1_000_000) return \`\${(n / 1_000_000).toFixed(1)}M\`;
  if (n >= 1_000) return \`\${Math.round(n / 1_000)}k\`;
  return String(n);
}

/**
 * Reads and validates stats from a given file path.
 * Returns null if the file does not exist, is malformed, has no lastUpdatedAt,
 * is older than STATS_TTL_MS, or has estimatedWithoutBraincache <= 0.
 *
 * @param {string} filePath
 * @returns {import('../services/sessionStats.js').SessionStats | null}
 */
export function _readStatsFromPath(filePath) {
  try {
    const raw = readFileSync(filePath, 'utf-8');
    const stats = JSON.parse(raw);
    if (!stats.lastUpdatedAt) return null;
    const age = Date.now() - Date.parse(stats.lastUpdatedAt);
    if (age > STATS_TTL_MS) return null;
    if (!stats.estimatedWithoutBraincache || stats.estimatedWithoutBraincache <= 0) return null;
    return stats;
  } catch {
    return null;
  }
}

/**
 * Reads session stats from the default stats path (~/.brain-cache/session-stats.json).
 * Returns null if the file does not exist, is invalid, or is expired.
 *
 * @returns {import('../services/sessionStats.js').SessionStats | null}
 */
export function readStats() {
  return _readStatsFromPath(STATS_PATH);
}

/**
 * Renders the status line output string.
 * Returns IDLE_OUTPUT when stats is null, savings <= 0, or pct <= 0.
 * Otherwise returns a formatted savings string.
 *
 * @param {import('../services/sessionStats.js').SessionStats | null} stats
 * @returns {string}
 */
export function renderOutput(stats) {
  if (!stats) return IDLE_OUTPUT;
  const saved = stats.estimatedWithoutBraincache - stats.tokensSent;
  // Cap at 98% — same as per-response token savings (avoids misleading 99–100%).
  const pct = Math.min(
    98,
    Math.round((1 - stats.tokensSent / stats.estimatedWithoutBraincache) * 100),
  );
  if (pct <= 0 || saved <= 0) return IDLE_OUTPUT;

  let line = \`\\ud83e\\udde0 brain-cache \\u2192 saved \${formatTokenCount(saved)} tokens (\${pct}% less)\`;

  // Append last-call savings when available
  if (stats.lastEstimatedWithoutBraincache > 0 && stats.lastTokensSent >= 0) {
    const lastSaved = stats.lastEstimatedWithoutBraincache - stats.lastTokensSent;
    if (lastSaved > 0) {
      line += \` \\u00b7 last: \${formatTokenCount(lastSaved)}\`;
    }
  }

  return line + '\\n';
}

// Stdin/stdout protocol — only when executed directly (not imported for testing)
if (import.meta.url === \`file://\${process.argv[1]}\`) {
  const stdinTimeout = setTimeout(() => process.exit(0), 3000);
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { input += chunk; });
  process.stdin.on('end', () => {
    clearTimeout(stdinTimeout);
    try {
      const stats = readStats();
      process.stdout.write(renderOutput(stats));
    } catch {
      process.stdout.write(IDLE_OUTPUT);
    }
  });
}
`;
