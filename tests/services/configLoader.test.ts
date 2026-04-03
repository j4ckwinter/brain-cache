import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fs/promises before importing configLoader
const mockReadFile = vi.fn();
vi.mock('node:fs/promises', () => ({
  readFile: (...args: unknown[]) => mockReadFile(...args),
}));

// Mock config module so CONFIG_PATH is predictable
vi.mock('../../src/lib/config.js', () => ({
  CONFIG_PATH: '/home/user/.brain-cache/config.json',
}));

import { loadUserConfig, resolveStrategy } from '../../src/services/configLoader.js';
import { RETRIEVAL_STRATEGIES } from '../../src/services/retriever.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('loadUserConfig', () => {
  it('returns empty object when config file does not exist (ENOENT)', async () => {
    const err = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    mockReadFile.mockRejectedValue(err);

    const result = await loadUserConfig();

    expect(result).toEqual({});
  });

  it('returns parsed config when file exists with valid JSON', async () => {
    const configContent = JSON.stringify({ retrieval: { lookup: { limit: 8 } } });
    mockReadFile.mockResolvedValue(configContent);

    const result = await loadUserConfig();

    expect(result).toEqual({ retrieval: { lookup: { limit: 8 } } });
  });

  it('returns empty object when config file has invalid JSON', async () => {
    mockReadFile.mockResolvedValue('{ not valid json }');

    const result = await loadUserConfig();

    expect(result).toEqual({});
  });

  it('returns empty object when config file is empty', async () => {
    mockReadFile.mockResolvedValue('');

    const result = await loadUserConfig();

    expect(result).toEqual({});
  });

  it('reads from CONFIG_PATH', async () => {
    mockReadFile.mockResolvedValue('{}');

    await loadUserConfig();

    expect(mockReadFile).toHaveBeenCalledWith('/home/user/.brain-cache/config.json', 'utf-8');
  });
});

describe('resolveStrategy', () => {
  it('returns RETRIEVAL_STRATEGIES[mode] defaults when no user config and no tool override', () => {
    const result = resolveStrategy('lookup', {});

    expect(result).toEqual(RETRIEVAL_STRATEGIES['lookup']);
  });

  it('returns explore defaults when mode is explore and no overrides', () => {
    const result = resolveStrategy('explore', {});

    expect(result).toEqual(RETRIEVAL_STRATEGIES['explore']);
  });

  it('returns trace defaults when mode is trace and no overrides', () => {
    const result = resolveStrategy('trace', {});

    expect(result).toEqual(RETRIEVAL_STRATEGIES['trace']);
  });

  it('merges user config over defaults (user limit:8 overrides default limit:5 for lookup)', () => {
    const userConfig = { retrieval: { lookup: { limit: 8 } } };

    const result = resolveStrategy('lookup', userConfig);

    expect(result.limit).toBe(8);
    // distanceThreshold from default
    expect(result.distanceThreshold).toBe(RETRIEVAL_STRATEGIES['lookup'].distanceThreshold);
  });

  it('merges tool override over user config (tool limit:3 wins over user limit:8)', () => {
    const userConfig = { retrieval: { lookup: { limit: 8 } } };
    const toolOverride = { limit: 3 };

    const result = resolveStrategy('lookup', userConfig, toolOverride);

    expect(result.limit).toBe(3);
  });

  it('merges tool override distanceThreshold over defaults', () => {
    const result = resolveStrategy('lookup', {}, { distanceThreshold: 0.1 });

    expect(result.distanceThreshold).toBe(0.1);
    expect(result.limit).toBe(RETRIEVAL_STRATEGIES['lookup'].limit);
  });

  it('handles empty user config object for a mode (no retrieval key)', () => {
    const result = resolveStrategy('trace', { retrieval: {} });

    expect(result).toEqual(RETRIEVAL_STRATEGIES['trace']);
  });

  it('does not mutate the base RETRIEVAL_STRATEGIES object', () => {
    const originalLimit = RETRIEVAL_STRATEGIES['lookup'].limit;
    resolveStrategy('lookup', { retrieval: { lookup: { limit: 99 } } });

    expect(RETRIEVAL_STRATEGIES['lookup'].limit).toBe(originalLimit);
  });
});
