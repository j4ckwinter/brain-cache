import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';

// We do NOT mock fs/promises here — these tests use a real tmpdir to validate
// actual file I/O. We DO spy on process.kill to control liveness checks.

import { acquireIndexLock, releaseIndexLock } from '../../src/services/indexLock.js';

describe('acquireIndexLock', () => {
  let projectRoot: string;

  beforeEach(async () => {
    // Create a fresh tmpdir for each test
    projectRoot = await mkdtemp(join(tmpdir(), 'brain-cache-lock-test-'));
    await mkdir(join(projectRoot, '.brain-cache'), { recursive: true });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(projectRoot, { recursive: true, force: true });
  });

  it('succeeds when no lockfile exists and writes current PID', async () => {
    await acquireIndexLock(projectRoot);

    const lockContent = await readFile(join(projectRoot, '.brain-cache', 'index.lock'), 'utf-8');
    expect(parseInt(lockContent.trim(), 10)).toBe(process.pid);
  });

  it('allows exactly one concurrent acquisition', async () => {
    const results = await Promise.allSettled(Array.from({ length: 12 }, () => acquireIndexLock(projectRoot)));
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    await releaseIndexLock(projectRoot);
    await expect(acquireIndexLock(projectRoot)).resolves.toBeUndefined();
    await releaseIndexLock(projectRoot);
  });

  it('allows only one concurrent stale-lock reclaimer', async () => {
    await writeFile(join(projectRoot, '.brain-cache', 'index.lock'), '99998');
    vi.spyOn(process, 'kill').mockImplementation((pid) => {
      if (pid === 99998) throw Object.assign(new Error('gone'), { code: 'ESRCH' });
      return true;
    });
    const results = await Promise.allSettled(Array.from({ length: 12 }, () => acquireIndexLock(projectRoot)));
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    await releaseIndexLock(projectRoot);
  });

  it('allows only one writer across separate Node processes', async () => {
    const moduleUrl = pathToFileURL(join(process.cwd(), 'src/services/indexLock.ts')).href;
    const script = `
      const { acquireIndexLock } = await import(${JSON.stringify(moduleUrl)});
      process.on('message', async () => {
        try { await acquireIndexLock(process.argv[1]); process.send('acquired'); }
        catch { process.send('blocked'); }
      });
      process.send('ready');
    `;
    const children = Array.from({ length: 4 }, () => spawn(process.execPath,
      ['--import', 'tsx', '--input-type=module', '-e', script, projectRoot],
      { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] }));
    try {
      await Promise.all(children.map(child => once(child, 'message')));
      const results = children.map(child => once(child, 'message'));
      children.forEach(child => child.send('acquire'));
      const messages = await Promise.all(results);
      expect(messages.filter(([message]) => message === 'acquired')).toHaveLength(1);
    } finally {
      await Promise.all(children.map(async child => {
        const exited = once(child, 'exit');
        child.kill();
        await exited;
      }));
    }
    // The winning process exited; legacy and current stale locks can be reclaimed.
    await expect(acquireIndexLock(projectRoot)).resolves.toBeUndefined();
    await releaseIndexLock(projectRoot);
  });

  it('does not release a lock it did not acquire', async () => {
    const path = join(projectRoot, '.brain-cache', 'index.lock');
    await writeFile(path, String(process.pid));
    await releaseIndexLock(projectRoot);
    expect(await readFile(path, 'utf-8')).toBe(String(process.pid));
  });

  it('does not release a replaced lock', async () => {
    const path = join(projectRoot, '.brain-cache', 'index.lock');
    await acquireIndexLock(projectRoot);
    await writeFile(path, `${process.pid} replacement`);
    await releaseIndexLock(projectRoot);
    expect(await readFile(path, 'utf-8')).toBe(`${process.pid} replacement`);
  });

  it('fails with "Another index operation is in progress" when lockfile contains a live PID', async () => {
    const livePid = 99999;
    await writeFile(join(projectRoot, '.brain-cache', 'index.lock'), String(livePid));

    // Mock process.kill to simulate a live process (signal 0 succeeds)
    const killSpy = vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
      if (pid === livePid && signal === 0) return true;
      return true;
    });

    await expect(acquireIndexLock(projectRoot)).rejects.toThrow('Another index operation is in progress');
    killSpy.mockRestore();
  });

  it('succeeds (cleans up stale lock) when lockfile contains a dead PID (ESRCH)', async () => {
    const deadPid = 99998;
    await writeFile(join(projectRoot, '.brain-cache', 'index.lock'), String(deadPid));

    // Mock process.kill to simulate dead process (throws ESRCH)
    const killSpy = vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
      if (pid === deadPid && signal === 0) {
        const err = new Error('No such process') as NodeJS.ErrnoException;
        err.code = 'ESRCH';
        throw err;
      }
      return true;
    });

    // Should succeed and overwrite stale lock with current PID
    await expect(acquireIndexLock(projectRoot)).resolves.toBeUndefined();

    const lockContent = await readFile(join(projectRoot, '.brain-cache', 'index.lock'), 'utf-8');
    expect(parseInt(lockContent.trim(), 10)).toBe(process.pid);

    killSpy.mockRestore();
  });
});

describe('releaseIndexLock', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'brain-cache-lock-test-'));
    await mkdir(join(projectRoot, '.brain-cache'), { recursive: true });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(projectRoot, { recursive: true, force: true });
  });

  it('removes the lockfile when it exists', async () => {
    const lockPath = join(projectRoot, '.brain-cache', 'index.lock');
    await acquireIndexLock(projectRoot);

    await releaseIndexLock(projectRoot);

    await expect(readFile(lockPath, 'utf-8')).rejects.toThrow();
  });

  it('does not throw when lockfile does not exist', async () => {
    // No lockfile created
    await expect(releaseIndexLock(projectRoot)).resolves.toBeUndefined();
  });
});
