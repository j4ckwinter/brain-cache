import { readFile, writeFile, unlink, mkdir, rmdir, link } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PROJECT_DATA_DIR } from '../lib/config.js';

const owners = new Map<string, string>();

export class IndexLockedError extends Error {
  constructor(message = 'Another index operation is in progress. Try again later.') {
    super(message);
    this.name = 'IndexLockedError';
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

async function readOwner(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

async function acquireLock(path: string): Promise<void> {
  const directory = dirname(path);
  const token = `${process.pid} ${randomUUID()}`;
  const candidate = `${path}.${randomUUID()}`;
  await mkdir(directory, { recursive: true });
  await writeFile(candidate, token, { flag: 'wx' });
  try {
    try {
      await link(candidate, path);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      // Serialize stale-lock removal so two reclaimers cannot unlink a new owner.
      // A crash during this short recovery leaves the guard in place: fail closed
      // rather than guessing that another recovery process has finished.
      const recovery = `${path}.recovery`;
      try {
        await mkdir(recovery);
      } catch (guardError) {
        if ((guardError as NodeJS.ErrnoException).code === 'EEXIST') {
          throw new IndexLockedError(`Index lock recovery is busy or interrupted. If no indexer is running, remove ${recovery} and retry.`);
        }
        throw guardError;
      }
      try {
        const owner = await readOwner(path);
        if (owner !== null) {
          const pid = Number(owner.trim().split(/\s+/)[0]);
          if (!Number.isSafeInteger(pid) || pid <= 0 || isProcessAlive(pid)) {
            throw new IndexLockedError();
          }
          await unlink(path);
        }
        // A normal contender may have won after unlink; exclusive linking still
        // permits only one writer. Never remove a lock after a failed link.
        try {
          await link(candidate, path);
        } catch (linkError) {
          if ((linkError as NodeJS.ErrnoException).code === 'EEXIST') throw new IndexLockedError();
          throw linkError;
        }
      } finally {
        await rmdir(recovery);
      }
    }
    owners.set(path, token);
  } finally {
    await unlink(candidate);
  }
}

async function releaseLock(path: string): Promise<void> {
  const token = owners.get(path);
  if (!token) return;
  if (await readOwner(path) === token) await unlink(path);
  owners.delete(path);
}

function lockPaths(projectRoot: string): { lifecycle: string; legacy: string } {
  const root = resolve(projectRoot);
  return {
    lifecycle: join(root, `${PROJECT_DATA_DIR}.lock`),
    legacy: join(root, PROJECT_DATA_DIR, 'index.lock'),
  };
}

/** Keep the lifecycle lock outside the directory that clean removes. */
export async function acquireIndexLock(projectRoot: string): Promise<void> {
  const paths = lockPaths(projectRoot);
  await acquireLock(paths.lifecycle);
  try {
    await acquireLock(paths.legacy);
  } catch (error) {
    await releaseLock(paths.lifecycle);
    throw error;
  }
}

export async function releaseIndexLock(projectRoot: string): Promise<void> {
  const paths = lockPaths(projectRoot);
  try {
    await releaseLock(paths.legacy);
  } finally {
    await releaseLock(paths.lifecycle);
  }
}
