import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdir, writeFile, rm } from 'node:fs/promises';

// Mock node:child_process before importing the module
vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

// Mock node:fs/promises
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    readFile: vi.fn(),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
  };
});

import {
  classifyVRAMTier,
  selectEmbeddingModel,
  detectNvidiaVRAM,
  detectAppleSiliconVRAM,
  readProfile,
  writeProfile,
  detectCapabilities,
} from '../../src/services/capability.js';

import { execFile } from 'node:child_process';
import { readFile, writeFile as fsWriteFile, mkdir as fsMkdir } from 'node:fs/promises';

const mockExecFile = vi.mocked(execFile);
const mockReadFile = vi.mocked(readFile);
const mockWriteFile = vi.mocked(fsWriteFile);
const mockMkdir = vi.mocked(fsMkdir);

// Helper to mock execFile with promisify pattern
function mockExecFileSuccess(stdout: string) {
  mockExecFile.mockImplementation((...args: unknown[]) => {
    const cb = args[args.length - 1] as (err: null, result: { stdout: string; stderr: string }) => void;
    cb(null, { stdout, stderr: '' });
    return {} as ReturnType<typeof execFile>;
  });
}

function mockExecFileFailure(errorMessage = 'Command not found') {
  mockExecFile.mockImplementation((...args: unknown[]) => {
    const cb = args[args.length - 1] as (err: Error) => void;
    cb(new Error(errorMessage));
    return {} as ReturnType<typeof execFile>;
  });
}

describe('classifyVRAMTier', () => {
  it('returns none for null', () => {
    expect(classifyVRAMTier(null)).toBe('none');
  });

  it('returns none for 0', () => {
    expect(classifyVRAMTier(0)).toBe('none');
  });

  it('returns none for 1', () => {
    expect(classifyVRAMTier(1)).toBe('none');
  });

  it('returns standard for 2', () => {
    expect(classifyVRAMTier(2)).toBe('standard');
  });

  it('returns standard for 6', () => {
    expect(classifyVRAMTier(6)).toBe('standard');
  });

  it('returns standard for 7', () => {
    expect(classifyVRAMTier(7)).toBe('standard');
  });

  it('returns large for 8', () => {
    expect(classifyVRAMTier(8)).toBe('large');
  });

  it('returns large for 16', () => {
    expect(classifyVRAMTier(16)).toBe('large');
  });
});

describe('selectEmbeddingModel', () => {
  it('returns nomic-embed-text for none', () => {
    expect(selectEmbeddingModel('none')).toBe('nomic-embed-text');
  });

  it('returns nomic-embed-text for standard', () => {
    expect(selectEmbeddingModel('standard')).toBe('nomic-embed-text');
  });

  it('returns mxbai-embed-large for large', () => {
    expect(selectEmbeddingModel('large')).toBe('mxbai-embed-large');
  });
});

describe('detectNvidiaVRAM', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('parses "8192\\n" stdout to return 8 (GiB)', async () => {
    mockExecFileSuccess('8192\n');
    const result = await detectNvidiaVRAM();
    expect(result).toBe(8);
  });

  it('returns null when nvidia-smi not found (execFile throws)', async () => {
    mockExecFileFailure('nvidia-smi: command not found');
    const result = await detectNvidiaVRAM();
    expect(result).toBeNull();
  });

  it('returns null when nvidia-smi returns non-numeric output', async () => {
    mockExecFileSuccess('N/A\n');
    const result = await detectNvidiaVRAM();
    expect(result).toBeNull();
  });
});

describe('detectAppleSiliconVRAM', () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  });

  it('returns null on non-darwin platform', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    const result = await detectAppleSiliconVRAM();
    expect(result).toBeNull();
  });

  it('parses system_profiler JSON with physical_memory "16 GB" to return 16', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    const profileJson = JSON.stringify({
      SPHardwareDataType: [{
        physical_memory: '16 GB',
        chip_type: 'Apple M2 Pro',
      }],
    });
    mockExecFileSuccess(profileJson);
    const result = await detectAppleSiliconVRAM();
    expect(result).toBe(16);
  });

  it('returns null when system_profiler fails', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    mockExecFileFailure('system_profiler failed');
    const result = await detectAppleSiliconVRAM();
    expect(result).toBeNull();
  });

  it('returns null for Intel Mac (no chip_type containing "Apple M")', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    const profileJson = JSON.stringify({
      SPHardwareDataType: [{
        physical_memory: '16 GB',
        chip_type: 'Intel Core i9',
      }],
    });
    mockExecFileSuccess(profileJson);
    const result = await detectAppleSiliconVRAM();
    expect(result).toBeNull();
  });
});

describe('writeProfile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
  });

  it('creates ~/.brain-cache/ directory and writes valid JSON', async () => {
    const profile = {
      version: 1 as const,
      detectedAt: new Date().toISOString(),
      vramTier: 'large' as const,
      vramGiB: 16,
      gpuVendor: 'nvidia' as const,
      embeddingModel: 'mxbai-embed-large',
      ollamaVersion: '0.1.0',
      platform: 'linux',
    };

    await writeProfile(profile);

    expect(mockMkdir).toHaveBeenCalledWith(
      expect.stringContaining('.brain-cache'),
      { recursive: true }
    );
    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining('profile.json'),
      expect.stringContaining('"version": 1'),
    );
  });
});

describe('readProfile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns parsed CapabilityProfile from valid JSON file', async () => {
    const profile = {
      version: 1,
      detectedAt: new Date().toISOString(),
      vramTier: 'large',
      vramGiB: 16,
      gpuVendor: 'nvidia',
      embeddingModel: 'mxbai-embed-large',
      ollamaVersion: '0.1.0',
      platform: 'linux',
    };
    mockReadFile.mockResolvedValue(JSON.stringify(profile) as unknown as Buffer);

    const result = await readProfile();
    expect(result).not.toBeNull();
    expect(result?.version).toBe(1);
    expect(result?.vramTier).toBe('large');
  });

  it('returns null when file does not exist', async () => {
    const err = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    mockReadFile.mockRejectedValue(err);

    const result = await readProfile();
    expect(result).toBeNull();
  });

  it('returns null when file contains invalid JSON', async () => {
    mockReadFile.mockResolvedValue('not valid json' as unknown as Buffer);

    const result = await readProfile();
    expect(result).toBeNull();
  });

  it('returns null when file fails schema validation', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ invalid: true }) as unknown as Buffer);

    const result = await readProfile();
    expect(result).toBeNull();
  });
});

describe('detectCapabilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a complete CapabilityProfile object', async () => {
    // Mock nvidia-smi to fail so we don't need GPU hardware
    mockExecFile.mockImplementation((...args: unknown[]) => {
      const cmd = args[0] as string;
      const cb = args[args.length - 1] as (err: Error) => void;
      // All commands fail — simulates no GPU environment
      cb(new Error(`${cmd}: not found`));
      return {} as ReturnType<typeof execFile>;
    });

    const result = await detectCapabilities();

    expect(result).toBeDefined();
    expect(result.version).toBe(1);
    expect(result.vramTier).toBeDefined();
    expect(result.embeddingModel).toBeDefined();
    expect(result.gpuVendor).toBeDefined();
    expect(result.platform).toBeDefined();
    expect(result.detectedAt).toBeDefined();
  });
});
