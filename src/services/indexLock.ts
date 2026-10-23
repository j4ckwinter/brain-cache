import { readFile, writeFile, unlink, mkdir, rmdir, link } from 'node:fs/promises';
import { join, resolve } from 'node:path';
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

/** Atomically publish a complete PID + nonce file; accept legacy PID-only locks. */
export async function acquireIndexLock(projectRoot: string): Promise<void> {
  const directory = join(resolve(projectRoot), PROJECT_DATA_DIR);
  const path = join(directory, 'index.lock');
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

/** Only the process that acquired this exact lock can release it. */
export async function releaseIndexLock(projectRoot: string): Promise<void> {
  const path = join(resolve(projectRoot), PROJECT_DATA_DIR, 'index.lock');
  const token = owners.get(path);
  if (!token) return;
  if (await readOwner(path) === token) await unlink(path);
  owners.delete(path);
}
