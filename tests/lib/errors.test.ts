import { describe, it, expect } from 'vitest';
import { NoIndexError } from '../../src/lib/errors.js';

describe('NoIndexError', () => {
  it('instanceof NoIndexError returns true', () => {
    const err = new NoIndexError('/some/path');
    expect(err instanceof NoIndexError).toBe(true);
  });

  it('instanceof Error returns true', () => {
    const err = new NoIndexError('/some/path');
    expect(err instanceof Error).toBe(true);
  });

  it('message matches expected format string', () => {
    const err = new NoIndexError('/some/path');
    expect(err.message).toBe("No index found at /some/path. Run 'brain-cache index' first.");
  });

  it('rootDir stores the provided root directory path', () => {
    const err = new NoIndexError('/some/path');
    expect(err.rootDir).toBe('/some/path');
  });

  it('name equals NoIndexError', () => {
    const err = new NoIndexError('/some/path');
    expect(err.name).toBe('NoIndexError');
  });

  it('can be discriminated via instanceof in a catch block', () => {
    let caught: unknown;
    try {
      throw new NoIndexError('/x');
    } catch (e) {
      caught = e;
    }
    expect(caught instanceof NoIndexError).toBe(true);
    if (caught instanceof NoIndexError) {
      expect(caught.rootDir).toBe('/x');
    }
  });
});
