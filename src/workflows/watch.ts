import { resolve, join } from 'node:path';
import { open, unlink, mkdir } from 'node:fs/promises';
import { createWatcher } from '../services/fileWatcher.js';
import { runIndex } from './index.js';

// Module-level debounce state (exported for testing)
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
const pendingFiles = new Set<string>();

/**
 * Resets module-level debounce state. Used in tests.
 */
export function resetState(): void {
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  pendingFiles.clear();
}

/**
 * Attempts to acquire a cross-process index lock using O_EXCL file creation.
 * Returns true if the lock was acquired, false if another process holds it.
 */
export async function acquireIndexLock(projectRoot: string): Promise<boolean> {
  const lockPath = join(projectRoot, '.brain-cache', '.indexing');
  await mkdir(join(projectRoot, '.brain-cache'), { recursive: true });
  try {
    const handle = await open(lockPath, 'wx');
    await handle.close();
    return true;
  } catch {
    return false;
  }
}

/**
 * Releases the cross-process index lock by removing the lock file.
 */
export async function releaseIndexLock(projectRoot: string): Promise<void> {
  await unlink(join(projectRoot, '.brain-cache', '.indexing')).catch(() => undefined);
}

/**
 * Accumulates changed file paths and schedules a debounced re-index.
 * Multiple calls within 500ms coalesce into a single runIndex call.
 */
export function scheduleReindex(filePath: string, eventType: string, projectRoot: string): void {
  process.stderr.write(`brain-cache: ${eventType} ${filePath}\n`);
  pendingFiles.add(filePath);

  if (debounceTimer !== null) {
    clearTimeout(debounceTimer);
  }

  debounceTimer = setTimeout(async () => {
    debounceTimer = null;
    pendingFiles.clear();

    const locked = await acquireIndexLock(projectRoot);
    if (!locked) {
      process.stderr.write('brain-cache: skipping reindex — another index process is running\n');
      return;
    }

    try {
      await runIndex(projectRoot);
    } finally {
      await releaseIndexLock(projectRoot);
    }
  }, 500);
}

/**
 * Starts the file watcher and keeps the process alive until SIGINT/SIGTERM.
 */
export async function runWatch(targetPath?: string): Promise<void> {
  const rootDir = resolve(targetPath ?? '.');

  process.stderr.write(`brain-cache: watching ${rootDir}\n`);

  const watcher = await createWatcher(rootDir);

  watcher.on('add', (fp: string) => scheduleReindex(fp, 'add', rootDir));
  watcher.on('change', (fp: string) => scheduleReindex(fp, 'change', rootDir));
  watcher.on('unlink', (fp: string) => scheduleReindex(fp, 'unlink', rootDir));
  watcher.on('addDir', (fp: string) => scheduleReindex(fp, 'addDir', rootDir));
  watcher.on('unlinkDir', (fp: string) => scheduleReindex(fp, 'unlinkDir', rootDir));

  watcher.on('error', (err: unknown) => {
    process.stderr.write(`brain-cache: watcher error: ${String(err)}\n`);
  });

  watcher.on('ready', () => {
    process.stderr.write('brain-cache: watcher ready\n');
  });

  const cleanup = async () => {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    pendingFiles.clear();
    await watcher.close();
    process.exit(0);
  };

  process.once('SIGINT', cleanup);
  process.once('SIGTERM', cleanup);

  // Keep process alive
  await new Promise<never>(() => {});
}
