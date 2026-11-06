import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { requireProfile } from '../lib/guards.js';
import { PROJECT_DATA_DIR, CHUNK_FORMAT_VERSION, EMBEDDING_DIMENSIONS, DEFAULT_EMBEDDING_DIMENSION, FILE_READ_CONCURRENCY } from '../lib/config.js';
import { statAllFiles } from '../lib/fsUtils.js';
import { crawlSourceFiles } from './crawler.js';
import { readGitConfig } from './gitHistory.js';
import { resolveIndexDirectory } from './indexStorage.js';
import { readIndexState, readFileHashes, withIndexConnection } from './lancedb.js';

export async function canReuseIndex(
  rootDir: string,
  opts?: { force?: boolean; verify?: boolean },
): Promise<boolean> {
  if (opts?.force) return false;
  const directory = await resolveIndexDirectory(rootDir);
  if (directory === join(resolve(rootDir), PROJECT_DATA_DIR)) return false;
  const state = await readIndexState(rootDir, directory);
  if (!state || state.chunkFormatVersion !== CHUNK_FORMAT_VERSION) return false;
  const profile = await requireProfile();
  const dimension = EMBEDDING_DIMENSIONS[profile.embeddingModel] ?? DEFAULT_EMBEDDING_DIMENSION;
  if (state.embeddingModel !== profile.embeddingModel || state.dimension !== dimension) return false;
  if ((await readGitConfig())?.enabled) return false;

  const files = await crawlSourceFiles(rootDir);
  const manifest = await readFileHashes(rootDir, directory);
  if (files.length !== state.fileCount || files.length !== Object.keys(manifest.hashes).length) return false;
  const stats = await statAllFiles(files, FILE_READ_CONCURRENCY);
  for (const file of files) {
    const current = stats.get(file);
    const stored = manifest.stats[file];
    if (!current || !stored || current.size !== stored.size || current.mtimeMs !== stored.mtimeMs
      || typeof manifest.hashes[file] !== 'string' || typeof manifest.tokenCounts[file] !== 'number') return false;
    if (opts?.verify) {
      const hash = createHash('sha256').update(await readFile(file, 'utf8')).digest('hex');
      if (hash !== manifest.hashes[file]) return false;
    }
  }

  return withIndexConnection(rootDir, directory, async db => {
    const names = await db.tableNames();
    if (!names.includes('chunks') || !names.includes('edges')) return false;
    const table = await db.openTable('chunks');
    const schema = await table.schema();
    if (!['file_type', 'source_kind'].every(name => schema.fields.some(field => field.name === name))) return false;
    return await table.countRows() === state.chunkCount;
  });
}
