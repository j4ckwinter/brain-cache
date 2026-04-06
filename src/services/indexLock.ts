import { readFile, writeFile, unlink, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { PROJECT_DATA_DIR } from '../lib/config.js';

const LOCK_FILENAME = 'index.lock';

function lockPath(projectRoot: string): string {
  return join(projectRoot, PROJECT_DATA_DIR, LOCK_FILENAME);
}

/**
 * Checks whether the process with the given PID is currently running.
 * Uses `process.kill(pid, 0)` which sends no signal but checks liveness.
 * - Returns false if process does not exist (ESRCH)
 * - Returns true if process exists (or EPERM — exists but we lack permission)
 */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: unknown) {
    if (err instanceof Error && (err as NodeJS.ErrnoException).code === 'ESRCH') {
      return false; // process does not exist
    }
    return true; // EPERM = process exists but we lack permission to signal it
  }
}

/**
 * Acquires an advisory PID lockfile for index operations on the given project root.
 *
 * - If no lockfile exists: creates one with the current PID.
 * - If lockfile exists with a live PID: throws immediately.
 * - If lockfile exists with a dead PID (stale): overwrites with current PID.
 *
 * @param projectRoot - The root directory of the project being indexed
 * @throws Error with "Another index operation is in progress. Try again later."
 */
export async function acquireIndexLock(projectRoot: string): Promise<void> {
  const lockFile = lockPath(projectRoot);
  try {
    const content = await readFile(lockFile, 'utf-8');
    const pid = parseInt(content.trim(), 10);
    if (!isNaN(pid) && isProcessAlive(pid)) {
      throw new Error('Another index operation is in progress. Try again later.');
    }
    // Stale lock — fall through to overwrite
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('Try again later')) {
      throw err; // Re-throw the "in progress" error
    }
    // ENOENT or parse error — no lock held, proceed
  }
  // Ensure .brain-cache dir exists before writing lockfile
  await mkdir(join(projectRoot, PROJECT_DATA_DIR), { recursive: true });
  await writeFile(lockFile, String(process.pid), 'utf-8');
}

/**
 * Releases the advisory PID lockfile for index operations on the given project root.
 * Safe to call even if the lockfile does not exist (no-op in that case).
 *
 * @param projectRoot - The root directory of the project being indexed
 */
export async function releaseIndexLock(projectRoot: string): Promise<void> {
  try {
    await unlink(lockPath(projectRoot));
  } catch {
    // Already gone — no-op
  }
}
