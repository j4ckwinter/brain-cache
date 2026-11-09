import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { publishIndexGeneration, resolveIndexDirectory, withIndexSnapshot, pruneIndexGenerations } from '../../src/services/indexStorage.js';

vi.mock('node:fs/promises', async original => {
  const fs = await original<typeof import('node:fs/promises')>();
  return { ...fs, mkdir: vi.fn(fs.mkdir), rm: vi.fn(fs.rm) };
});

let root: string;
const state = { version: 1, embeddingModel: 'nomic-embed-text', dimension: 768,
  indexedAt: '2026-11-06T00:00:00.000Z', fileCount: 1, chunkCount: 1 };
async function publish(value: string) {
  await publishIndexGeneration(root, async dir => {
    await writeFile(join(dir, 'index_state.json'), JSON.stringify(state));
    await writeFile(join(dir, 'value'), value);
  });
}
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'bc-pin-race-')); });
afterEach(async () => { vi.mocked(mkdir).mockReset(); vi.mocked(rm).mockReset();
  const fs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  vi.mocked(mkdir).mockImplementation(fs.mkdir); vi.mocked(rm).mockImplementation(fs.rm);
  await rm(root, { recursive: true, force: true });
});

it('retries a reader delayed before pin registration without resurrecting a deleted generation', async () => {
  await publish('old');
  const old = await resolveIndexDirectory(root);
  const fs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  let resume!: () => void;
  let reached!: () => void;
  const paused = new Promise<void>(resolve => { reached = resolve; });
  const release = new Promise<void>(resolve => { resume = resolve; });
  let blocked = false;
  vi.mocked(mkdir).mockImplementation(async (path, options) => {
    if (String(path).includes('reader-pins') && !blocked) { blocked = true; reached(); await release; }
    return fs.mkdir(path, options as { recursive: true });
  });
  const reader = withIndexSnapshot(root, dir => readFile(join(dir, 'value'), 'utf8'));
  try {
    await paused;
    await publish('middle');
    await publish('new');
    await expect(stat(old)).rejects.toMatchObject({ code: 'ENOENT' });
  } finally { resume(); }
  expect(await reader).toBe('new');
  await expect(stat(old)).rejects.toMatchObject({ code: 'ENOENT' });
});

it('keeps a newly published generation active if pruning fails', async () => {
  await publish('old');
  const old = await resolveIndexDirectory(root);
  await publish('middle');
  const fs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  vi.mocked(rm).mockImplementation(async (path, options) => {
    if (String(path) === old) throw Object.assign(new Error('cannot remove'), { code: 'EACCES' });
    return fs.rm(path, options);
  });
  await publish('new');
  const current = await resolveIndexDirectory(root);
  expect(await readFile(join(current, 'value'), 'utf8')).toBe('new');
  vi.mocked(rm).mockImplementation(fs.rm);
  await pruneIndexGenerations(root);
  expect(await readFile(join(current, 'value'), 'utf8')).toBe('new');
  await expect(stat(old)).rejects.toMatchObject({ code: 'ENOENT' });
});
