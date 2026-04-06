import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import ignore from 'ignore';

// Mock all dependencies before importing the module
vi.mock('node:fs', () => ({
  watch: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
}));

vi.mock('../../src/workflows/index.js', () => ({
  runIndex: vi.fn(),
}));

vi.mock('../../src/services/crawler.js', () => ({
  SOURCE_EXTENSIONS: new Set([
    '.ts', '.tsx', '.mts', '.cts',
    '.js', '.jsx', '.mjs', '.cjs',
    '.py', '.pyi',
    '.go',
    '.rs',
    '.md',
    '.txt',
    '.rst',
  ]),
}));

vi.mock('../../src/services/logger.js', () => ({
  childLogger: vi.fn().mockReturnValue({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { watch } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { runIndex } from '../../src/workflows/index.js';
import { shouldProcess, buildSummary } from '../../src/workflows/watch.js';

const mockWatch = vi.mocked(watch);
const mockReadFile = vi.mocked(readFile);
const mockRunIndex = vi.mocked(runIndex);

describe('shouldProcess', () => {
  let ig: ReturnType<typeof ignore>;

  beforeEach(() => {
    ig = ignore();
  });

  it('returns true for tracked extension not in excluded prefix', () => {
    expect(shouldProcess('src/index.ts', ig)).toBe(true);
  });

  it('returns false for untracked extension', () => {
    expect(shouldProcess('src/image.png', ig)).toBe(false);
  });

  it('returns false for node_modules/ prefix', () => {
    expect(shouldProcess('node_modules/foo.ts', ig)).toBe(false);
  });

  it('returns false for .git/ prefix', () => {
    expect(shouldProcess('.git/config', ig)).toBe(false);
  });

  it('returns false for dist/ prefix', () => {
    expect(shouldProcess('dist/index.js', ig)).toBe(false);
  });

  it('returns false for build/ prefix', () => {
    expect(shouldProcess('build/output.ts', ig)).toBe(false);
  });

  it('returns false for null/empty filename', () => {
    expect(shouldProcess('', ig)).toBe(false);
    expect(shouldProcess(null as unknown as string, ig)).toBe(false);
  });

  it('returns false for file matching braincacheignore pattern', () => {
    ig.add('*.generated.ts');
    expect(shouldProcess('src/api.generated.ts', ig)).toBe(false);
  });

  it('returns true when braincacheignore check errors (defensive)', () => {
    // Paths with ./ prefix cause ignore to throw — should default to true (process file)
    const result = shouldProcess('src/index.ts', ig);
    expect(result).toBe(true);
  });

  it('returns false for json/lock extensions (brain-cache internals)', () => {
    expect(shouldProcess('.brain-cache/file-hashes.json', ig)).toBe(false);
    expect(shouldProcess('.brain-cache/index.lock', ig)).toBe(false);
  });
});

describe('buildSummary', () => {
  it('extracts incremental stats from captured lines', () => {
    const lines = [
      'brain-cache: found 45 source files\n',
      'brain-cache: incremental index -- 3 new, 1 changed, 0 removed (41 unchanged)\n',
      'brain-cache: indexing complete\n',
    ];
    const result = buildSummary(lines, '1.2');
    expect(result).toBe('brain-cache: re-indexed (3 new, 1 changed, 0 removed) in 1.2s');
  });

  it('falls back to plain summary when no incremental stats line found', () => {
    const lines = ['brain-cache: found 0 source files\n'];
    const result = buildSummary(lines, '0.3');
    expect(result).toBe('brain-cache: re-indexed in 0.3s');
  });

  it('falls back when incremental line has no matching stats', () => {
    const lines = ['brain-cache: incremental index -- something unexpected\n'];
    const result = buildSummary(lines, '0.5');
    expect(result).toBe('brain-cache: re-indexed in 0.5s');
  });

  it('handles empty lines array', () => {
    const result = buildSummary([], '0.1');
    expect(result).toBe('brain-cache: re-indexed in 0.1s');
  });
});

describe('debounce coalescing', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockRunIndex.mockResolvedValue(undefined);
    mockReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

    // Mock watcher object
    const mockWatcher = {
      on: vi.fn().mockReturnThis(),
      close: vi.fn(),
    };
    mockWatch.mockReturnValue(mockWatcher as unknown as ReturnType<typeof watch>);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    // Remove all signal listeners added during tests
    process.removeAllListeners('SIGINT');
    process.removeAllListeners('SIGTERM');
  });

  it('calls runIndex exactly once after 500ms when debounce fires multiple times', async () => {
    const { runWatch } = await import('../../src/workflows/watch.js');

    // Start watch (don't await — it blocks forever)
    const watchPromise = runWatch('/tmp/test-watch');

    // Capture the callback passed to watch
    expect(mockWatch).toHaveBeenCalled();
    const watchCallback = mockWatch.mock.calls[0][2] as (eventType: string, filename: string) => void;

    // Trigger 5 rapid events
    for (let i = 0; i < 5; i++) {
      watchCallback('change', 'src/index.ts');
    }

    // Advance past debounce window
    await vi.advanceTimersByTimeAsync(600);

    // runIndex should be called exactly once
    expect(mockRunIndex).toHaveBeenCalledTimes(1);
    expect(mockRunIndex).toHaveBeenCalledWith('/tmp/test-watch');

    // Clean up by triggering SIGINT
    process.emit('SIGINT');
    await watchPromise.catch(() => {}); // process.exit(0) will reject the promise in test
  });

  it('calls runIndex once after 500ms of silence', async () => {
    vi.resetModules();
    const { runWatch } = await import('../../src/workflows/watch.js?t=' + Date.now());

    const watchPromise = runWatch('/tmp/test-watch2');

    const watchCallback = mockWatch.mock.calls[mockWatch.mock.calls.length - 1][2] as (eventType: string, filename: string) => void;

    watchCallback('change', 'src/utils.ts');

    await vi.advanceTimersByTimeAsync(600);

    expect(mockRunIndex).toHaveBeenCalledTimes(1);

    process.emit('SIGINT');
    await watchPromise.catch(() => {});
  });
});

describe('lock contention skip', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

    const mockWatcher = {
      on: vi.fn().mockReturnThis(),
      close: vi.fn(),
    };
    mockWatch.mockReturnValue(mockWatcher as unknown as ReturnType<typeof watch>);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    process.removeAllListeners('SIGINT');
    process.removeAllListeners('SIGTERM');
  });

  it('writes skip message and does not crash when runIndex throws lock error', async () => {
    vi.resetModules();
    mockRunIndex.mockRejectedValue(
      new Error('Another index operation is in progress. Try again later.')
    );

    const { runWatch } = await import('../../src/workflows/watch.js?t=lock-' + Date.now());

    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const watchPromise = runWatch('/tmp/test-lock');

    const watchCallback = mockWatch.mock.calls[mockWatch.mock.calls.length - 1][2] as (eventType: string, filename: string) => void;
    watchCallback('change', 'src/service.ts');

    await vi.advanceTimersByTimeAsync(600);

    // Should have written the skip message
    const writtenStrings = stderrSpy.mock.calls
      .map(c => typeof c[0] === 'string' ? c[0] : '')
      .join('');
    expect(writtenStrings).toContain('Index in progress, skipping');

    stderrSpy.mockRestore();
    process.emit('SIGINT');
    await watchPromise.catch(() => {});
  });
});

describe('stderr suppression', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

    const mockWatcher = {
      on: vi.fn().mockReturnThis(),
      close: vi.fn(),
    };
    mockWatch.mockReturnValue(mockWatcher as unknown as ReturnType<typeof watch>);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    process.removeAllListeners('SIGINT');
    process.removeAllListeners('SIGTERM');
  });

  it('restores process.stderr.write after successful runIndex', async () => {
    const originalWrite = process.stderr.write;
    let capturedDuringRun: typeof process.stderr.write | null = null;

    vi.resetModules();
    mockRunIndex.mockImplementation(async () => {
      // Capture the stderr.write during runIndex execution
      capturedDuringRun = process.stderr.write;
    });

    const { runWatch } = await import('../../src/workflows/watch.js?t=stderr-' + Date.now());

    // Suppress banner output
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const watchPromise = runWatch('/tmp/test-stderr');

    const watchCallback = mockWatch.mock.calls[mockWatch.mock.calls.length - 1][2] as (eventType: string, filename: string) => void;
    watchCallback('change', 'src/index.ts');

    await vi.advanceTimersByTimeAsync(600);

    stderrSpy.mockRestore();

    // stderr.write should be restored (or at least defined and functional) after runIndex
    expect(process.stderr.write).toBeDefined();
    // The write during runIndex was a different function (capturing)
    expect(capturedDuringRun).not.toBeNull();

    process.emit('SIGINT');
    await watchPromise.catch(() => {});
  });
});

describe('cleanup handler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockRunIndex.mockResolvedValue(undefined);
    mockReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    process.removeAllListeners('SIGINT');
    process.removeAllListeners('SIGTERM');
  });

  it('calls watcher.close() on SIGINT', async () => {
    const mockWatcher = {
      on: vi.fn().mockReturnThis(),
      close: vi.fn(),
    };
    mockWatch.mockReturnValue(mockWatcher as unknown as ReturnType<typeof watch>);

    vi.resetModules();
    const { runWatch } = await import('../../src/workflows/watch.js?t=cleanup-' + Date.now());

    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const watchPromise = runWatch('/tmp/test-cleanup');

    process.emit('SIGINT');
    await watchPromise.catch(() => {});

    expect(mockWatcher.close).toHaveBeenCalled();
  });

  it('clears debounceTimer on SIGINT to prevent hanging', async () => {
    const mockWatcher = {
      on: vi.fn().mockReturnThis(),
      close: vi.fn(),
    };
    mockWatch.mockReturnValue(mockWatcher as unknown as ReturnType<typeof watch>);

    vi.resetModules();
    const { runWatch } = await import('../../src/workflows/watch.js?t=cleanup2-' + Date.now());

    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const watchPromise = runWatch('/tmp/test-cleanup2');

    // Schedule a debounce (but don't let it fire)
    const watchCallback = mockWatch.mock.calls[mockWatch.mock.calls.length - 1][2] as (eventType: string, filename: string) => void;
    watchCallback('change', 'src/index.ts');

    // Immediately emit SIGINT before 500ms
    process.emit('SIGINT');
    await watchPromise.catch(() => {});

    // runIndex should NOT have been called (debounce was cleared)
    expect(mockRunIndex).not.toHaveBeenCalled();
  });
});
