import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { publishIndexGeneration, resolveIndexDirectory } from '../../src/services/indexStorage.js';

const state = {
  version: 1, embeddingModel: 'nomic-embed-text', dimension: 768,
  indexedAt: '2026-11-06T00:00:00.000Z', fileCount: 1, chunkCount: 1,
};

describe('index generation publication', () => {
  let root: string;
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'bc-generation-')); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  async function writeSnapshot(directory: string, value: string) {
    await mkdir(join(directory, 'index'), { recursive: true });
    await writeFile(join(directory, 'index', 'data'), value);
    await writeFile(join(directory, 'index_state.json'), JSON.stringify(state));
    await writeFile(join(directory, 'file-hashes.json'), value);
  }

  it('migrates a legacy directory without modifying it', async () => {
    const legacy = await resolveIndexDirectory(root);
    await writeSnapshot(legacy, 'old');
    await publishIndexGeneration(root, async directory => {
      expect(await readFile(join(directory, 'index', 'data'), 'utf8')).toBe('old');
      await writeSnapshot(directory, 'new');
      expect(await resolveIndexDirectory(root)).toBe(legacy);
      expect(await readFile(join(legacy, 'index', 'data'), 'utf8')).toBe('old');
    });
    const active = await resolveIndexDirectory(root);
    expect(active).not.toBe(legacy);
    expect(await readFile(join(active, 'index', 'data'), 'utf8')).toBe('new');
    expect(await readFile(join(legacy, 'index', 'data'), 'utf8')).toBe('old');
  });

  it('does not publish or retain a failed generation', async () => {
    await publishIndexGeneration(root, dir => writeSnapshot(dir, 'old'));
    const old = await resolveIndexDirectory(root);
    await expect(publishIndexGeneration(root, async dir => {
      await writeSnapshot(dir, 'partial');
      throw new Error('interrupted');
    })).rejects.toThrow('interrupted');
    expect(await resolveIndexDirectory(root)).toBe(old);
    expect(await readdir(join(root, '.brain-cache', 'generations'))).toHaveLength(1);
    expect(await readFile(join(old, 'index', 'data'), 'utf8')).toBe('old');
  });

  it('keeps an existing generation readable after publishing a replacement', async () => {
    await publishIndexGeneration(root, dir => writeSnapshot(dir, 'old'));
    const old = await resolveIndexDirectory(root);
    await publishIndexGeneration(root, dir => writeSnapshot(dir, 'new'));
    expect(await readFile(join(old, 'file-hashes.json'), 'utf8')).toBe('old');
    expect(await readFile(join(await resolveIndexDirectory(root), 'file-hashes.json'), 'utf8')).toBe('new');
  });

  it('refuses to publish incomplete metadata', async () => {
    await publishIndexGeneration(root, dir => writeSnapshot(dir, 'old'));
    const old = await resolveIndexDirectory(root);
    await expect(publishIndexGeneration(root, async dir => {
      await writeFile(join(dir, 'index_state.json'), '{}');
    })).rejects.toThrow();
    expect(await resolveIndexDirectory(root)).toBe(old);
  });

  it('starts a forced generation empty and retains the previous snapshot on failure', async () => {
    await publishIndexGeneration(root, dir => writeSnapshot(dir, 'old'));
    const old = await resolveIndexDirectory(root);
    await expect(publishIndexGeneration(root, async dir => {
      expect(await readdir(dir)).toEqual([]);
      throw new Error('failed rebuild');
    }, true)).rejects.toThrow('failed rebuild');
    expect(await resolveIndexDirectory(root)).toBe(old);
  });

  it('leaves first-time indexing unpublished on failure', async () => {
    const legacy = await resolveIndexDirectory(root);
    await expect(publishIndexGeneration(root, async () => { throw new Error('failed'); })).rejects.toThrow('failed');
    expect(await resolveIndexDirectory(root)).toBe(legacy);
    expect(await readdir(join(root, '.brain-cache', 'generations'))).toEqual([]);
  });

  it.each(['../outside', '/tmp/outside', 'invalid'])('rejects invalid generation pointers: %s', async generation => {
    await mkdir(join(root, '.brain-cache'));
    await writeFile(join(root, '.brain-cache', 'active.json'), JSON.stringify({ version: 1, generation }));
    await expect(resolveIndexDirectory(root)).rejects.toThrow();
  });
});
