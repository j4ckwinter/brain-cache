import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// We dynamically import sessionStats after mocking so that SESSION_STATS_PATH
// is resolved using the mocked GLOBAL_CONFIG_DIR (set per-test via the factory).
// Each test uses a fresh temp directory so stats never bleed between tests.

let tempDir: string;

// Override GLOBAL_CONFIG_DIR dynamically per test by resetting the mock factory.
vi.mock('../../src/lib/config.js', () => ({
  GLOBAL_CONFIG_DIR: join(tmpdir(), '__stats_test_placeholder__'),
  SESSION_STATS_FILENAME: 'session-stats.json',
  PROJECT_DATA_DIR: '.brain-cache',
  PROFILE_PATH: '',
  CONFIG_PATH: '',
}));

// We also mock loadUserConfig to control TTL config in Test 8.
vi.mock('../../src/services/configLoader.js', () => ({
  loadUserConfig: vi.fn().mockResolvedValue({}),
}));

describe('sessionStats', () => {
  beforeEach(async () => {
    // Create a fresh temp directory for each test.
    tempDir = await mkdtemp(join(tmpdir(), 'stats-test-'));

    // Point GLOBAL_CONFIG_DIR mock to fresh temp directory.
    const configMod = await import('../../src/lib/config.js');
    (configMod as Record<string, unknown>).GLOBAL_CONFIG_DIR = tempDir;

    // Reset configLoader mock to default (no custom TTL).
    const { loadUserConfig } = await import('../../src/services/configLoader.js');
    vi.mocked(loadUserConfig).mockResolvedValue({});

    // Reset the mutex in sessionStats between tests.
    const stats = await import('../../src/services/sessionStats.js');
    stats._resetMutexForTesting();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    vi.resetModules();
  });

  it('Test 1: creates stats file when none exists', async () => {
    const { accumulateStats } = await import('../../src/services/sessionStats.js');
    const statsPath = join(tempDir, 'session-stats.json');

    await accumulateStats({ tokensSent: 100, estimatedWithoutBraincache: 400 });

    const raw = await readFile(statsPath, 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed.tokensSent).toBe(100);
    expect(parsed.estimatedWithoutBraincache).toBe(400);
    expect(parsed.callCount).toBe(1);
    expect(typeof parsed.lastUpdatedAt).toBe('string');
    // lastUpdatedAt should be a valid ISO date
    expect(new Date(parsed.lastUpdatedAt).toISOString()).toBe(parsed.lastUpdatedAt);
  });

  it('Test 2: accumulates onto existing file', async () => {
    const { accumulateStats } = await import('../../src/services/sessionStats.js');
    const statsPath = join(tempDir, 'session-stats.json');

    await accumulateStats({ tokensSent: 100, estimatedWithoutBraincache: 300 });
    await accumulateStats({ tokensSent: 100, estimatedWithoutBraincache: 300 });

    const raw = await readFile(statsPath, 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed.tokensSent).toBe(200);
    expect(parsed.estimatedWithoutBraincache).toBe(600);
    expect(parsed.callCount).toBe(2);
  });

  it('Test 3: concurrent calls produce sum of both deltas', async () => {
    const { accumulateStats } = await import('../../src/services/sessionStats.js');
    const statsPath = join(tempDir, 'session-stats.json');

    const p1 = accumulateStats({ tokensSent: 50, estimatedWithoutBraincache: 150 });
    const p2 = accumulateStats({ tokensSent: 70, estimatedWithoutBraincache: 200 });
    await Promise.all([p1, p2]);

    const raw = await readFile(statsPath, 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed.tokensSent).toBe(120);
    expect(parsed.estimatedWithoutBraincache).toBe(350);
    expect(parsed.callCount).toBe(2);
  });

  it('Test 4: resets counters when existing file is older than TTL', async () => {
    const { accumulateStats } = await import('../../src/services/sessionStats.js');
    const statsPath = join(tempDir, 'session-stats.json');

    // Write a stale stats file (older than the TTL we will pass).
    const stale: Record<string, unknown> = {
      tokensSent: 999,
      estimatedWithoutBraincache: 9999,
      callCount: 10,
      lastUpdatedAt: new Date(Date.now() - 200).toISOString(), // 200ms ago
    };
    await writeFile(statsPath, JSON.stringify(stale), 'utf-8');

    // Use ttlMs of 100ms so 200ms-old file is expired.
    await accumulateStats({ tokensSent: 50, estimatedWithoutBraincache: 150 }, 100);

    const raw = await readFile(statsPath, 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed.tokensSent).toBe(50);
    expect(parsed.estimatedWithoutBraincache).toBe(150);
    expect(parsed.callCount).toBe(1);
  });

  it('Test 5: accumulates when existing file is within TTL', async () => {
    const { accumulateStats } = await import('../../src/services/sessionStats.js');
    const statsPath = join(tempDir, 'session-stats.json');

    // Write a fresh stats file (within TTL).
    const fresh: Record<string, unknown> = {
      tokensSent: 100,
      estimatedWithoutBraincache: 300,
      callCount: 3,
      lastUpdatedAt: new Date().toISOString(),
    };
    await writeFile(statsPath, JSON.stringify(fresh), 'utf-8');

    // Use a large ttlMs so the file is within TTL.
    await accumulateStats({ tokensSent: 50, estimatedWithoutBraincache: 150 }, 7_200_000);

    const raw = await readFile(statsPath, 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed.tokensSent).toBe(150);
    expect(parsed.estimatedWithoutBraincache).toBe(450);
    expect(parsed.callCount).toBe(4);
  });

  it('Test 6: does not throw on write failure', async () => {
    const { accumulateStats } = await import('../../src/services/sessionStats.js');

    // Use a path under /proc where writing will fail (read-only kernel fs).
    // We simulate failure by mocking the whole temp dir as unwritable root.
    // Simplest approach: mock writeFile to throw.
    const fsPromises = await import('node:fs/promises');
    const originalWriteFile = fsPromises.writeFile;
    vi.spyOn(fsPromises, 'writeFile').mockRejectedValueOnce(new Error('EACCES: permission denied'));

    // Should resolve without throwing.
    await expect(
      accumulateStats({ tokensSent: 100, estimatedWithoutBraincache: 300 })
    ).resolves.toBeUndefined();

    vi.restoreAllMocks();
  });

  it('Test 7: stats file is valid JSON with exactly the four expected keys', async () => {
    const { accumulateStats } = await import('../../src/services/sessionStats.js');
    const statsPath = join(tempDir, 'session-stats.json');

    await accumulateStats({ tokensSent: 80, estimatedWithoutBraincache: 240 });

    const raw = await readFile(statsPath, 'utf-8');
    const parsed = JSON.parse(raw);
    const keys = Object.keys(parsed).sort();
    expect(keys).toEqual(
      ['callCount', 'estimatedWithoutBraincache', 'lastUpdatedAt', 'tokensSent']
    );
  });

  it('Test 8: reads custom TTL from config.json via loadUserConfig', async () => {
    // Mock loadUserConfig to return 0.5h (30 minutes) custom TTL.
    const { loadUserConfig } = await import('../../src/services/configLoader.js');
    vi.mocked(loadUserConfig).mockResolvedValue({ stats: { ttlHours: 0.5 } });

    const { accumulateStats } = await import('../../src/services/sessionStats.js');
    const statsPath = join(tempDir, 'session-stats.json');

    // Write a file 45 minutes old (within default 2h TTL, but beyond 30m custom TTL).
    const fortyFiveMinutesAgo = new Date(Date.now() - 45 * 60 * 1000).toISOString();
    const stale: Record<string, unknown> = {
      tokensSent: 500,
      estimatedWithoutBraincache: 2000,
      callCount: 5,
      lastUpdatedAt: fortyFiveMinutesAgo,
    };
    await writeFile(statsPath, JSON.stringify(stale), 'utf-8');

    // Call WITHOUT passing ttlMs — should read from loadUserConfig (30-min TTL → reset).
    await accumulateStats({ tokensSent: 50, estimatedWithoutBraincache: 200 });

    const raw = await readFile(statsPath, 'utf-8');
    const parsed = JSON.parse(raw);
    // Counters should have reset because 45 min > 30 min custom TTL.
    expect(parsed.tokensSent).toBe(50);
    expect(parsed.estimatedWithoutBraincache).toBe(200);
    expect(parsed.callCount).toBe(1);
  });
});
