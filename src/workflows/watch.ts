import { watch } from 'node:fs';
import { resolve } from 'node:path';
import type ignore from 'ignore';
import { IndexLockedError } from '../services/indexLock.js';
import { runIndex } from './index.js';
import { SOURCE_EXTENSIONS, IGNORE_FILENAMES, isEligibleSourcePath, loadSourceIgnore } from '../services/filePolicy.js';
import { childLogger } from '../services/logger.js';
import { withStderrFilter } from '../lib/stderr.js';

const log = childLogger('watch');

export function shouldProcess(relativeFilename: string, ig: ReturnType<typeof ignore>): boolean {
  return isEligibleSourcePath(relativeFilename, ig);
}

/**
 * Builds a compact one-liner summary from captured runIndex stderr output.
 *
 * @param lines - Captured stderr lines from runIndex execution
 * @param elapsed - Elapsed time in seconds (e.g. "1.2")
 * @returns Compact summary string for terminal output
 */
export function buildSummary(lines: string[], elapsed: string): string {
  const statsLine = lines.find(l => l.includes('incremental index --'));
  if (statsLine) {
    const match = statsLine.match(/(\d+ new, \d+ changed, \d+ removed)/);
    if (match) {
      return `brain-cache: re-indexed (${match[1]}) in ${elapsed}s`;
    }
  }
  return `brain-cache: re-indexed in ${elapsed}s`;
}

/**
 * Executes a single re-index cycle, suppressing runIndex stderr output and
 * emitting a compact summary line (D-06, D-07, D-08).
 *
 * @internal
 */
async function triggerReindex(rootDir: string): Promise<boolean> {
  const captured: string[] = [];
  const start = Date.now();
  try {
    await withStderrFilter(
      (line) => { captured.push(line); return true; },
      () => runIndex(rootDir),
    );
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    const summary = buildSummary(captured, elapsed);
    process.stderr.write(`${summary}\n`);
    return true;
  } catch (err) {
    if (err instanceof IndexLockedError) {
      // Keep the pending change until the other writer releases its lock.
      process.stderr.write('brain-cache: Index in progress, retrying shortly\n');
      return false;
    }
    log.error({ err }, 'Re-index failed');
    return true;
  }
}

/**
 * Runs the brain-cache file watcher.
 *
 * Monitors `targetPath` (or cwd) with Node.js `fs.watch` (recursive mode),
 * debounces file changes at 500ms, applies the crawler file policy,
 * calls `runIndex()` on debounce fire,
 * retries lock contention, suppresses runIndex stderr output
 * and prints compact summaries, and handles graceful shutdown via SIGINT/SIGTERM.
 *
 * @param targetPath - Directory to watch (defaults to current directory)
 */
export async function runWatch(targetPath?: string): Promise<void> {
  const rootDir = resolve(targetPath ?? '.');
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let pending = false;
  let stopped = false;

  function scheduleReindex(): void {
    if (stopped) return;
    pending = true;
    if (running) return;
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      debounceTimer = null;
      if (stopped) return;
      pending = false;
      running = true;
      try {
        if (!await triggerReindex(rootDir)) pending = true;
      } finally {
        running = false;
        if (pending && !stopped) scheduleReindex();
      }
    }, 500);
  }


  let ig = await loadSourceIgnore(rootDir);

  // Startup banner (D-05)
  process.stderr.write(
    `brain-cache: watching ${rootDir}\n` +
    `  debounce: 500ms\n` +
    `  extensions: ${[...SOURCE_EXTENSIONS].join(', ')}\n`
  );

  const watcher = watch(rootDir, { recursive: true, persistent: true }, (_eventType, filename) => {
    if (!filename) return;
    if (IGNORE_FILENAMES.includes(filename)) {
      void loadSourceIgnore(rootDir).then(next => {
        ig = next;
        scheduleReindex();
      }).catch(err => log.error({ err }, 'Could not reload ignore rules'));
      return;
    }
    if (!shouldProcess(filename, ig)) return;
    scheduleReindex();
  });

  watcher.on('error', (err) => log.error({ err }, 'watcher error'));

  // Graceful shutdown (D-01 — no persistent timers blocking exit)
  const cleanup = (): void => {
    stopped = true;
    process.stderr.write('\nbrain-cache: stopping watcher\n');
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    watcher.close();
    process.exit(0);
  };
  process.once('SIGINT', cleanup);
  process.once('SIGTERM', cleanup);

  // Keep process alive
  await new Promise<never>(() => {});
}
