import { stat } from 'node:fs/promises';

/**
 * Stat all files concurrently with capped concurrency.
 * Returns a Map from file path to { size, mtimeMs }.
 * Failures are silently omitted — callers treat missing entries as changed/stale.
 */
export async function statAllFiles(
  files: string[],
  concurrency: number,
): Promise<Map<string, { size: number; mtimeMs: number }>> {
  const result = new Map<string, { size: number; mtimeMs: number }>();
  for (let groupStart = 0; groupStart < files.length; groupStart += concurrency) {
    const group = files.slice(groupStart, groupStart + concurrency);
    const entries = await Promise.all(
      group.map(async (filePath) => {
        try {
          const s = await stat(filePath);
          return { filePath, size: s.size, mtimeMs: s.mtimeMs };
        } catch {
          return null;
        }
      })
    );
    for (const entry of entries) {
      if (entry !== null) {
        result.set(entry.filePath, { size: entry.size, mtimeMs: entry.mtimeMs });
      }
    }
  }
  return result;
}
