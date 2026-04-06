/**
 * Controlled-mtime tempdir tests for the stat fast-path (DAILY-01, phase 48-03).
 *
 * These tests write real files to a tmpdir and manipulate mtimes to exercise
 * partitionByStatChange without mocking node:fs/promises.
 *
 * The core property: given a manifest with stored stats matching current file
 * size+mtime, partitionByStatChange classifies those files as statUnchanged.
 * When we mutate the file or change the mtime, the file becomes statChanged.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFile, utimes, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { stat } from 'node:fs/promises';
import { partitionByStatChange } from '../../src/workflows/index.js';
import type { FileStatEntry } from '../../src/lib/types.js';

/** Create a temporary directory for a single test. */
async function makeTmpDir(suffix: string): Promise<string> {
  const dir = join(tmpdir(), `brain-cache-stat-test-${suffix}-${Date.now()}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

/** Write a file and return its stat. */
async function writeAndStat(filePath: string, content: string): Promise<FileStatEntry> {
  await writeFile(filePath, content, 'utf-8');
  const s = await stat(filePath);
  return { size: s.size, mtimeMs: s.mtimeMs };
}

describe('partitionByStatChange — controlled-mtime tempdir', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await makeTmpDir('part');
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('classifies file as statUnchanged when size and mtime match manifest', async () => {
    const filePath = join(tmpDir, 'unchanged.ts');
    const storedEntry = await writeAndStat(filePath, 'const x = 1;');

    const currentStats = new Map([[filePath, { size: storedEntry.size, mtimeMs: storedEntry.mtimeMs }]]);
    const storedStats: Record<string, FileStatEntry> = { [filePath]: storedEntry };

    const { statUnchanged, statChanged } = partitionByStatChange([filePath], currentStats, storedStats);

    expect(statUnchanged).toEqual([filePath]);
    expect(statChanged).toEqual([]);
  });

  it('classifies file as statChanged when content is modified (size changes)', async () => {
    const filePath = join(tmpDir, 'changed.ts');
    const originalEntry = await writeAndStat(filePath, 'const x = 1;');

    // Overwrite with longer content — size changes
    await writeFile(filePath, 'const x = 1; const y = 2;', 'utf-8');
    const newStat = await stat(filePath);

    const currentStats = new Map([[filePath, { size: newStat.size, mtimeMs: newStat.mtimeMs }]]);
    const storedStats: Record<string, FileStatEntry> = { [filePath]: originalEntry };

    const { statChanged } = partitionByStatChange([filePath], currentStats, storedStats);

    expect(statChanged).toEqual([filePath]);
  });

  it('classifies file as statChanged when mtime is bumped (utimes) but size is same', async () => {
    const filePath = join(tmpDir, 'mtime-changed.ts');
    const originalEntry = await writeAndStat(filePath, 'const x = 1;');

    // Advance mtime by 5 seconds without changing content
    const futureMs = originalEntry.mtimeMs + 5000;
    const futureDate = new Date(futureMs);
    await utimes(filePath, futureDate, futureDate);

    const newStat = await stat(filePath);

    const currentStats = new Map([[filePath, { size: newStat.size, mtimeMs: newStat.mtimeMs }]]);
    const storedStats: Record<string, FileStatEntry> = { [filePath]: originalEntry };

    const { statChanged } = partitionByStatChange([filePath], currentStats, storedStats);

    expect(statChanged).toEqual([filePath]);
  });

  it('classifies multiple files correctly with mixed stat results', async () => {
    const unchangedPath = join(tmpDir, 'a.ts');
    const changedPath = join(tmpDir, 'b.ts');
    const newPath = join(tmpDir, 'c.ts');

    const unchangedEntry = await writeAndStat(unchangedPath, 'const a = 1;');
    const changedOrigEntry = await writeAndStat(changedPath, 'const b = 1;');
    const newEntry = await writeAndStat(newPath, 'const c = 1;');

    // Modify changedPath
    await writeFile(changedPath, 'const b = 999;', 'utf-8');
    const changedNewStat = await stat(changedPath);

    const currentStats = new Map([
      [unchangedPath, { size: unchangedEntry.size, mtimeMs: unchangedEntry.mtimeMs }],
      [changedPath, { size: changedNewStat.size, mtimeMs: changedNewStat.mtimeMs }],
      [newPath, { size: newEntry.size, mtimeMs: newEntry.mtimeMs }],
    ]);

    // storedStats: no entry for newPath (simulates new file)
    const storedStats: Record<string, FileStatEntry> = {
      [unchangedPath]: unchangedEntry,
      [changedPath]: changedOrigEntry,
    };

    const files = [unchangedPath, changedPath, newPath];
    const { statUnchanged, statChanged } = partitionByStatChange(files, currentStats, storedStats);

    expect(statUnchanged).toEqual([unchangedPath]);
    expect(statChanged).toContain(changedPath);
    expect(statChanged).toContain(newPath);
  });

  it('correctly handles a file with clock-skew scenario: stored mtime in future', async () => {
    // Simulate clock skew: stored mtime is 1 second ahead of current mtime
    const filePath = join(tmpDir, 'skew.ts');
    await writeFile(filePath, 'const x = 1;', 'utf-8');
    const currentStat = await stat(filePath);

    // Stored mtime is slightly different (simulating clock adjustment)
    const storedEntry: FileStatEntry = {
      size: currentStat.size,
      mtimeMs: currentStat.mtimeMs - 1000, // stored mtime is 1s earlier
    };

    const currentStats = new Map([[filePath, { size: currentStat.size, mtimeMs: currentStat.mtimeMs }]]);
    const storedStats: Record<string, FileStatEntry> = { [filePath]: storedEntry };

    // Mtime mismatch → statChanged (correct: re-hash to verify)
    const { statChanged } = partitionByStatChange([filePath], currentStats, storedStats);

    expect(statChanged).toEqual([filePath]);
  });
});
