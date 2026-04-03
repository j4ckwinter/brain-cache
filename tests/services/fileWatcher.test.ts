import { describe, it, expect, vi, beforeEach } from 'vitest';
import { join } from 'node:path';

// Mock chokidar before importing the service
vi.mock('chokidar', () => {
  const mockWatcher = {
    on: vi.fn().mockReturnThis(),
    close: vi.fn().mockResolvedValue(undefined),
  };
  return {
    watch: vi.fn().mockReturnValue(mockWatcher),
  };
});

// Mock loadIgnorePatterns
vi.mock('../../src/services/ignorePatterns.js', () => ({
  loadIgnorePatterns: vi.fn().mockResolvedValue(['docs/**', '*.log']),
}));

// Import after mocks are set up
import { watch } from 'chokidar';
import { loadIgnorePatterns } from '../../src/services/ignorePatterns.js';
import { createWatcher } from '../../src/services/fileWatcher.js';

const mockWatch = vi.mocked(watch);
const mockLoadIgnorePatterns = vi.mocked(loadIgnorePatterns);

const projectRoot = '/fake/project';

beforeEach(() => {
  vi.clearAllMocks();
  mockLoadIgnorePatterns.mockResolvedValue(['docs/**', '*.log']);
  // Reset the mock watcher
  const mockWatcher = {
    on: vi.fn().mockReturnThis(),
    close: vi.fn().mockResolvedValue(undefined),
  };
  mockWatch.mockReturnValue(mockWatcher as any);
});

describe('createWatcher', () => {
  it('returns a chokidar FSWatcher instance with ignoreInitial: true and persistent: true', async () => {
    const watcher = await createWatcher(projectRoot);

    expect(mockWatch).toHaveBeenCalledOnce();
    const [watchedPath, options] = mockWatch.mock.calls[0];
    expect(watchedPath).toBe(projectRoot);
    expect(options).toMatchObject({
      ignoreInitial: true,
      persistent: true,
    });
    expect(watcher).toBeDefined();
  });

  it('ignored callback returns true for paths inside .brain-cache/ directory', async () => {
    await createWatcher(projectRoot);

    const [, options] = mockWatch.mock.calls[0];
    const ignored = options.ignored as (path: string) => boolean;

    const cachePath = join(projectRoot, '.brain-cache', 'file-hashes.json');
    expect(ignored(cachePath)).toBe(true);
  });

  it('ignored callback returns true for paths matching .braincacheignore patterns', async () => {
    mockLoadIgnorePatterns.mockResolvedValue(['docs/**', '*.log']);
    await createWatcher(projectRoot);

    const [, options] = mockWatch.mock.calls[0];
    const ignored = options.ignored as (path: string) => boolean;

    // docs/** pattern should match
    const docsPath = join(projectRoot, 'docs', 'readme.md');
    expect(ignored(docsPath)).toBe(true);

    // *.log pattern should match
    const logPath = join(projectRoot, 'server.log');
    expect(ignored(logPath)).toBe(true);
  });

  it('ignored callback returns false for normal source files not in ignore patterns', async () => {
    mockLoadIgnorePatterns.mockResolvedValue(['docs/**', '*.log']);
    await createWatcher(projectRoot);

    const [, options] = mockWatch.mock.calls[0];
    const ignored = options.ignored as (path: string) => boolean;

    const srcPath = join(projectRoot, 'src', 'index.ts');
    expect(ignored(srcPath)).toBe(false);
  });

  it('ignored callback returns true for node_modules paths (ALWAYS_EXCLUDE_GLOBS coverage)', async () => {
    await createWatcher(projectRoot);

    const [, options] = mockWatch.mock.calls[0];
    const ignored = options.ignored as (path: string) => boolean;

    const nmPath = join(projectRoot, 'node_modules', 'some-package', 'index.js');
    expect(ignored(nmPath)).toBe(true);
  });
});
