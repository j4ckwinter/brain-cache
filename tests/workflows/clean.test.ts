import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

describe('runClean', () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
  });

  it('removes .brain-cache/ directory and confirms via stdout', async () => {
    const { runClean } = await import('../../src/workflows/clean.js');
    const tempDir = await mkdtemp(join(tmpdir(), 'brain-cache-test-'));
    try {
      await mkdir(join(tempDir, '.brain-cache'), { recursive: true });
      expect(existsSync(join(tempDir, '.brain-cache'))).toBe(true);

      await runClean(tempDir);

      expect(existsSync(join(tempDir, '.brain-cache'))).toBe(false);
      const output = (stdoutSpy.mock.calls as [string][]).map((c) => c[0]).join('');
      expect(output).toContain('removed');
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('prints informational message when no .brain-cache/ directory exists', async () => {
    const { runClean } = await import('../../src/workflows/clean.js');
    const tempDir = await mkdtemp(join(tmpdir(), 'brain-cache-test-'));
    try {
      // No .brain-cache/ inside — do not create it

      await runClean(tempDir);

      const output = (stdoutSpy.mock.calls as [string][]).map((c) => c[0]).join('');
      expect(output).toContain('no index directory');
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('throws when path is filesystem root (/)', async () => {
    const { runClean } = await import('../../src/workflows/clean.js');
    await expect(runClean('/')).rejects.toThrow();
  });

  it('throws when path is home directory', async () => {
    const { runClean } = await import('../../src/workflows/clean.js');
    await expect(runClean(homedir())).rejects.toThrow();
  });

  it('defaults to current directory when no argument given', async () => {
    const { runClean } = await import('../../src/workflows/clean.js');
    // Run with no argument — should not throw (no .brain-cache/ in cwd)
    // Just verify it runs without error (cwd is likely not sensitive)
    await expect(runClean()).resolves.not.toThrow();
  });
});
