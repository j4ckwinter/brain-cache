import { stat } from 'node:fs/promises';
import { crawlSourceFiles } from '../services/crawler.js';

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

  let stalestFile: string | undefined;
  let stalestMtimeMs = 0;

  for (const filePath of files) {
    try {
      const s = await stat(filePath);
      if (s.mtimeMs > indexedAtMs && s.mtimeMs > stalestMtimeMs) {
        stalestMtimeMs = s.mtimeMs;
        stalestFile = filePath;
      }
    } catch {
      // File disappeared between crawl and stat — skip
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
