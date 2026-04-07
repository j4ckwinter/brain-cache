import { crawlSourceFiles } from '../services/crawler.js';
import { statAllFiles } from './fsUtils.js';
import { FILE_READ_CONCURRENCY } from './config.js';

export interface StalenessResult {
  stale: boolean;
  stalestFile?: string;
  stalestMtime?: string;
}

export async function checkIndexStaleness(
  rootDir: string,
  indexedAt: string,
): Promise<StalenessResult> {
  const indexedAtMs = Date.parse(indexedAt);
  const files = await crawlSourceFiles(rootDir);

  const statsMap = await statAllFiles(files, FILE_READ_CONCURRENCY);

  let stalestFile: string | undefined;
  let stalestMtimeMs = 0;

  for (const filePath of files) {
    const entry = statsMap.get(filePath);
    if (!entry) continue; // file vanished between crawl and stat
    if (entry.mtimeMs > indexedAtMs && entry.mtimeMs > stalestMtimeMs) {
      stalestMtimeMs = entry.mtimeMs;
      stalestFile = filePath;
    }
  }

  if (stalestFile) {
    return {
      stale: true,
      stalestFile,
      stalestMtime: new Date(stalestMtimeMs).toISOString(),
    };
  }
  return { stale: false };
}
