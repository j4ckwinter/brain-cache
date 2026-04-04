import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { homedir } from 'node:os';

// Mock node:fs so init.ts file operations don't touch disk
vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  appendFileSync: vi.fn(),
  chmodSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

// Mock statusline-script module
vi.mock('../../src/lib/statusline-script.js', () => ({
  STATUSLINE_SCRIPT_CONTENT: '#!/usr/bin/env node\n// mock statusline content\n',
}));

import * as nodeFsMock from 'node:fs';

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

const mockExistsSync = vi.mocked(nodeFsMock.existsSync);
const mockReadFileSync = vi.mocked(nodeFsMock.readFileSync);
const mockWriteFileSync = vi.mocked(nodeFsMock.writeFileSync);
const mockAppendFileSync = vi.mocked(nodeFsMock.appendFileSync);
const mockChmodSync = vi.mocked(nodeFsMock.chmodSync);
const mockMkdirSync = vi.mocked(nodeFsMock.mkdirSync);

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

    // Default fs mocks: CLAUDE.md already contains section (idempotent), no .mcp.json
    // statusline.mjs already installed (idempotent), settings.json already has statusLine
    mockExistsSync.mockImplementation((p: unknown) => {
      const ps = String(p);
      if (ps === 'CLAUDE.md') return true;
      if (ps === '.mcp.json') return false;
      if (ps.endsWith('statusline.mjs')) return true;
      if (ps.endsWith('settings.json')) return true;
      return false;
    });
    mockReadFileSync.mockImplementation((p: unknown) => {
      const ps = String(p);
      if (ps === 'CLAUDE.md') return '## Brain-Cache MCP Tools\n';
      if (ps.endsWith('statusline.mjs')) return '#!/usr/bin/env node\n// mock statusline content\n';
      if (ps.endsWith('settings.json')) return JSON.stringify({ statusLine: { type: 'command', command: 'node "~/.brain-cache/statusline.mjs"' } });
      return '';
    });
    mockWriteFileSync.mockImplementation(() => undefined);
    mockAppendFileSync.mockImplementation(() => undefined);

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

  it('throws an error when Ollama is not installed', async () => {
    mockIsOllamaInstalled.mockResolvedValue(false);
    await expect(runInit()).rejects.toThrow('Ollama is not installed');
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

  it('throws an error when Ollama auto-start fails', async () => {
    mockIsOllamaRunning.mockResolvedValue(false);
    mockStartOllama.mockResolvedValue(false);
    await expect(runInit()).rejects.toThrow("Could not start Ollama");
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

describe('.mcp.json management', () => {
  let stderrOutput: string[];
  let stderrWriteSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    stderrOutput = [];

    stderrWriteSpy = vi.spyOn(process.stderr, 'write').mockImplementation((data: unknown) => {
      stderrOutput.push(String(data));
      return true;
    });
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process, 'exit').mockImplementation((_code?: unknown) => {
      throw new Error(`process.exit(${_code})`);
    });

    // Service mocks
    mockDetectCapabilities.mockResolvedValue({ ...mockProfile });
    mockIsOllamaInstalled.mockResolvedValue(true);
    mockIsOllamaRunning.mockResolvedValue(true);
    mockStartOllama.mockResolvedValue(true);
    mockPullModelIfMissing.mockResolvedValue(undefined);
    mockGetOllamaVersion.mockResolvedValue('ollama version 0.6.3');
    mockWriteProfile.mockResolvedValue(undefined);
    mockEmbedBatchWithRetry.mockResolvedValue([[0.1, 0.2]]);

    // CLAUDE.md: already has section (idempotent)
    // statusline.mjs already installed (idempotent), settings.json already has statusLine
    mockExistsSync.mockImplementation((p: unknown) => {
      const ps = String(p);
      if (ps === 'CLAUDE.md') return true;
      if (ps === '.mcp.json') return false;
      if (ps.endsWith('statusline.mjs')) return true;
      if (ps.endsWith('settings.json')) return true;
      return false;
    });
    mockReadFileSync.mockImplementation((p: unknown) => {
      const ps = String(p);
      if (ps === 'CLAUDE.md') return '## Brain-Cache MCP Tools\n';
      if (ps.endsWith('statusline.mjs')) return '#!/usr/bin/env node\n// mock statusline content\n';
      if (ps.endsWith('settings.json')) return JSON.stringify({ statusLine: { type: 'command', command: 'node "~/.brain-cache/statusline.mjs"' } });
      return '';
    });
    mockWriteFileSync.mockImplementation(() => undefined);
    mockAppendFileSync.mockImplementation(() => undefined);

    const mod = await import('../../src/workflows/init.js');
    runInit = mod.runInit;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('creates .mcp.json with brain-cache entry when file does not exist', async () => {
    mockExistsSync.mockImplementation((p: unknown) => {
      const ps = String(p);
      if (ps === 'CLAUDE.md') return true;
      if (ps === '.mcp.json') return false;
      if (ps.endsWith('statusline.mjs')) return true;
      if (ps.endsWith('settings.json')) return true;
      return false;
    });
    mockReadFileSync.mockImplementation((p: unknown) => {
      const ps = String(p);
      if (ps === 'CLAUDE.md') return '## Brain-Cache MCP Tools\n';
      if (ps.endsWith('statusline.mjs')) return '#!/usr/bin/env node\n// mock statusline content\n';
      if (ps.endsWith('settings.json')) return JSON.stringify({ statusLine: { type: 'command', command: 'node "~/.brain-cache/statusline.mjs"' } });
      return '';
    });

    await runInit();

    const writeCall = mockWriteFileSync.mock.calls.find(
      (c) => c[0] === '.mcp.json'
    );
    expect(writeCall).toBeDefined();
    const written = JSON.parse(writeCall![1] as string);
    expect(written).toEqual({
      mcpServers: {
        'brain-cache': {
          command: 'node',
          args: ['node_modules/brain-cache/dist/mcp.js'],
        },
      },
    });
  });

  it('merges brain-cache entry into existing .mcp.json preserving other servers', async () => {
    const existing = {
      mcpServers: {
        'other-mcp': { command: 'other', args: [] },
      },
    };
    mockExistsSync.mockImplementation((p: unknown) => {
      const ps = String(p);
      if (ps === 'CLAUDE.md') return true;
      if (ps === '.mcp.json') return true;
      if (ps.endsWith('statusline.mjs')) return true;
      if (ps.endsWith('settings.json')) return true;
      return false;
    });
    mockReadFileSync.mockImplementation((p: unknown) => {
      const ps = String(p);
      if (ps === 'CLAUDE.md') return '## Brain-Cache MCP Tools\n';
      if (ps === '.mcp.json') return JSON.stringify(existing);
      if (ps.endsWith('statusline.mjs')) return '#!/usr/bin/env node\n// mock statusline content\n';
      if (ps.endsWith('settings.json')) return JSON.stringify({ statusLine: { type: 'command', command: 'node "~/.brain-cache/statusline.mjs"' } });
      return '';
    });

    await runInit();

    const writeCall = mockWriteFileSync.mock.calls.find(
      (c) => c[0] === '.mcp.json'
    );
    expect(writeCall).toBeDefined();
    const written = JSON.parse(writeCall![1] as string);
    expect(written.mcpServers['other-mcp']).toEqual({ command: 'other', args: [] });
    expect(written.mcpServers['brain-cache']).toEqual({
      command: 'node',
      args: ['node_modules/brain-cache/dist/mcp.js'],
    });
  });

  it('does not rewrite .mcp.json when brain-cache entry already exists (idempotent)', async () => {
    const existing = {
      mcpServers: {
        'brain-cache': {
          command: 'node',
          args: ['node_modules/brain-cache/dist/mcp.js'],
        },
      },
    };
    mockExistsSync.mockImplementation((p: unknown) => {
      const ps = String(p);
      if (ps === 'CLAUDE.md') return true;
      if (ps === '.mcp.json') return true;
      if (ps.endsWith('statusline.mjs')) return true;
      if (ps.endsWith('settings.json')) return true;
      return false;
    });
    mockReadFileSync.mockImplementation((p: unknown) => {
      const ps = String(p);
      if (ps === 'CLAUDE.md') return '## Brain-Cache MCP Tools\n';
      if (ps === '.mcp.json') return JSON.stringify(existing);
      if (ps.endsWith('statusline.mjs')) return '#!/usr/bin/env node\n// mock statusline content\n';
      if (ps.endsWith('settings.json')) return JSON.stringify({ statusLine: { type: 'command', command: 'node "~/.brain-cache/statusline.mjs"' } });
      return '';
    });

    await runInit();

    const writeCall = mockWriteFileSync.mock.calls.find(
      (c) => c[0] === '.mcp.json'
    );
    expect(writeCall).toBeUndefined();
  });

  it('prints stderr message indicating .mcp.json was created', async () => {
    mockExistsSync.mockImplementation((p: unknown) => {
      const ps = String(p);
      if (ps === 'CLAUDE.md') return true;
      if (ps === '.mcp.json') return false;
      if (ps.endsWith('statusline.mjs')) return true;
      if (ps.endsWith('settings.json')) return true;
      return false;
    });
    mockReadFileSync.mockImplementation((p: unknown) => {
      const ps = String(p);
      if (ps === 'CLAUDE.md') return '## Brain-Cache MCP Tools\n';
      if (ps.endsWith('statusline.mjs')) return '#!/usr/bin/env node\n// mock statusline content\n';
      if (ps.endsWith('settings.json')) return JSON.stringify({ statusLine: { type: 'command', command: 'node "~/.brain-cache/statusline.mjs"' } });
      return '';
    });

    await runInit();

    const combined = stderrOutput.join('');
    expect(combined).toContain('.mcp.json');
    expect(combined).toContain('brain-cache');
  });

  it('prints stderr message when brain-cache entry added to existing .mcp.json', async () => {
    const existing = {
      mcpServers: {
        'other-mcp': { command: 'other', args: [] },
      },
    };
    mockExistsSync.mockImplementation((p: unknown) => {
      const ps = String(p);
      if (ps === 'CLAUDE.md') return true;
      if (ps === '.mcp.json') return true;
      if (ps.endsWith('statusline.mjs')) return true;
      if (ps.endsWith('settings.json')) return true;
      return false;
    });
    mockReadFileSync.mockImplementation((p: unknown) => {
      const ps = String(p);
      if (ps === 'CLAUDE.md') return '## Brain-Cache MCP Tools\n';
      if (ps === '.mcp.json') return JSON.stringify(existing);
      if (ps.endsWith('statusline.mjs')) return '#!/usr/bin/env node\n// mock statusline content\n';
      if (ps.endsWith('settings.json')) return JSON.stringify({ statusLine: { type: 'command', command: 'node "~/.brain-cache/statusline.mjs"' } });
      return '';
    });

    await runInit();

    const combined = stderrOutput.join('');
    expect(combined).toContain('.mcp.json');
  });

  it('prints stderr message when brain-cache entry already exists in .mcp.json', async () => {
    const existing = {
      mcpServers: {
        'brain-cache': {
          command: 'node',
          args: ['node_modules/brain-cache/dist/mcp.js'],
        },
      },
    };
    mockExistsSync.mockImplementation((p: unknown) => {
      const ps = String(p);
      if (ps === 'CLAUDE.md') return true;
      if (ps === '.mcp.json') return true;
      if (ps.endsWith('statusline.mjs')) return true;
      if (ps.endsWith('settings.json')) return true;
      return false;
    });
    mockReadFileSync.mockImplementation((p: unknown) => {
      const ps = String(p);
      if (ps === 'CLAUDE.md') return '## Brain-Cache MCP Tools\n';
      if (ps === '.mcp.json') return JSON.stringify(existing);
      if (ps.endsWith('statusline.mjs')) return '#!/usr/bin/env node\n// mock statusline content\n';
      if (ps.endsWith('settings.json')) return JSON.stringify({ statusLine: { type: 'command', command: 'node "~/.brain-cache/statusline.mjs"' } });
      return '';
    });

    await runInit();

    const combined = stderrOutput.join('');
    expect(combined).toContain('already');
    expect(combined).toContain('.mcp.json');
  });
});

describe('statusline installation', () => {
  let stderrOutput: string[];
  let stderrWriteSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    stderrOutput = [];

    stderrWriteSpy = vi.spyOn(process.stderr, 'write').mockImplementation((data: unknown) => {
      stderrOutput.push(String(data));
      return true;
    });
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process, 'exit').mockImplementation((_code?: unknown) => {
      throw new Error(`process.exit(${_code})`);
    });

    // Service mocks
    mockDetectCapabilities.mockResolvedValue({ ...mockProfile });
    mockIsOllamaInstalled.mockResolvedValue(true);
    mockIsOllamaRunning.mockResolvedValue(true);
    mockStartOllama.mockResolvedValue(true);
    mockPullModelIfMissing.mockResolvedValue(undefined);
    mockGetOllamaVersion.mockResolvedValue('ollama version 0.6.3');
    mockWriteProfile.mockResolvedValue(undefined);
    mockEmbedBatchWithRetry.mockResolvedValue([[0.1, 0.2]]);

    mockWriteFileSync.mockImplementation(() => undefined);
    mockAppendFileSync.mockImplementation(() => undefined);

    const mod = await import('../../src/workflows/init.js');
    runInit = mod.runInit;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('installs statusline.mjs when it does not exist', async () => {
    mockExistsSync.mockImplementation((p: unknown) => {
      const ps = String(p);
      if (ps === 'CLAUDE.md') return true;
      if (ps === '.mcp.json') return false;
      if (ps.endsWith('statusline.mjs')) return false;
      if (ps.endsWith('settings.json')) return true;
      return false;
    });
    mockReadFileSync.mockImplementation((p: unknown) => {
      const ps = String(p);
      if (ps === 'CLAUDE.md') return '## Brain-Cache MCP Tools\n';
      if (ps.endsWith('settings.json')) return JSON.stringify({ statusLine: { type: 'command', command: 'node "~/.brain-cache/statusline.mjs"' } });
      return '';
    });

    await runInit();

    const writeCall = mockWriteFileSync.mock.calls.find(
      (c) => String(c[0]).endsWith('statusline.mjs')
    );
    expect(writeCall).toBeDefined();
    expect(writeCall![1]).toBe('#!/usr/bin/env node\n// mock statusline content\n');
    expect(mockChmodSync).toHaveBeenCalledWith(
      expect.stringContaining('statusline.mjs'),
      0o755
    );
  });

  it('skips statusline.mjs when already installed with identical content', async () => {
    mockExistsSync.mockImplementation((p: unknown) => {
      const ps = String(p);
      if (ps === 'CLAUDE.md') return true;
      if (ps === '.mcp.json') return false;
      if (ps.endsWith('statusline.mjs')) return true;
      if (ps.endsWith('settings.json')) return true;
      return false;
    });
    mockReadFileSync.mockImplementation((p: unknown) => {
      const ps = String(p);
      if (ps === 'CLAUDE.md') return '## Brain-Cache MCP Tools\n';
      if (ps.endsWith('statusline.mjs')) return '#!/usr/bin/env node\n// mock statusline content\n';
      if (ps.endsWith('settings.json')) return JSON.stringify({ statusLine: { type: 'command', command: 'node "~/.brain-cache/statusline.mjs"' } });
      return '';
    });

    await runInit();

    const writeCall = mockWriteFileSync.mock.calls.find(
      (c) => String(c[0]).endsWith('statusline.mjs')
    );
    expect(writeCall).toBeUndefined();
    const combined = stderrOutput.join('');
    expect(combined).toContain('already installed');
  });

  it('warns and skips when statusline.mjs has custom content', async () => {
    mockExistsSync.mockImplementation((p: unknown) => {
      const ps = String(p);
      if (ps === 'CLAUDE.md') return true;
      if (ps === '.mcp.json') return false;
      if (ps.endsWith('statusline.mjs')) return true;
      if (ps.endsWith('settings.json')) return true;
      return false;
    });
    mockReadFileSync.mockImplementation((p: unknown) => {
      const ps = String(p);
      if (ps === 'CLAUDE.md') return '## Brain-Cache MCP Tools\n';
      if (ps.endsWith('statusline.mjs')) return '#!/usr/bin/env node\n// custom user content\n';
      if (ps.endsWith('settings.json')) return JSON.stringify({ statusLine: { type: 'command', command: 'node "~/.brain-cache/statusline.mjs"' } });
      return '';
    });

    await runInit();

    const writeCall = mockWriteFileSync.mock.calls.find(
      (c) => String(c[0]).endsWith('statusline.mjs')
    );
    expect(writeCall).toBeUndefined();
    const combined = stderrOutput.join('');
    expect(combined).toContain('custom content');
  });
});

describe('settings.json management', () => {
  let stderrOutput: string[];
  let stderrWriteSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    stderrOutput = [];

    stderrWriteSpy = vi.spyOn(process.stderr, 'write').mockImplementation((data: unknown) => {
      stderrOutput.push(String(data));
      return true;
    });
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process, 'exit').mockImplementation((_code?: unknown) => {
      throw new Error(`process.exit(${_code})`);
    });

    // Service mocks
    mockDetectCapabilities.mockResolvedValue({ ...mockProfile });
    mockIsOllamaInstalled.mockResolvedValue(true);
    mockIsOllamaRunning.mockResolvedValue(true);
    mockStartOllama.mockResolvedValue(true);
    mockPullModelIfMissing.mockResolvedValue(undefined);
    mockGetOllamaVersion.mockResolvedValue('ollama version 0.6.3');
    mockWriteProfile.mockResolvedValue(undefined);
    mockEmbedBatchWithRetry.mockResolvedValue([[0.1, 0.2]]);

    mockWriteFileSync.mockImplementation(() => undefined);
    mockAppendFileSync.mockImplementation(() => undefined);

    const mod = await import('../../src/workflows/init.js');
    runInit = mod.runInit;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('creates settings.json with statusLine entry when file does not exist', async () => {
    mockExistsSync.mockImplementation((p: unknown) => {
      const ps = String(p);
      if (ps === 'CLAUDE.md') return true;
      if (ps === '.mcp.json') return false;
      if (ps.endsWith('statusline.mjs')) return true;
      if (ps.endsWith('settings.json')) return false;
      return false;
    });
    mockReadFileSync.mockImplementation((p: unknown) => {
      const ps = String(p);
      if (ps === 'CLAUDE.md') return '## Brain-Cache MCP Tools\n';
      if (ps.endsWith('statusline.mjs')) return '#!/usr/bin/env node\n// mock statusline content\n';
      return '';
    });

    await runInit();

    const writeCall = mockWriteFileSync.mock.calls.find(
      (c) => String(c[0]).endsWith('settings.json')
    );
    expect(writeCall).toBeDefined();
    expect(mockMkdirSync).toHaveBeenCalledWith(
      expect.stringContaining('.claude'),
      { recursive: true }
    );
    const written = JSON.parse(writeCall![1] as string);
    expect(written.statusLine).toBeDefined();
    expect(written.statusLine.type).toBe('command');
    expect(written.statusLine.command).toBe(`node "${join(homedir(), '.brain-cache', 'statusline.mjs')}"`);

  });

  it('merges statusLine into existing settings.json preserving other keys', async () => {
    const existingSettings = { hooks: { 'pre-tool-use': [] }, skipDangerousModePermissionPrompt: true };
    mockExistsSync.mockImplementation((p: unknown) => {
      const ps = String(p);
      if (ps === 'CLAUDE.md') return true;
      if (ps === '.mcp.json') return false;
      if (ps.endsWith('statusline.mjs')) return true;
      if (ps.endsWith('settings.json')) return true;
      return false;
    });
    mockReadFileSync.mockImplementation((p: unknown) => {
      const ps = String(p);
      if (ps === 'CLAUDE.md') return '## Brain-Cache MCP Tools\n';
      if (ps.endsWith('statusline.mjs')) return '#!/usr/bin/env node\n// mock statusline content\n';
      if (ps.endsWith('settings.json')) return JSON.stringify(existingSettings);
      return '';
    });

    await runInit();

    const writeCall = mockWriteFileSync.mock.calls.find(
      (c) => String(c[0]).endsWith('settings.json')
    );
    expect(writeCall).toBeDefined();
    const written = JSON.parse(writeCall![1] as string);
    expect(written.hooks).toEqual({ 'pre-tool-use': [] });
    expect(written.skipDangerousModePermissionPrompt).toBe(true);
    expect(written.statusLine).toBeDefined();
    expect(written.statusLine.type).toBe('command');
    const combined = stderrOutput.join('');
    expect(combined).toContain('added statusLine');
  });

  it('warns and skips when settings.json already has statusLine entry', async () => {
    mockExistsSync.mockImplementation((p: unknown) => {
      const ps = String(p);
      if (ps === 'CLAUDE.md') return true;
      if (ps === '.mcp.json') return false;
      if (ps.endsWith('statusline.mjs')) return true;
      if (ps.endsWith('settings.json')) return true;
      return false;
    });
    mockReadFileSync.mockImplementation((p: unknown) => {
      const ps = String(p);
      if (ps === 'CLAUDE.md') return '## Brain-Cache MCP Tools\n';
      if (ps.endsWith('statusline.mjs')) return '#!/usr/bin/env node\n// mock statusline content\n';
      if (ps.endsWith('settings.json')) return JSON.stringify({ statusLine: { type: 'command', command: 'other' } });
      return '';
    });

    await runInit();

    const writeCall = mockWriteFileSync.mock.calls.find(
      (c) => String(c[0]).endsWith('settings.json')
    );
    expect(writeCall).toBeUndefined();
    const combined = stderrOutput.join('');
    expect(combined).toContain('already has a statusLine');
  });

  it('handles invalid JSON in settings.json gracefully', async () => {
    mockExistsSync.mockImplementation((p: unknown) => {
      const ps = String(p);
      if (ps === 'CLAUDE.md') return true;
      if (ps === '.mcp.json') return false;
      if (ps.endsWith('statusline.mjs')) return true;
      if (ps.endsWith('settings.json')) return true;
      return false;
    });
    mockReadFileSync.mockImplementation((p: unknown) => {
      const ps = String(p);
      if (ps === 'CLAUDE.md') return '## Brain-Cache MCP Tools\n';
      if (ps.endsWith('statusline.mjs')) return '#!/usr/bin/env node\n// mock statusline content\n';
      if (ps.endsWith('settings.json')) return '{invalid json';
      return '';
    });

    await expect(runInit()).resolves.toBeUndefined();
    const combined = stderrOutput.join('');
    expect(combined).toContain('Could not configure');
  });

  it('uses absolute homedir in command path for reliable resolution', async () => {
    mockExistsSync.mockImplementation((p: unknown) => {
      const ps = String(p);
      if (ps === 'CLAUDE.md') return true;
      if (ps === '.mcp.json') return false;
      if (ps.endsWith('statusline.mjs')) return true;
      if (ps.endsWith('settings.json')) return false;
      return false;
    });
    mockReadFileSync.mockImplementation((p: unknown) => {
      const ps = String(p);
      if (ps === 'CLAUDE.md') return '## Brain-Cache MCP Tools\n';
      if (ps.endsWith('statusline.mjs')) return '#!/usr/bin/env node\n// mock statusline content\n';
      return '';
    });

    await runInit();

    const writeCall = mockWriteFileSync.mock.calls.find(
      (c) => String(c[0]).endsWith('settings.json')
    );
    expect(writeCall).toBeDefined();
    const written = JSON.parse(writeCall![1] as string);
    const expected = join(homedir(), '.brain-cache', 'statusline.mjs');
    expect(written.statusLine.command).toContain(expected);
    expect(written.statusLine.command).not.toContain('~');
  });

  it('is idempotent: second run produces no additional writes for statusline or settings', async () => {
    // Simulate first run: statusline already identical, settings already has statusLine
    mockExistsSync.mockImplementation((p: unknown) => {
      const ps = String(p);
      if (ps === 'CLAUDE.md') return true;
      if (ps === '.mcp.json') return false;
      if (ps.endsWith('statusline.mjs')) return true;
      if (ps.endsWith('settings.json')) return true;
      return false;
    });
    mockReadFileSync.mockImplementation((p: unknown) => {
      const ps = String(p);
      if (ps === 'CLAUDE.md') return '## Brain-Cache MCP Tools\n';
      if (ps.endsWith('statusline.mjs')) return '#!/usr/bin/env node\n// mock statusline content\n';
      if (ps.endsWith('settings.json')) return JSON.stringify({ statusLine: { type: 'command', command: 'node "~/.brain-cache/statusline.mjs"' } });
      return '';
    });

    await runInit();

    const statuslineWrite = mockWriteFileSync.mock.calls.find(
      (c) => String(c[0]).endsWith('statusline.mjs')
    );
    const settingsWrite = mockWriteFileSync.mock.calls.find(
      (c) => String(c[0]).endsWith('settings.json')
    );
    expect(statuslineWrite).toBeUndefined();
    expect(settingsWrite).toBeUndefined();
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

  it('throws with message when no profile found', async () => {
    mockReadProfile.mockResolvedValue(null);
    await expect(runDoctor()).rejects.toThrow("No profile found. Run 'brain-cache init' first.");
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
