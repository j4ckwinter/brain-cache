import { fork } from 'node:child_process';
import { once } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { publishIndexGeneration, resolveIndexDirectory, withIndexSnapshot, pruneIndexGenerations } from '../../src/services/indexStorage.js';

const state = {
  version: 2, embeddingModel: 'nomic-embed-text', dimension: 768,
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
      await expect(stat(join(dir, 'index'))).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(stat(join(dir, 'index_state.json'))).rejects.toMatchObject({ code: 'ENOENT' });
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
  it('retains only active and previous managed generations', async () => {
    const directories: string[] = [];
    for (let i = 0; i < 6; i++) {
      await publishIndexGeneration(root, dir => writeSnapshot(dir, String(i)));
      directories.push(await resolveIndexDirectory(root));
    }
    expect((await readdir(join(root, '.brain-cache', 'generations'))).sort())
      .toEqual(directories.slice(-2).map(directory => basename(directory)).sort());
  });

  it('keeps a pinned reader through several publications and collects it after release', async () => {
    await publishIndexGeneration(root, dir => writeSnapshot(dir, 'original'));
    const old = await resolveIndexDirectory(root);
    await withIndexSnapshot(root, async directory => {
      expect(directory).toBe(old);
      for (let i = 0; i < 4; i++) await publishIndexGeneration(root, dir => writeSnapshot(dir, String(i)));
      expect(await readFile(join(directory, 'index', 'data'), 'utf8')).toBe('original');
      expect(await readdir(join(root, '.brain-cache', 'generations'))).toHaveLength(3);
    });
    await pruneIndexGenerations(root);
    await expect(stat(old)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readdir(join(root, '.brain-cache', 'generations'))).toHaveLength(2);
  });

  it('releases its pin when the reader fails', async () => {
    await publishIndexGeneration(root, dir => writeSnapshot(dir, 'old'));
    const old = await resolveIndexDirectory(root);
    await expect(withIndexSnapshot(root, async () => { throw new Error('read failed'); })).rejects.toThrow('read failed');
    await publishIndexGeneration(root, dir => writeSnapshot(dir, 'next'));
    await publishIndexGeneration(root, dir => writeSnapshot(dir, 'new'));
    await expect(stat(old)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('retains unmarked v1 generations during migration', async () => {
    await publishIndexGeneration(root, dir => writeSnapshot(dir, 'old'));
    const old = await resolveIndexDirectory(root);
    await rm(join(old, 'managed.json'));
    await writeFile(join(root, '.brain-cache', 'active.json'), JSON.stringify({ version: 1, generation: basename(old) }));
    await withIndexSnapshot(root, async directory => {
      for (let i = 0; i < 3; i++) await publishIndexGeneration(root, dir => writeSnapshot(dir, String(i)));
      expect(await readFile(join(directory, 'index', 'data'), 'utf8')).toBe('old');
    });
    expect(await readFile(join(old, 'index', 'data'), 'utf8')).toBe('old');
  });

  it('preserves unknown pins and removes only pins whose process is definitely dead', async () => {
    await publishIndexGeneration(root, dir => writeSnapshot(dir, 'old'));
    const old = await resolveIndexDirectory(root);
    const pins = join(root, '.brain-cache', 'reader-pins', basename(old));
    await mkdir(pins, { recursive: true });
    await writeFile(join(pins, 'unknown-owner'), '');
    await publishIndexGeneration(root, dir => writeSnapshot(dir, 'next'));
    await publishIndexGeneration(root, dir => writeSnapshot(dir, 'new'));
    expect(await readFile(join(old, 'index', 'data'), 'utf8')).toBe('old');
    await rm(join(pins, 'unknown-owner'));
    await writeFile(join(pins, `424242-${randomUUID()}`), '');
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => { throw Object.assign(new Error('denied'), { code: 'EPERM' }); });
    try {
      await pruneIndexGenerations(root);
      expect(await readFile(join(old, 'index', 'data'), 'utf8')).toBe('old');
      kill.mockImplementation(() => { throw Object.assign(new Error('dead'), { code: 'ESRCH' }); });
      await pruneIndexGenerations(root);
      await expect(stat(old)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally { kill.mockRestore(); }
  });

  it('protects a snapshot pinned by another process', async () => {
    await publishIndexGeneration(root, dir => writeSnapshot(dir, 'old'));
    const old = await resolveIndexDirectory(root);
    const script = join(root, 'reader.mjs');
    await writeFile(script, `
      import { once } from 'node:events';
      import { readFile } from 'node:fs/promises';
      import { join } from 'node:path';
      const { withIndexSnapshot } = await import(process.argv[3]);
      await withIndexSnapshot(process.argv[2], async directory => {
        const release = once(process, 'message');
        process.send('ready');
        await release;
        process.send(await readFile(join(directory, 'index', 'data'), 'utf8'));
      });
      process.disconnect();
    `);
    const child = fork(script, [root, new URL('../../src/services/indexStorage.ts', import.meta.url).href],
      { execArgv: ['--import', 'tsx'], silent: true });
    const exited = once(child, 'exit');
    try {
      const ready = await Promise.race([once(child, 'message'), exited.then(() => { throw new Error('reader exited before acquiring snapshot'); })]);
      expect(ready[0]).toBe('ready');
      for (let i = 0; i < 3; i++) await publishIndexGeneration(root, dir => writeSnapshot(dir, String(i)));
      expect(await readFile(join(old, 'index', 'data'), 'utf8')).toBe('old');
      const value = once(child, 'message');
      child.send('release');
      expect((await value)[0]).toBe('old');
      expect((await exited)[0]).toBe(0);
      await pruneIndexGenerations(root);
      await expect(stat(old)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      if (child.exitCode === null) child.kill();
      await exited;
    }
  }, 20_000);

});
