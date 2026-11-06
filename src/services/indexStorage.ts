import { constants } from 'node:fs';
import { cp, mkdir, readFile, readdir, rename, rm, rmdir, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { PROJECT_DATA_DIR, FILE_HASHES_FILENAME } from '../lib/config.js';
import { childLogger } from './logger.js';
import { IndexStateSchema } from '../lib/types.js';

const GenerationIdSchema = z.string().uuid();
const ActiveGenerationSchema = z.discriminatedUnion('version', [
  z.object({ version: z.literal(1), generation: GenerationIdSchema }),
  z.object({ version: z.literal(2), generation: GenerationIdSchema, previous: GenerationIdSchema.nullable() }),
]);
const ManagedGenerationSchema = z.object({ version: z.literal(2), generation: GenerationIdSchema });
const log = childLogger('index-storage');

function dataRoot(projectRoot: string): string {
  return join(resolve(projectRoot), PROJECT_DATA_DIR);
}

async function readActiveGeneration(projectRoot: string) {
  let raw: string;
  try {
    raw = await readFile(join(dataRoot(projectRoot), 'active.json'), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  return ActiveGenerationSchema.parse(JSON.parse(raw));
}

export async function hasManagedIndex(projectRoot: string): Promise<boolean> {
  return (await readActiveGeneration(projectRoot))?.version === 2;
}

export async function resolveIndexDirectory(projectRoot: string): Promise<string> {
  const active = await readActiveGeneration(projectRoot);
  return active ? join(dataRoot(projectRoot), 'generations', active.generation) : dataRoot(projectRoot);
}

/** The callback owns its snapshot until it resolves; do not retain the path for later reads. */
export async function withIndexSnapshot<T>(projectRoot: string, read: (directory: string) => Promise<T>): Promise<T> {
  const base = dataRoot(projectRoot);
  for (let attempt = 0; attempt < 16; attempt++) {
    const active = await readActiveGeneration(projectRoot);
    if (!active) return read(base);
    const directory = join(base, 'generations', active.generation);
    if (active.version === 1) return read(directory);
    const pins = join(base, 'reader-pins', active.generation);
    const pin = join(pins, `${process.pid}-${randomUUID()}`);
    try {
      await mkdir(pins, { recursive: true });
      await writeFile(pin, '', { flag: 'wx' });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    try {
      const latest = await readActiveGeneration(projectRoot);
      if (latest?.version === 2 && latest.generation === active.generation) return await read(directory);
    } finally {
      await rm(pin, { force: true });
      try { await rmdir(pins); } catch (error) {
        if (!['ENOENT', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
      }
    }
  }
  throw new Error('Index changed repeatedly while acquiring a snapshot. Retry the request.');
}

async function hasReaders(pins: string): Promise<boolean> {
  let entries;
  try {
    entries = await readdir(pins, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
  for (const entry of entries) {
    const match = /^(\d+)-(.+)$/.exec(entry.name);
    if (!entry.isFile() || !match || !GenerationIdSchema.safeParse(match[2]).success) return true;
    const pid = Number(match[1]);
    if (!Number.isSafeInteger(pid) || pid <= 0) return true;
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') return true;
    }
    await rm(join(pins, entry.name), { force: true });
  }
  return false;
}

/** Requires the lifecycle writer lock. Cleanup failures must not invalidate a published snapshot. */
export async function pruneIndexGenerations(projectRoot: string): Promise<void> {
  try {
    const active = await readActiveGeneration(projectRoot);
    if (active?.version !== 2) return;
    const base = dataRoot(projectRoot);
    const generations = join(base, 'generations');
    for (const entry of await readdir(generations, { withFileTypes: true })) {
      if (!entry.isDirectory() || !GenerationIdSchema.safeParse(entry.name).success
        || entry.name === active.generation || entry.name === active.previous) continue;
      const directory = join(generations, entry.name);
      let marker;
      try {
        marker = ManagedGenerationSchema.safeParse(JSON.parse(await readFile(join(directory, 'managed.json'), 'utf8')));
      } catch { continue; }
      if (!marker.success || marker.data.generation !== entry.name) continue;
      const pins = join(base, 'reader-pins', entry.name);
      if (await hasReaders(pins)) continue;
      await rm(directory, { recursive: true, force: true });
      await rm(pins, { recursive: true, force: true });
    }
  } catch (error) {
    log.warn({ error }, 'Unable to prune old index generations; published index remains available');
  }
}

/** The caller must hold the project's index lifecycle lock throughout this operation. */
export async function publishIndexGeneration(
  projectRoot: string,
  build: (dataDirectory: string) => Promise<void>,
  force = false,
): Promise<void> {
  const base = dataRoot(projectRoot);
  const active = await readActiveGeneration(projectRoot);
  const activeDirectory = active ? join(base, 'generations', active.generation) : base;
  const generation = randomUUID();
  const directory = join(base, 'generations', generation);
  const pointer = join(base, `active.${generation}.json`);
  await mkdir(directory, { recursive: true });
  try {
    await writeFile(join(directory, 'managed.json'), JSON.stringify({ version: 2, generation }), { flag: 'wx' });
    if (!force) {
      for (const name of ['index', 'index_state.json', FILE_HASHES_FILENAME]) {
        const source = join(activeDirectory, name);
        try {
          await stat(source);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
          throw error;
        }
        await cp(source, join(directory, name), { recursive: true, mode: constants.COPYFILE_FICLONE });
      }
    }
    await build(directory);
    IndexStateSchema.parse(JSON.parse(await readFile(join(directory, 'index_state.json'), 'utf8')));
    await writeFile(pointer, JSON.stringify({ version: 2, generation, previous: active?.generation ?? null }), { flag: 'wx' });
    await rename(pointer, join(base, 'active.json'));
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    await rm(pointer, { force: true });
    throw error;
  }
  await pruneIndexGenerations(projectRoot);
}
