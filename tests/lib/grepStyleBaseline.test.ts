import { connect } from '@lancedb/lancedb';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { computeGrepStyleBaseline } from '../../src/lib/grepStyleBaseline.js';
import { TOOL_CALL_OVERHEAD_TOKENS } from '../../src/lib/config.js';

it('streams only ranking metadata while preserving file scores and token totals', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'brain-cache-baseline-'));
  const db = await connect(dir);
  try {
    const table = await db.createTable('chunks', [
      { file_path: 'src/cache.ts', name: 'cache', content: 'large body', vector: [1, 0] },
      { file_path: 'src/cache.ts', name: 'cacheLookup', content: 'large body', vector: [0, 1] },
      { file_path: 'src/other.ts', name: 'cache', content: 'large body', vector: [1, 0] },
      { file_path: 'src/unrelated.ts', name: 'unrelated', content: 'large body', vector: [0, 1] },
    ]);
    const query = table.query();
    const select = vi.spyOn(query, 'select');
    const materialize = vi.spyOn(query, 'toArray');
    vi.spyOn(table, 'query').mockReturnValue(query);
    const readTokens = vi.fn().mockResolvedValue(20);
    expect(await computeGrepStyleBaseline(table, 'cache', { 'src/cache.ts': 100 }, readTokens))
      .toEqual({ filesUsed: 2, grepBaselineTokens: 120 + 3 * TOOL_CALL_OVERHEAD_TOKENS });
    expect(readTokens).toHaveBeenCalledExactlyOnceWith('src/other.ts');
    expect(select).toHaveBeenCalledWith(['file_path', 'name']);
    expect(materialize).not.toHaveBeenCalled();
    table.close();
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
