import { constants } from 'node:fs';
import { cp, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { PROJECT_DATA_DIR, FILE_HASHES_FILENAME } from '../lib/config.js';
import { IndexStateSchema } from '../lib/types.js';

const ActiveGenerationSchema = z.object({ version: z.literal(1), generation: z.string().uuid() });

export async function resolveIndexDirectory(projectRoot: string): Promise<string> {
  const base = join(resolve(projectRoot), PROJECT_DATA_DIR);
  let raw: string;
  try {
    raw = await readFile(join(base, 'active.json'), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return base;
    throw error;
  }
  const active = ActiveGenerationSchema.parse(JSON.parse(raw));
  return join(base, 'generations', active.generation);
}

/** The caller must hold the project's index lifecycle lock throughout this operation. */
export async function publishIndexGeneration(
  projectRoot: string,
  build: (dataDirectory: string) => Promise<void>,
  force = false,
): Promise<void> {
  const base = join(resolve(projectRoot), PROJECT_DATA_DIR);
  const activeDirectory = await resolveIndexDirectory(projectRoot);
  const generation = randomUUID();
  const directory = join(base, 'generations', generation);
  const pointer = join(base, `active.${generation}.json`);
  await mkdir(directory, { recursive: true });
  try {
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
    await writeFile(pointer, JSON.stringify({ version: 1, generation }), { flag: 'wx' });
    await rename(pointer, join(base, 'active.json'));
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    await rm(pointer, { force: true });
    throw error;
  }
}
