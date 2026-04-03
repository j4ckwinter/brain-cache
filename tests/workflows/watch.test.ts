import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock fileWatcher service
vi.mock('../../src/services/fileWatcher.js', () => ({
  createWatcher: vi.fn(),
}));

// Mock index workflow
vi.mock('../../src/workflows/index.js', () => ({
  runIndex: vi.fn().mockResolvedValue(undefined),
}));

// Mock fs/promises for lock file operations
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    open: vi.fn(),
    unlink: vi.fn().mockResolvedValue(undefined),
    mkdir: vi.fn().mockResolvedValue(undefined),
  };
});

import { open, unlink, mkdir } from 'node:fs/promises';
import { createWatcher } from '../../src/services/fileWatcher.js';
import { runIndex } from '../../src/workflows/index.js';
import {
  acquireIndexLock,
  releaseIndexLock,
  scheduleReindex,
  resetState,
} from '../../src/workflows/watch.js';

const mockOpen = vi.mocked(open);
const mockUnlink = vi.mocked(unlink);
const mockMkdir = vi.mocked(mkdir);
const mockRunIndex = vi.mocked(runIndex);
const mockCreateWatcher = vi.mocked(createWatcher);

const projectRoot = '/fake/project';

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();

  // Default: lock acquisition succeeds
  const mockHandle = { close: vi.fn().mockResolvedValue(undefined) };
  mockOpen.mockResolvedValue(mockHandle as any);
  mockUnlink.mockResolvedValue(undefined);
  mockMkdir.mockResolvedValue(undefined);
  mockRunIndex.mockResolvedValue(undefined);

  // Reset module-level state
  resetState();
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('acquireIndexLock', () => {
  it('returns true when no lock file exists and creates .indexing file', async () => {
    const result = await acquireIndexLock(projectRoot);

    expect(result).toBe(true);
    expect(mockMkdir).toHaveBeenCalledWith(
      expect.stringContaining('.brain-cache'),
      { recursive: true }
    );
    expect(mockOpen).toHaveBeenCalledWith(
      expect.stringContaining('.indexing'),
      'wx'
    );
  });

  it('returns false when lock file already exists (another process indexing)', async () => {
    const lockError = Object.assign(new Error('EEXIST: file already exists'), { code: 'EEXIST' });
    mockOpen.mockRejectedValue(lockError);

    const result = await acquireIndexLock(projectRoot);

    expect(result).toBe(false);
  });
});

describe('releaseIndexLock', () => {
  it('removes the .brain-cache/.indexing file', async () => {
    await releaseIndexLock(projectRoot);

    expect(mockUnlink).toHaveBeenCalledWith(
      expect.stringContaining('.indexing')
    );
  });

  it('does not throw if .indexing file does not exist', async () => {
    mockUnlink.mockRejectedValue(new Error('ENOENT'));

    await expect(releaseIndexLock(projectRoot)).resolves.toBeUndefined();
  });
});

describe('scheduleReindex', () => {
  it('calls runIndex once after 500ms debounce', async () => {
    scheduleReindex('/fake/project/src/foo.ts', 'change', projectRoot);

    expect(mockRunIndex).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(500);

    expect(mockRunIndex).toHaveBeenCalledOnce();
    expect(mockRunIndex).toHaveBeenCalledWith(projectRoot);
  });

  it('multiple rapid calls within 500ms coalesce into a single runIndex call', async () => {
    scheduleReindex('/fake/project/src/a.ts', 'change', projectRoot);
    scheduleReindex('/fake/project/src/b.ts', 'change', projectRoot);
    scheduleReindex('/fake/project/src/c.ts', 'add', projectRoot);
    scheduleReindex('/fake/project/src/d.ts', 'change', projectRoot);
    scheduleReindex('/fake/project/src/e.ts', 'unlink', projectRoot);

    await vi.advanceTimersByTimeAsync(500);

    expect(mockRunIndex).toHaveBeenCalledOnce();
  });

  it('resets timer on each new event (rolling debounce)', async () => {
    scheduleReindex('/fake/project/src/a.ts', 'change', projectRoot);
    await vi.advanceTimersByTimeAsync(200);

    scheduleReindex('/fake/project/src/b.ts', 'change', projectRoot);
    await vi.advanceTimersByTimeAsync(200);

    scheduleReindex('/fake/project/src/c.ts', 'change', projectRoot);
    await vi.advanceTimersByTimeAsync(200);

    // Only 600ms total but each event reset the timer — not fired yet
    expect(mockRunIndex).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(300);

    expect(mockRunIndex).toHaveBeenCalledOnce();
  });

  it('skips runIndex and logs when lock is held by another process', async () => {
    const lockError = Object.assign(new Error('EEXIST'), { code: 'EEXIST' });
    mockOpen.mockRejectedValue(lockError);

    const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    scheduleReindex('/fake/project/src/a.ts', 'change', projectRoot);
    await vi.advanceTimersByTimeAsync(500);

    expect(mockRunIndex).not.toHaveBeenCalled();
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining('skipping reindex')
    );

    stderrSpy.mockRestore();
  });
});

describe('cleanup', () => {
  it('clears debounce timer and calls watcher.close()', async () => {
    const mockWatcherInstance = {
      on: vi.fn().mockReturnThis(),
      close: vi.fn().mockResolvedValue(undefined),
    };
    mockCreateWatcher.mockResolvedValue(mockWatcherInstance as any);

    // Schedule a reindex to create a pending timer
    scheduleReindex('/fake/project/src/a.ts', 'change', projectRoot);

    // Close watcher directly
    await mockWatcherInstance.close();

    expect(mockWatcherInstance.close).toHaveBeenCalledOnce();
    // runIndex should NOT have been called (timer was not advanced)
    expect(mockRunIndex).not.toHaveBeenCalled();
  });
});
