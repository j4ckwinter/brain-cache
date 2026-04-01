import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock service modules before importing workflows
vi.mock('../../src/services/capability.js', () => ({
  readProfile: vi.fn(),
}));

vi.mock('../../src/services/lancedb.js', () => ({
  readIndexState: vi.fn(),
}));

import { readProfile } from '../../src/services/capability.js';
import { readIndexState } from '../../src/services/lancedb.js';

const mockReadProfile = vi.mocked(readProfile);
const mockReadIndexState = vi.mocked(readIndexState);

const mockProfile = {
  version: 1 as const,
  detectedAt: '2026-03-31T00:00:00.000Z',
  vramTier: 'large' as const,
  vramGiB: 16,
  gpuVendor: 'nvidia' as const,
  embeddingModel: 'mxbai-embed-large',
  ollamaVersion: 'ollama version 0.6.3',
  platform: 'linux',
};

const mockIndexState = {
  version: 1 as const,
  embeddingModel: 'mxbai-embed-large',
  dimension: 1024,
  indexedAt: '2026-03-31T12:00:00.000Z',
  fileCount: 42,
  chunkCount: 350,
};

let runStatus: (targetPath?: string) => Promise<void>;

describe('runStatus', () => {
  let stderrOutput: string[];
  let stdoutOutput: string[];
  let stderrWriteSpy: ReturnType<typeof vi.spyOn>;
  let stdoutWriteSpy: ReturnType<typeof vi.spyOn>;
  let processExitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    stderrOutput = [];
    stdoutOutput = [];

    stderrWriteSpy = vi.spyOn(process.stderr, 'write').mockImplementation((data: unknown) => {
      stderrOutput.push(String(data));
      return true;
    });
    stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation((data: unknown) => {
      stdoutOutput.push(String(data));
      return true;
    });
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation((_code?: unknown) => {
      throw new Error(`process.exit(${_code})`);
    });

    // Default happy path
    mockReadProfile.mockResolvedValue({ ...mockProfile });
    mockReadIndexState.mockResolvedValue({ ...mockIndexState });

    const mod = await import('../../src/workflows/status.js');
    runStatus = mod.runStatus;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('prints files indexed, chunks stored, last indexed time, and embedding model when profile and index exist', async () => {
    await runStatus();
    const combined = stderrOutput.join('');
    expect(combined).toContain('42');           // fileCount
    expect(combined).toContain('350');          // chunkCount
    expect(combined).toContain('2026-03-31');   // indexedAt
    expect(combined).toContain('mxbai-embed-large'); // embeddingModel
  });

  it('prints "No profile found" and exits 1 when no profile', async () => {
    mockReadProfile.mockResolvedValue(null);
    await expect(runStatus()).rejects.toThrow('process.exit(1)');
    expect(processExitSpy).toHaveBeenCalledWith(1);
    const combined = stderrOutput.join('');
    expect(combined).toContain("No profile found");
    expect(combined).toContain("brain-cache init");
  });

  it('prints "No index found" with actionable message and exits 1 when profile exists but no index', async () => {
    mockReadIndexState.mockResolvedValue(null);
    await expect(runStatus()).rejects.toThrow('process.exit(1)');
    expect(processExitSpy).toHaveBeenCalledWith(1);
    const combined = stderrOutput.join('');
    expect(combined).toContain("No index found");
    expect(combined).toContain("brain-cache index");
  });

  it('prints VRAM tier from profile', async () => {
    await runStatus();
    const combined = stderrOutput.join('');
    expect(combined).toContain('large');
  });

  it('produces zero output on stdout', async () => {
    await runStatus();
    expect(stdoutOutput).toHaveLength(0);
    expect(stdoutWriteSpy).not.toHaveBeenCalled();
  });
});
