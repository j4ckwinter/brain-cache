import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _originalStderrWrite, withStderrFilter } from '../../src/lib/stderr.js';

describe('nested stderr filter - watch triggers index', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('inner filter captures before outer', async () => {
    const outerCaptured: string[] = [];
    const innerCaptured: string[] = [];

    await withStderrFilter(
      (line) => {
        outerCaptured.push(line);
        return true;
      },
      async () => {
        await withStderrFilter(
          (line) => {
            if (line.includes('inner-only')) {
              innerCaptured.push(line);
              return true;
            }
            return false;
          },
          async () => {
            process.stderr.write('inner-only line\n');
          },
        );
      },
    );

    expect(innerCaptured).toContain('inner-only line\n');
    expect(outerCaptured).not.toContain('inner-only line\n');
  });

  it('outer filter resumes after inner pops', async () => {
    const outerCaptured: string[] = [];

    await withStderrFilter(
      (line) => {
        outerCaptured.push(line);
        return true;
      },
      async () => {
        await withStderrFilter(
          (line) => line.includes('inner-only'),
          async () => {
            process.stderr.write('inner-only line\n');
          },
        );

        process.stderr.write('outer-still-active line\n');
      },
    );

    expect(outerCaptured).toContain('outer-still-active line\n');
    expect(outerCaptured).not.toContain('inner-only line\n');
  });

  it('no filter leakage after both pop', async () => {
    const outerCaptured: string[] = [];
    const innerCaptured: string[] = [];

    await withStderrFilter(
      (line) => {
        outerCaptured.push(line);
        return true;
      },
      async () => {
        await withStderrFilter(
          (line) => {
            innerCaptured.push(line);
            return true;
          },
          async () => {
            process.stderr.write('captured in inner\n');
          },
        );
      },
    );

    const beforeOuterCount = outerCaptured.length;
    const beforeInnerCount = innerCaptured.length;
    process.stderr.write('after-both-popped line\n');

    expect(outerCaptured).toHaveLength(beforeOuterCount);
    expect(innerCaptured).toHaveLength(beforeInnerCount);
    expect(typeof _originalStderrWrite).toBe('function');
  });

  it('watch-triggers-index scenario with LanceDB log suppression', async () => {
    const outerCaptured: string[] = [];
    const lanceRegex = /^\[\d{4}-\d{2}-\d{2}T[\d:.]+Z (WARN|INFO) lance/;

    await withStderrFilter(
      (line) => {
        outerCaptured.push(line);
        return true;
      },
      async () => {
        await withStderrFilter(
          (line) => lanceRegex.test(line),
          async () => {
            process.stderr.write('[2026-04-07T00:00:00Z WARN lance::dataset] noisy rust line\n');
            process.stderr.write('brain-cache: found 5 source files\n');
          },
        );

        process.stderr.write('brain-cache: re-indexed in 1.2s\n');
      },
    );

    expect(
      outerCaptured.some((line) => line.includes('WARN lance::dataset')),
    ).toBe(false);
    expect(
      outerCaptured.some((line) => line.includes('brain-cache: found 5 source files')),
    ).toBe(true);
    expect(
      outerCaptured.some((line) => line.includes('brain-cache: re-indexed in 1.2s')),
    ).toBe(true);
  });
});
