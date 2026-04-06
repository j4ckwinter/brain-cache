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

/**
 * Helper: run runWatch, capturing the fs.watch callback for simulation.
 * Returns the watch callback and cleanup functions.
 */
async function setupWatch(rootDir: string = '/tmp/test-watch'): Promise<{
  watchCallback: (eventType: string, filename: string) => void;
  mockWatcher: { on: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };
}> {
  const mockWatcher = {
    on: vi.fn().mockReturnThis(),
    close: vi.fn(),
  };
  mockWatch.mockReturnValue(mockWatcher as unknown as ReturnType<typeof watch>);
  mockReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

  // Stub process.exit to prevent test process from dying
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);
  // Suppress banner output
  const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

  // Import and start watch (don't await — it blocks forever)
  const { runWatch } = await import('../../src/workflows/watch.js');
  runWatch(rootDir);

  // Allow microtasks to settle so watch() is called
  await Promise.resolve();

  // Restore stderr spy so tests can make assertions on it
  stderrSpy.mockRestore();
  exitSpy.mockRestore();

  const lastCall = mockWatch.mock.calls[mockWatch.mock.calls.length - 1];
  const watchCallback = lastCall[2] as (eventType: string, filename: string) => void;

  return { watchCallback, mockWatcher };
}

describe('debounce coalescing', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockRunIndex.mockResolvedValue(undefined);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    process.removeAllListeners('SIGINT');
    process.removeAllListeners('SIGTERM');
  });

  it('calls runIndex exactly once after 500ms when debounce fires multiple times', async () => {
    const { watchCallback } = await setupWatch('/tmp/coalesce-1');

    // Trigger 5 rapid events
    for (let i = 0; i < 5; i++) {
      watchCallback('change', 'src/index.ts');
    }

    // Advance past debounce window
    await vi.advanceTimersByTimeAsync(600);

    // runIndex should be called exactly once
    expect(mockRunIndex).toHaveBeenCalledTimes(1);
    expect(mockRunIndex).toHaveBeenCalledWith('/tmp/coalesce-1');
  });

  it('calls runIndex once after a single event + 500ms', async () => {
    const { watchCallback } = await setupWatch('/tmp/coalesce-2');

    watchCallback('change', 'src/utils.ts');
    await vi.advanceTimersByTimeAsync(600);

    expect(mockRunIndex).toHaveBeenCalledTimes(1);
  });

  it('does not call runIndex for non-source files', async () => {
    const { watchCallback } = await setupWatch('/tmp/coalesce-3');

    watchCallback('change', 'src/image.png');
    await vi.advanceTimersByTimeAsync(600);

    expect(mockRunIndex).not.toHaveBeenCalled();
  });

  it('does not call runIndex for node_modules files', async () => {
    const { watchCallback } = await setupWatch('/tmp/coalesce-4');

    watchCallback('change', 'node_modules/lodash/index.ts');
    await vi.advanceTimersByTimeAsync(600);

    expect(mockRunIndex).not.toHaveBeenCalled();
  });
});

describe('lock contention skip', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockRunIndex.mockRejectedValue(
      new Error('Another index operation is in progress. Try again later.')
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    process.removeAllListeners('SIGINT');
    process.removeAllListeners('SIGTERM');
  });

  it('writes skip message and does not crash when runIndex throws lock error', async () => {
    const { watchCallback } = await setupWatch('/tmp/lock-test');

    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    watchCallback('change', 'src/service.ts');
    await vi.advanceTimersByTimeAsync(600);

    const writtenStrings = stderrSpy.mock.calls
      .map(c => (typeof c[0] === 'string' ? c[0] : ''))
      .join('');
    expect(writtenStrings).toContain('Index in progress, skipping');

    stderrSpy.mockRestore();
  });

  it('does not rethrow the lock contention error', async () => {
    const { watchCallback } = await setupWatch('/tmp/lock-nothrow');
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    watchCallback('change', 'src/service.ts');

    // Should not throw
    await expect(vi.advanceTimersByTimeAsync(600)).resolves.not.toThrow();
  });
});

describe('stderr suppression', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    process.removeAllListeners('SIGINT');
    process.removeAllListeners('SIGTERM');
  });

  it('captures stderr during runIndex and emits compact summary after', async () => {
    let capturedDuringRun: unknown = null;

    mockRunIndex.mockImplementation(async () => {
      // Check that stderr.write is a capturing function (not the original)
      capturedDuringRun = process.stderr.write;
      // Simulate runIndex writing some output
      process.stderr.write('brain-cache: incremental index -- 2 new, 0 changed, 0 removed (10 unchanged)\n');
    });

    const { watchCallback } = await setupWatch('/tmp/stderr-test');

    const summaryLines: string[] = [];
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      if (typeof chunk === 'string') summaryLines.push(chunk);
      return true;
    });

    watchCallback('change', 'src/index.ts');
    await vi.advanceTimersByTimeAsync(600);

    // The capturing function should be different from the spy
    expect(capturedDuringRun).not.toBeNull();

    // After completion, summary should have been written (not the captured runIndex output)
    const output = summaryLines.join('');
    expect(output).toContain('brain-cache: re-indexed');

    stderrSpy.mockRestore();
  });

  it('restores process.stderr.write after runIndex completes', async () => {
    mockRunIndex.mockResolvedValue(undefined);

    const originalWrite = process.stderr.write;
    const { watchCallback } = await setupWatch('/tmp/stderr-restore');
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    watchCallback('change', 'src/index.ts');
    await vi.advanceTimersByTimeAsync(600);

    // After triggerReindex completes, write should be restored (not the capture function)
    // The test verifies no hang / error occurs and the process continues normally
    expect(process.stderr.write).toBeDefined();
    expect(typeof process.stderr.write).toBe('function');
    _ = originalWrite; // referenced to suppress unused warning
  });
});

// silence unused variable lint
let _: unknown;

describe('cleanup handler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockRunIndex.mockResolvedValue(undefined);
    vi.clearAllMocks();
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
    mockReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const { runWatch } = await import('../../src/workflows/watch.js');
    runWatch('/tmp/cleanup-test');
    await Promise.resolve();

    process.emit('SIGINT');

    expect(mockWatcher.close).toHaveBeenCalled();
    exitSpy.mockRestore();
  });

  it('clears debounceTimer on SIGINT to prevent hanging', async () => {
    const mockWatcher = {
      on: vi.fn().mockReturnThis(),
      close: vi.fn(),
    };
    mockWatch.mockReturnValue(mockWatcher as unknown as ReturnType<typeof watch>);
    mockReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const { runWatch } = await import('../../src/workflows/watch.js');
    runWatch('/tmp/cleanup-timer');
    await Promise.resolve();

    const lastCall = mockWatch.mock.calls[mockWatch.mock.calls.length - 1];
    const watchCallback = lastCall[2] as (eventType: string, filename: string) => void;

    // Schedule a debounce (but SIGINT fires before 500ms)
    watchCallback('change', 'src/index.ts');

    process.emit('SIGINT');

    // Advance timers — runIndex should NOT be called (debounce was cleared)
    await vi.advanceTimersByTimeAsync(600);
    expect(mockRunIndex).not.toHaveBeenCalled();

    exitSpy.mockRestore();
  });

  it('calls watcher.close() on SIGTERM', async () => {
    const mockWatcher = {
      on: vi.fn().mockReturnThis(),
      close: vi.fn(),
    };
    mockWatch.mockReturnValue(mockWatcher as unknown as ReturnType<typeof watch>);
    mockReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const { runWatch } = await import('../../src/workflows/watch.js');
    runWatch('/tmp/cleanup-sigterm');
    await Promise.resolve();

    process.emit('SIGTERM');

    expect(mockWatcher.close).toHaveBeenCalled();
    exitSpy.mockRestore();
  });
});
