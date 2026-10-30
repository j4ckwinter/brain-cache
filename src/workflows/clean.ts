import { rm, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { PROJECT_DATA_DIR } from '../lib/config.js';
import { acquireIndexLock, releaseIndexLock } from '../services/indexLock.js';
import { validateIndexPath } from '../lib/pathValidator.js';

export async function runClean(path?: string): Promise<void> {
  const rootDir = resolve(path ?? '.');
  validateIndexPath(rootDir);
  const dataDir = join(rootDir, PROJECT_DATA_DIR);

  try {
    await access(dataDir);
  } catch {
    process.stdout.write(`brain-cache: no index directory at ${dataDir}\n`);
    return;
  }

  await acquireIndexLock(rootDir);
  try {
    await rm(dataDir, { recursive: true, force: true });
    process.stdout.write(`brain-cache: removed ${dataDir}\n`);
  } finally {
    await releaseIndexLock(rootDir);
  }
}
