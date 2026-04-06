import { watch } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import ignore from 'ignore';
import { runIndex } from './index.js';
import { SOURCE_EXTENSIONS } from '../services/crawler.js';
import { childLogger } from '../services/logger.js';

const log = childLogger('watch');

// Paths to exclude at watch level (derived from ALWAYS_EXCLUDE_GLOBS in crawler.ts)
const EXCLUDED_PREFIXES = ['node_modules/', '.git/', 'dist/', 'build/', '.next/', '__pycache__/'];

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Determines whether a file change event should trigger a re-index.
 *
 * @param relativeFilename - Relative path from the watched root (as returned by fs.watch on Linux)
 * @param ig - ignore instance pre-loaded with .braincacheignore patterns
 * @returns true if the file should trigger re-indexing, false otherwise
 */
export function shouldProcess(relativeFilename: string, ig: ReturnType<typeof ignore>): boolean {
  if (!relativeFilename) return false;

  // Extension check — naturally excludes .brain-cache/ writes (.json, .lock extensions)
  const ext = extname(relativeFilename);
  if (!SOURCE_EXTENSIONS.has(ext)) return false;

  // Path prefix check — excludes node_modules/**.ts and similar
  for (const prefix of EXCLUDED_PREFIXES) {
    if (relativeFilename.startsWith(prefix)) return false;
  }

  // .braincacheignore check — wrap in try/catch since ignore throws for paths starting with ../
  try {
    if (ig.ignores(relativeFilename)) return false;
  } catch {
    // Defensive: if ignore throws, default to processing the file
    return true;
  }

  return true;
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
 * Schedules a re-index with a 500ms debounce window (D-03).
 * Rapid calls within the window collapse into a single runIndex invocation.
 *
 * @internal
 */
function scheduleReindex(rootDir: string): void {
  if (debounceTimer !== null) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(async () => {
    debounceTimer = null;
    await triggerReindex(rootDir);
  }, 500);
}

/**
 * Executes a single re-index cycle, suppressing runIndex stderr output and
 * emitting a compact summary line (D-06, D-07, D-08).
 *
 * @internal
 */
async function triggerReindex(rootDir: string): Promise<void> {
  // Capture stderr to suppress runIndex progress output (D-06)
  // Must capture BEFORE calling runIndex — runIndex restores its own patch in finally,
  // leaving process.stderr.write as the original once it returns.
  const originalWrite = process.stderr.write.bind(process.stderr);
  const captured: string[] = [];

  process.stderr.write = (
    chunk: string | Uint8Array,
    encodingOrCb?: BufferEncoding | ((err?: Error | null) => void),
    cb?: (err?: Error | null) => void,
  ): boolean => {
    captured.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk as Uint8Array).toString('utf-8'));
    const callback = typeof encodingOrCb === 'function' ? encodingOrCb : cb;
    callback?.(null);
    return true;
  };

  const start = Date.now();
  try {
    await runIndex(rootDir);
    process.stderr.write = originalWrite;
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    const summary = buildSummary(captured, elapsed);
    process.stderr.write(`${summary}\n`);
  } catch (err) {
    process.stderr.write = originalWrite;
    if (err instanceof Error && err.message.includes('Try again later')) {
      // D-07/D-08: lock held by concurrent indexer — skip and log
      process.stderr.write('brain-cache: Index in progress, skipping (will retry on next change)\n');
      return;
    }
    log.error({ err }, 'Re-index failed');
  }
}

/**
 * Runs the brain-cache file watcher.
 *
 * Monitors `targetPath` (or cwd) with Node.js `fs.watch` (recursive mode),
 * debounces file changes at 500ms, filters by SOURCE_EXTENSIONS + excluded
 * path prefixes + .braincacheignore, calls `runIndex()` on debounce fire,
 * catches lock contention to skip-and-log, suppresses runIndex stderr output
 * and prints compact summaries, and handles graceful shutdown via SIGINT/SIGTERM.
 *
 * @param targetPath - Directory to watch (defaults to current directory)
 */
export async function runWatch(targetPath?: string): Promise<void> {
  const rootDir = resolve(targetPath ?? '.');

  // Load .braincacheignore once at startup (D-04)
  const ig = ignore();
  try {
    const ignoreContent = await readFile(join(rootDir, '.braincacheignore'), 'utf-8');
    ig.add(ignoreContent);
  } catch {
    // No .braincacheignore — skip
  }

  // Startup banner (D-05)
  process.stderr.write(
    `brain-cache: watching ${rootDir}\n` +
    `  debounce: 500ms\n` +
    `  extensions: ${[...SOURCE_EXTENSIONS].join(', ')}\n`
  );

  const watcher = watch(rootDir, { recursive: true, persistent: true }, (eventType, filename) => {
    if (!filename) return;
    if (!shouldProcess(filename, ig)) return;
    scheduleReindex(rootDir);
  });

  watcher.on('error', (err) => log.error({ err }, 'watcher error'));

  // Graceful shutdown (D-01 — no persistent timers blocking exit)
  const cleanup = (): void => {
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
