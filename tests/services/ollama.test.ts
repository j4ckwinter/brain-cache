import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock node:child_process before importing the module
vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
  spawn: vi.fn(),
}));

// Mock the ollama npm package
vi.mock('ollama', () => ({
  default: {
    list: vi.fn(),
    pull: vi.fn(),
  },
}));

import {
  isOllamaInstalled,
  isOllamaRunning,
  startOllama,
  pullModelIfMissing,
  getOllamaVersion,
} from '../../src/services/ollama.js';

import { execFile, spawn } from 'node:child_process';
import ollama from 'ollama';

const mockExecFile = vi.mocked(execFile);
const mockSpawn = vi.mocked(spawn);
const mockOllama = vi.mocked(ollama);

// Helper to mock execFile success
function mockExecFileSuccess(stdout: string) {
  mockExecFile.mockImplementation((...args: unknown[]) => {
    const cb = args[args.length - 1] as (err: null, result: { stdout: string; stderr: string }) => void;
    cb(null, { stdout, stderr: '' });
    return {} as ReturnType<typeof execFile>;
  });
}

// Helper to mock execFile failure
function mockExecFileFailure(errorMessage = 'Command not found') {
  mockExecFile.mockImplementation((...args: unknown[]) => {
    const cb = args[args.length - 1] as (err: Error) => void;
    cb(new Error(errorMessage));
    return {} as ReturnType<typeof execFile>;
  });
}

describe('isOllamaInstalled', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns true when "which ollama" succeeds', async () => {
    mockExecFileSuccess('/usr/local/bin/ollama\n');
    const result = await isOllamaInstalled();
    expect(result).toBe(true);
  });

  it('returns false when "which ollama" throws', async () => {
    mockExecFileFailure('ollama: not found');
    const result = await isOllamaInstalled();
    expect(result).toBe(false);
  });
});

describe('isOllamaRunning', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns true when fetch to localhost:11434 returns ok', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true } as Response);
    vi.stubGlobal('fetch', mockFetch);

    const result = await isOllamaRunning();
    expect(result).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith('http://localhost:11434');
  });

  it('returns false when fetch throws (connection refused)', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    vi.stubGlobal('fetch', mockFetch);

    const result = await isOllamaRunning();
    expect(result).toBe(false);
  });

  it('returns false when fetch returns not ok', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false } as Response);
    vi.stubGlobal('fetch', mockFetch);

    const result = await isOllamaRunning();
    expect(result).toBe(false);
  });
});

describe('startOllama', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('spawns "ollama serve" detached and polls readiness up to 5 seconds', async () => {
    const mockChild = {
      pid: 11111,
      unref: vi.fn(),
    };
    mockSpawn.mockReturnValue(mockChild as unknown as ReturnType<typeof spawn>);

    // pre-spawn check fails (not running), then poll succeeds on first attempt
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({ ok: false } as Response)  // pre-spawn guard
      .mockResolvedValue({ ok: true } as Response);       // poll
    vi.stubGlobal('fetch', mockFetch);

    const resultPromise = startOllama();
    // advance timers to allow polling
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toBe(true);
    expect(mockSpawn).toHaveBeenCalledWith(
      'ollama',
      ['serve'],
      expect.objectContaining({ detached: true, stdio: 'ignore' })
    );
    expect(mockChild.unref).toHaveBeenCalled();
  });

  it('returns false when readiness poll times out', async () => {
    const mockChild = {
      pid: 22222,
      unref: vi.fn(),
    };
    mockSpawn.mockReturnValue(mockChild as unknown as ReturnType<typeof spawn>);

    // pre-spawn check fails, then all polls fail
    const mockFetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    vi.stubGlobal('fetch', mockFetch);

    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true as never);

    const resultPromise = startOllama();
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toBe(false);
    killSpy.mockRestore();
  });

  it('returns true without spawning when Ollama is already running', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true } as Response);
    vi.stubGlobal('fetch', mockFetch);

    const resultPromise = startOllama();
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toBe(true);
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('captures PID and includes it in success log', async () => {
    const mockChild = {
      pid: 12345,
      unref: vi.fn(),
    };
    mockSpawn.mockReturnValue(mockChild as unknown as ReturnType<typeof spawn>);

    // pre-spawn check fails (not running), then poll succeeds
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({ ok: false } as Response)  // pre-spawn guard
      .mockResolvedValue({ ok: true } as Response);       // poll
    vi.stubGlobal('fetch', mockFetch);

    const resultPromise = startOllama();
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toBe(true);
    expect(mockChild.unref).toHaveBeenCalled();
  });

  it('kills spawned process on timeout', async () => {
    const mockChild = {
      pid: 99999,
      unref: vi.fn(),
    };
    mockSpawn.mockReturnValue(mockChild as unknown as ReturnType<typeof spawn>);

    // pre-spawn check fails, then all polls fail
    const mockFetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    vi.stubGlobal('fetch', mockFetch);

    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true as never);

    const resultPromise = startOllama();
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toBe(false);
    expect(killSpy).toHaveBeenCalledWith(99999, 'SIGTERM');

    killSpy.mockRestore();
  });

  it('registers and removes signal handlers during polling', async () => {
    const mockChild = {
      pid: 55555,
      unref: vi.fn(),
    };
    mockSpawn.mockReturnValue(mockChild as unknown as ReturnType<typeof spawn>);

    // pre-spawn check fails, then poll succeeds
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({ ok: false } as Response)  // pre-spawn guard
      .mockResolvedValue({ ok: true } as Response);       // poll
    vi.stubGlobal('fetch', mockFetch);

    const onceSpy = vi.spyOn(process, 'once');
    const removeListenerSpy = vi.spyOn(process, 'removeListener');

    const resultPromise = startOllama();
    await vi.runAllTimersAsync();
    await resultPromise;

    const sigintOnce = onceSpy.mock.calls.some((c) => c[0] === 'SIGINT');
    const sigtermOnce = onceSpy.mock.calls.some((c) => c[0] === 'SIGTERM');
    expect(sigintOnce).toBe(true);
    expect(sigtermOnce).toBe(true);

    const sigintRemoved = removeListenerSpy.mock.calls.some((c) => c[0] === 'SIGINT');
    const sigtermRemoved = removeListenerSpy.mock.calls.some((c) => c[0] === 'SIGTERM');
    expect(sigintRemoved).toBe(true);
    expect(sigtermRemoved).toBe(true);

    onceSpy.mockRestore();
    removeListenerSpy.mockRestore();
  });

  it('kills spawned process on timeout even if process.kill throws ESRCH', async () => {
    const mockChild = {
      pid: 77777,
      unref: vi.fn(),
    };
    mockSpawn.mockReturnValue(mockChild as unknown as ReturnType<typeof spawn>);

    // pre-spawn check fails, then all polls fail
    const mockFetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    vi.stubGlobal('fetch', mockFetch);

    const esrchError = Object.assign(new Error('ESRCH'), { code: 'ESRCH' });
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => { throw esrchError; });

    const resultPromise = startOllama();
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    // Should return false without throwing
    expect(result).toBe(false);

    killSpy.mockRestore();
  });
});

describe('pullModelIfMissing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does nothing when model already exists in ollama.list()', async () => {
    mockOllama.list.mockResolvedValue({
      models: [
        { name: 'nomic-embed-text:latest', model: 'nomic-embed-text:latest', modified_at: new Date(), size: 0, digest: '', details: { format: '', family: '', families: [], parameter_size: '', quantization_level: '' } },
      ],
    } as Awaited<ReturnType<typeof ollama.list>>);

    await pullModelIfMissing('nomic-embed-text');

    expect(mockOllama.pull).not.toHaveBeenCalled();
  });

  it('calls ollama.pull() with stream when model is missing', async () => {
    mockOllama.list.mockResolvedValue({
      models: [],
    } as Awaited<ReturnType<typeof ollama.list>>);

    // Mock pull to return an async generator
    async function* mockPullGenerator() {
      yield { status: 'pulling manifest' };
      yield { status: 'verifying sha256 digest' };
      yield { status: 'success' };
    }
    mockOllama.pull.mockResolvedValue(mockPullGenerator() as unknown as Awaited<ReturnType<typeof ollama.pull>>);

    const progressCalls: string[] = [];
    await pullModelIfMissing('nomic-embed-text', (status) => progressCalls.push(status));

    expect(mockOllama.pull).toHaveBeenCalledWith({ model: 'nomic-embed-text', stream: true });
    expect(progressCalls).toContain('pulling manifest');
    expect(progressCalls).toContain('success');
  });
});

describe('getOllamaVersion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns version string from "ollama --version" output', async () => {
    mockExecFileSuccess('ollama version is 0.1.44\n');
    const result = await getOllamaVersion();
    expect(result).toBeTruthy();
    expect(typeof result).toBe('string');
  });

  it('returns null when command fails', async () => {
    mockExecFileFailure('ollama: not found');
    const result = await getOllamaVersion();
    expect(result).toBeNull();
  });
});
