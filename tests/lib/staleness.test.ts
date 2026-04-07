import { describe, it, expect, vi, beforeEach } from 'vitest';
import { checkIndexStaleness } from '../../src/lib/staleness.js';
import * as crawler from '../../src/services/crawler.js';
import * as fsUtils from '../../src/lib/fsUtils.js';

vi.mock('../../src/services/crawler.js', () => ({
  crawlSourceFiles: vi.fn(),
}));

vi.mock('../../src/lib/fsUtils.js', () => ({
  statAllFiles: vi.fn(),
}));

const mockCrawl = vi.mocked(crawler.crawlSourceFiles);
const mockStatAllFiles = vi.mocked(fsUtils.statAllFiles);

describe('checkIndexStaleness', () => {
  const indexedAt = '2026-01-01T00:00:00.000Z';
  const indexedMs = Date.parse(indexedAt);

  beforeEach(() => {
    mockCrawl.mockReset();
    mockStatAllFiles.mockReset();
  });

  it('returns stale when a file has mtime after indexedAt', async () => {
    mockCrawl.mockResolvedValue(['/proj/a.ts']);
    mockStatAllFiles.mockResolvedValue(
      new Map([['/proj/a.ts', { size: 100, mtimeMs: indexedMs + 10_000 }]])
    );

    const r = await checkIndexStaleness('/proj', indexedAt);
    expect(r.stale).toBe(true);
    expect(r.stalestFile).toBe('/proj/a.ts');
    expect(r.stalestMtime).toBeDefined();
  });

  it('returns not stale when all files predate indexedAt', async () => {
    mockCrawl.mockResolvedValue(['/proj/a.ts']);
    mockStatAllFiles.mockResolvedValue(
      new Map([['/proj/a.ts', { size: 100, mtimeMs: indexedMs - 10_000 }]])
    );

    const r = await checkIndexStaleness('/proj', indexedAt);
    expect(r.stale).toBe(false);
  });

  it('returns not stale when no files are crawled', async () => {
    mockCrawl.mockResolvedValue([]);
    mockStatAllFiles.mockResolvedValue(new Map());

    const r = await checkIndexStaleness('/proj', indexedAt);
    expect(r.stale).toBe(false);
  });

  it('skips files that vanish between crawl and stat (missing from map)', async () => {
    mockCrawl.mockResolvedValue(['/proj/missing.ts', '/proj/b.ts']);
    mockStatAllFiles.mockResolvedValue(
      new Map([['/proj/b.ts', { size: 100, mtimeMs: indexedMs - 1 }]])
    );

    const r = await checkIndexStaleness('/proj', indexedAt);
    expect(r.stale).toBe(false);
  });

  it('picks the most recently modified stale file', async () => {
    mockCrawl.mockResolvedValue(['/proj/old.ts', '/proj/newer.ts']);
    mockStatAllFiles.mockResolvedValue(
      new Map([
        ['/proj/old.ts', { size: 100, mtimeMs: indexedMs + 1000 }],
        ['/proj/newer.ts', { size: 100, mtimeMs: indexedMs + 5000 }],
      ])
    );

    const r = await checkIndexStaleness('/proj', indexedAt);
    expect(r.stale).toBe(true);
    expect(r.stalestFile).toBe('/proj/newer.ts');
  });

  it('calls statAllFiles with FILE_READ_CONCURRENCY (20)', async () => {
    mockCrawl.mockResolvedValue(['/proj/a.ts']);
    mockStatAllFiles.mockResolvedValue(new Map());

    await checkIndexStaleness('/proj', indexedAt);
    expect(mockStatAllFiles).toHaveBeenCalledWith(['/proj/a.ts'], 20);
  });
});
