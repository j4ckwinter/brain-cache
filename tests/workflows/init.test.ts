import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock service modules before importing workflows
vi.mock('../../src/services/capability.js', () => ({
  detectCapabilities: vi.fn(),
  readProfile: vi.fn(),
  writeProfile: vi.fn(),
}));

vi.mock('../../src/services/ollama.js', () => ({
  isOllamaInstalled: vi.fn(),
  isOllamaRunning: vi.fn(),
  startOllama: vi.fn(),
  pullModelIfMissing: vi.fn(),
  getOllamaVersion: vi.fn(),
  modelMatches: vi.fn((listedName: string, profileModel: string) => {
    const listedBase = listedName.split(':')[0];
    const profileBase = profileModel.split(':')[0];
    return listedBase === profileBase;
  }),
}));

vi.mock('../../src/services/embedder.js', () => ({
  embedBatchWithRetry: vi.fn().mockResolvedValue([[0.1, 0.2]]),
}));

vi.mock('ollama', () => ({
  default: {
    list: vi.fn(),
  },
}));

import {
  detectCapabilities,
  readProfile,
  writeProfile,
} from '../../src/services/capability.js';
import {
  isOllamaInstalled,
  isOllamaRunning,
  startOllama,
  pullModelIfMissing,
  getOllamaVersion,
} from '../../src/services/ollama.js';
import { embedBatchWithRetry } from '../../src/services/embedder.js';
import ollamaClient from 'ollama';

// These will be imported after mocks are set up
let runInit: () => Promise<void>;
let runDoctor: () => Promise<void>;

const mockDetectCapabilities = vi.mocked(detectCapabilities);
const mockReadProfile = vi.mocked(readProfile);
const mockWriteProfile = vi.mocked(writeProfile);
const mockIsOllamaInstalled = vi.mocked(isOllamaInstalled);
const mockIsOllamaRunning = vi.mocked(isOllamaRunning);
const mockStartOllama = vi.mocked(startOllama);
const mockPullModelIfMissing = vi.mocked(pullModelIfMissing);
const mockGetOllamaVersion = vi.mocked(getOllamaVersion);
const mockEmbedBatchWithRetry = vi.mocked(embedBatchWithRetry);
const mockOllamaList = vi.mocked(ollamaClient.list);

const mockProfile = {
  version: 1 as const,
  detectedAt: '2026-03-31T00:00:00.000Z',
  vramTier: 'large' as const,
  vramGiB: 16,
  gpuVendor: 'nvidia' as const,
  embeddingModel: 'mxbai-embed-large',
  ollamaVersion: null,
  platform: 'linux',
};

describe('runInit', () => {
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

    // Default happy path mocks
    mockDetectCapabilities.mockResolvedValue({ ...mockProfile });
    mockIsOllamaInstalled.mockResolvedValue(true);
    mockIsOllamaRunning.mockResolvedValue(true);
    mockStartOllama.mockResolvedValue(true);
    mockPullModelIfMissing.mockResolvedValue(undefined);
    mockGetOllamaVersion.mockResolvedValue('ollama version 0.6.3');
    mockWriteProfile.mockResolvedValue(undefined);
    mockEmbedBatchWithRetry.mockResolvedValue([[0.1, 0.2]]);

    // Dynamically import to ensure mocks are in place
    const mod = await import('../../src/workflows/init.js');
    runInit = mod.runInit;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('calls detectCapabilities during init', async () => {
    await runInit();
    expect(mockDetectCapabilities).toHaveBeenCalledOnce();
  });

  it('calls isOllamaInstalled to check Ollama availability', async () => {
    await runInit();
    expect(mockIsOllamaInstalled).toHaveBeenCalledOnce();
  });

  it('calls isOllamaRunning to check server status', async () => {
    await runInit();
    expect(mockIsOllamaRunning).toHaveBeenCalledOnce();
  });

  it('calls pullModelIfMissing with the detected embedding model', async () => {
    await runInit();
    expect(mockPullModelIfMissing).toHaveBeenCalledWith('mxbai-embed-large');
  });

  it('calls writeProfile after successful setup', async () => {
    await runInit();
    expect(mockWriteProfile).toHaveBeenCalledOnce();
  });

  it('writes profile that includes Ollama version', async () => {
    await runInit();
    const profileArg = mockWriteProfile.mock.calls[0][0];
    expect(profileArg.ollamaVersion).toBe('ollama version 0.6.3');
  });

  it('exits with code 1 when Ollama is not installed', async () => {
    mockIsOllamaInstalled.mockResolvedValue(false);
    await expect(runInit()).rejects.toThrow('process.exit(1)');
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  it('prints install instructions to stderr when Ollama is not installed', async () => {
    mockIsOllamaInstalled.mockResolvedValue(false);
    try {
      await runInit();
    } catch {
      // expected
    }
    const combined = stderrOutput.join('');
    expect(combined).toContain('Ollama is not installed');
    expect(combined).toContain('brain-cache init');
  });

  it('auto-starts Ollama when installed but not running', async () => {
    mockIsOllamaRunning.mockResolvedValue(false);
    mockStartOllama.mockResolvedValue(true);
    await runInit();
    expect(mockStartOllama).toHaveBeenCalledOnce();
  });

  it('exits with code 1 when Ollama auto-start fails', async () => {
    mockIsOllamaRunning.mockResolvedValue(false);
    mockStartOllama.mockResolvedValue(false);
    await expect(runInit()).rejects.toThrow('process.exit(1)');
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  it('prints stderr message with ollama serve when auto-start fails', async () => {
    mockIsOllamaRunning.mockResolvedValue(false);
    mockStartOllama.mockResolvedValue(false);
    try {
      await runInit();
    } catch {
      // expected
    }
    const combined = stderrOutput.join('');
    expect(combined).toContain('ollama serve');
  });

  it('warns on stderr about slower indexing when vramTier is none (CPU-only)', async () => {
    mockDetectCapabilities.mockResolvedValue({
      ...mockProfile,
      vramTier: 'none',
      vramGiB: null,
      gpuVendor: 'none',
      embeddingModel: 'nomic-embed-text',
    });
    await runInit();
    const combined = stderrOutput.join('');
    expect(combined).toContain('CPU');
    expect(combined).toContain('slower');
  });

  it('succeeds on CPU-only machines (does not exit)', async () => {
    mockDetectCapabilities.mockResolvedValue({
      ...mockProfile,
      vramTier: 'none',
      vramGiB: null,
      gpuVendor: 'none',
      embeddingModel: 'nomic-embed-text',
    });
    await expect(runInit()).resolves.toBeUndefined();
    expect(processExitSpy).not.toHaveBeenCalled();
  });

  it('produces zero output on stdout', async () => {
    await runInit();
    expect(stdoutOutput).toHaveLength(0);
    expect(stdoutWriteSpy).not.toHaveBeenCalled();
  });

  it('prints success summary to stderr after completing', async () => {
    await runInit();
    const combined = stderrOutput.join('');
    expect(combined).toContain('brain-cache initialized successfully');
  });

  it('warms model into VRAM after pull', async () => {
    await runInit();
    expect(mockEmbedBatchWithRetry).toHaveBeenCalledWith('mxbai-embed-large', ['warmup']);
  });

  it('prints warming message to stderr', async () => {
    await runInit();
    const combined = stderrOutput.join('');
    expect(combined).toContain('warming model');
    expect(combined).toContain('model warm.');
  });
});

describe('runDoctor', () => {
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

    // Default: profile exists
    mockReadProfile.mockResolvedValue({ ...mockProfile, ollamaVersion: 'ollama version 0.6.3' });
    mockDetectCapabilities.mockResolvedValue({ ...mockProfile });
    mockIsOllamaInstalled.mockResolvedValue(true);
    mockIsOllamaRunning.mockResolvedValue(true);
    mockGetOllamaVersion.mockResolvedValue('ollama version 0.6.3');
    // Default: model is present
    mockOllamaList.mockResolvedValue({ models: [{ name: 'mxbai-embed-large:latest' }] } as never);

    const mod = await import('../../src/workflows/doctor.js');
    runDoctor = mod.runDoctor;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('reads existing profile via readProfile', async () => {
    await runDoctor();
    expect(mockReadProfile).toHaveBeenCalledOnce();
  });

  it('exits with code 1 and prints message when no profile found', async () => {
    mockReadProfile.mockResolvedValue(null);
    await expect(runDoctor()).rejects.toThrow('process.exit(1)');
    const combined = stderrOutput.join('');
    expect(combined).toContain("brain-cache init");
  });

  it('re-detects capabilities (fresh detection)', async () => {
    await runDoctor();
    expect(mockDetectCapabilities).toHaveBeenCalledOnce();
  });

  it('checks Ollama installed status', async () => {
    await runDoctor();
    expect(mockIsOllamaInstalled).toHaveBeenCalledOnce();
  });

  it('checks Ollama running status', async () => {
    await runDoctor();
    expect(mockIsOllamaRunning).toHaveBeenCalledOnce();
  });

  it('reports Ollama version in health report', async () => {
    await runDoctor();
    const combined = stderrOutput.join('');
    expect(combined).toContain('0.6.3');
  });

  it('produces zero output on stdout', async () => {
    await runDoctor();
    expect(stdoutOutput).toHaveLength(0);
    expect(stdoutWriteSpy).not.toHaveBeenCalled();
  });

  it('includes saved profile GPU info in health report', async () => {
    await runDoctor();
    const combined = stderrOutput.join('');
    expect(combined).toContain('nvidia');
  });

  it('includes Ollama installed/running status in health report', async () => {
    await runDoctor();
    const combined = stderrOutput.join('');
    expect(combined.toLowerCase()).toContain('installed');
    expect(combined.toLowerCase()).toContain('running');
  });

  it('prints "Model loaded: yes" when the embedding model is present in Ollama', async () => {
    mockOllamaList.mockResolvedValue({
      models: [{ name: 'mxbai-embed-large:latest' }],
    } as never);
    await runDoctor();
    const combined = stderrOutput.join('');
    expect(combined).toContain('Model loaded:      yes');
  });

  it('prints actionable fix with ollama pull command when model is missing', async () => {
    mockOllamaList.mockResolvedValue({ models: [] } as never);
    await runDoctor();
    const combined = stderrOutput.join('');
    expect(combined).toContain('Model loaded:      no');
    expect(combined).toContain('ollama pull mxbai-embed-large');
  });
});
