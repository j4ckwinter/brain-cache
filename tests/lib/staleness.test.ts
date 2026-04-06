import { describe, it, expect, vi, beforeEach } from 'vitest';
import { stat } from 'node:fs/promises';
import { checkIndexStaleness } from '../../src/lib/staleness.js';
import * as crawler from '../../src/services/crawler.js';

vi.mock('../../src/services/crawler.js', () => ({
  crawlSourceFiles: vi.fn(),
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const mod = await importOriginal<typeof import('node:fs/promises')>();
  return { ...mod, stat: vi.fn() };
});

const mockCrawl = vi.mocked(crawler.crawlSourceFiles);
const mockStat = vi.mocked(stat);

describe('checkIndexStaleness', () => {
  const indexedAt = '2026-01-01T00:00:00.000Z';
  const indexedMs = Date.parse(indexedAt);

  beforeEach(() => {
    mockCrawl.mockReset();
    mockStat.mockReset();
  });

  it('returns stale when a file has mtime after indexedAt', async () => {
    mockCrawl.mockResolvedValue(['/proj/a.ts']);
    mockStat.mockResolvedValue({ mtimeMs: indexedMs + 10_000 } as Awaited<ReturnType<typeof stat>>);

    const r = await checkIndexStaleness('/proj', indexedAt);
    expect(r.stale).toBe(true);
    expect(r.stalestFile).toBe('/proj/a.ts');
    expect(r.stalestMtime).toBeDefined();
  });

  it('returns not stale when all files predate indexedAt', async () => {
    mockCrawl.mockResolvedValue(['/proj/a.ts']);
    mockStat.mockResolvedValue({ mtimeMs: indexedMs - 10_000 } as Awaited<ReturnType<typeof stat>>);

    const r = await checkIndexStaleness('/proj', indexedAt);
    expect(r.stale).toBe(false);
  });

  it('returns not stale when no files are crawled', async () => {
    mockCrawl.mockResolvedValue([]);

    const r = await checkIndexStaleness('/proj', indexedAt);
    expect(r.stale).toBe(false);
  });

  it('skips files that error on stat', async () => {
    mockCrawl.mockResolvedValue(['/proj/missing.ts', '/proj/b.ts']);
    mockStat.mockImplementation(async (p: string) => {
      if (p.includes('missing')) throw new Error('ENOENT');
      return { mtimeMs: indexedMs - 1 } as Awaited<ReturnType<typeof stat>>;
    });

    const r = await checkIndexStaleness('/proj', indexedAt);
    expect(r.stale).toBe(false);
  });

  it('picks the most recently modified stale file', async () => {
    mockCrawl.mockResolvedValue(['/proj/old.ts', '/proj/newer.ts']);
    mockStat.mockImplementation(async (p: string) => {
      if (p.includes('newer')) return { mtimeMs: indexedMs + 5000 } as Awaited<ReturnType<typeof stat>>;
      return { mtimeMs: indexedMs + 1000 } as Awaited<ReturnType<typeof stat>>;
    });

    const r = await checkIndexStaleness('/proj', indexedAt);
    expect(r.stale).toBe(true);
    expect(r.stalestFile).toBe('/proj/newer.ts');
  });
});
