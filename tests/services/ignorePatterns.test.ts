import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

import { loadIgnorePatterns } from '../../src/services/ignorePatterns.js';

let tempDir: string;

beforeEach(async () => {
  tempDir = join(tmpdir(), `ignorePatterns-test-${randomUUID()}`);
  await mkdir(tempDir, { recursive: true });
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe('loadIgnorePatterns', () => {
  it('returns [] when no .braincacheignore file exists', async () => {
    const patterns = await loadIgnorePatterns(tempDir);
    expect(patterns).toEqual([]);
  });

  it('returns parsed patterns from a valid .braincacheignore file', async () => {
    await writeFile(join(tempDir, '.braincacheignore'), '*.test.ts\nfixtures/\n');
    const patterns = await loadIgnorePatterns(tempDir);
    expect(patterns).toContain('*.test.ts');
    expect(patterns).toContain('fixtures/');
    expect(patterns).toHaveLength(2);
  });

  it('skips comment lines (starting with #) and blank lines', async () => {
    const content = '# this is a comment\n*.test.ts\n\nfixtures/\n# another comment\n';
    await writeFile(join(tempDir, '.braincacheignore'), content);
    const patterns = await loadIgnorePatterns(tempDir);
    expect(patterns).toContain('*.test.ts');
    expect(patterns).toContain('fixtures/');
    expect(patterns).toHaveLength(2);
    expect(patterns.some(p => p.startsWith('#'))).toBe(false);
  });

  it('returns [] from a file with only comments and blank lines', async () => {
    const content = '# just a comment\n\n# another comment\n   \n';
    await writeFile(join(tempDir, '.braincacheignore'), content);
    const patterns = await loadIgnorePatterns(tempDir);
    expect(patterns).toEqual([]);
  });
});
