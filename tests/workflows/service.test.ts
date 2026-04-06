import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn(),
  readdir: vi.fn(),
  unlink: vi.fn(),
  writeFile: vi.fn(),
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
}));

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os');
  return {
    ...actual,
    homedir: vi.fn(() => '/home/tester'),
  };
});

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir, unlink, writeFile } from 'node:fs/promises';

const mockExecSync = vi.mocked(execSync);
const mockExistsSync = vi.mocked(existsSync);
const mockWriteFile = vi.mocked(writeFile);
const mockUnlink = vi.mocked(unlink);
const mockMkdir = vi.mocked(mkdir);
const mockReaddir = vi.mocked(readdir);

let runServiceInstall: () => Promise<void>;
let runServiceUninstall: () => Promise<void>;
let runServiceStatus: () => Promise<void>;

function setPlatform(value: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value, configurable: true });
}

describe('service workflow', () => {
  const originalGetuid = process.getuid;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.clearAllMocks();

    mockExecSync.mockReturnValue(Buffer.from('ok'));
    mockExistsSync.mockReturnValue(false);
    mockWriteFile.mockResolvedValue(undefined);
    mockUnlink.mockResolvedValue(undefined);
    mockMkdir.mockResolvedValue(undefined);
    mockReaddir.mockResolvedValue([]);

    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    vi.spyOn(process, 'cwd').mockReturnValue('/repo/project');
    Object.defineProperty(process, 'execPath', { value: '/usr/local/bin/node', configurable: true });
    process.getuid = vi.fn(() => 501);

    const mod = await import('../../src/workflows/service.js');
    runServiceInstall = mod.runServiceInstall;
    runServiceUninstall = mod.runServiceUninstall;
    runServiceStatus = mod.runServiceStatus;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.getuid = originalGetuid;
  });

  it('installs LaunchAgent on macOS', async () => {
    setPlatform('darwin');

    await runServiceInstall();

    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining('Library/LaunchAgents/com.brain-cache.watcher.'),
      expect.stringContaining('<plist'),
      'utf8',
    );
    expect(mockMkdir).toHaveBeenCalledWith('/repo/project/.brain-cache', { recursive: true });
    expect(mockExecSync).toHaveBeenCalledWith(
      expect.stringContaining('launchctl bootstrap gui/501'),
      { stdio: 'inherit' },
    );
  });

  it('installs systemd unit on Linux and enables linger', async () => {
    setPlatform('linux');
    mockExecSync.mockImplementation((command: string) => {
      if (command === 'whoami') {
        return 'tester\n' as never;
      }
      return Buffer.from('ok') as never;
    });

    await runServiceInstall();

    expect(mockMkdir).toHaveBeenCalledWith('/home/tester/.config/systemd/user', { recursive: true });
    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining('brain-cache-watcher-'),
      expect.stringContaining('[Service]'),
      'utf8',
    );
    expect(mockExecSync).toHaveBeenCalledWith('systemctl --user daemon-reload', { stdio: 'inherit' });
    expect(mockExecSync).toHaveBeenCalledWith(expect.stringContaining('systemctl --user enable --now'), { stdio: 'inherit' });
    expect(mockExecSync).toHaveBeenCalledWith('loginctl enable-linger tester', { stdio: 'inherit' });
  });

  it('prints Windows manual instructions without throwing', async () => {
    setPlatform('win32');
    await expect(runServiceInstall()).resolves.toBeUndefined();

    const output = stderrSpy.mock.calls.map(c => String(c[0])).join('');
    expect(output).toMatch(/Windows|NSSM|Task Scheduler/i);
  });

  it('throws install error when already installed', async () => {
    setPlatform('darwin');
    mockExistsSync.mockReturnValue(true);

    await expect(runServiceInstall()).rejects.toThrow(/already installed/i);
  });

  it('uninstalls LaunchAgent on macOS', async () => {
    setPlatform('darwin');
    mockExistsSync.mockReturnValue(true);

    await runServiceUninstall();

    expect(mockExecSync).toHaveBeenCalledWith(expect.stringContaining('launchctl bootout gui/501'), { stdio: 'inherit' });
    expect(mockUnlink).toHaveBeenCalledWith(expect.stringContaining('.plist'));
  });

  it('throws uninstall error when not installed', async () => {
    setPlatform('linux');
    mockExistsSync.mockReturnValue(false);

    await expect(runServiceUninstall()).rejects.toThrow(/not installed/i);
  });

  it('reports status for macOS current and other services', async () => {
    setPlatform('darwin');
    mockExistsSync.mockReturnValue(true);
    mockExecSync.mockReturnValue('loaded\n' as never);
    mockReaddir.mockResolvedValue([
      'com.brain-cache.watcher.aaaa1111.plist',
      'com.brain-cache.watcher.bbbb2222.plist',
    ] as never);

    await runServiceStatus();

    expect(mockExecSync).toHaveBeenCalledWith(expect.stringContaining('launchctl print gui/501/com.brain-cache.watcher.'), {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const output = stderrSpy.mock.calls.map(c => String(c[0])).join('');
    expect(output).toContain('aaaa1111');
    expect(output).toContain('bbbb2222');
  });
});
