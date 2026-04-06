import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

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
    await writeFile(lockPath, String(process.pid));

    await releaseIndexLock(projectRoot);

    await expect(readFile(lockPath, 'utf-8')).rejects.toThrow();
  });

  it('does not throw when lockfile does not exist', async () => {
    // No lockfile created
    await expect(releaseIndexLock(projectRoot)).resolves.toBeUndefined();
  });
});
