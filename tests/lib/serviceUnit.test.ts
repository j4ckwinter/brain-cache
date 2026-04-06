import { describe, expect, it } from 'vitest';
import {
  generatePlist,
  generateSystemdUnit,
  getCliEntryPath,
  getLinuxUnitName,
  getMacOSLabel,
  getPlistPath,
  getUserSystemdDir,
  hashProjectPath,
} from '../../src/lib/serviceUnit.js';

describe('hashProjectPath', () => {
  it('returns an 8-character hex string', () => {
    const hash = hashProjectPath('/Users/dev/my-project');
    expect(hash).toMatch(/^[0-9a-f]{8}$/);
  });

  it('is deterministic for the same path', () => {
    const first = hashProjectPath('/Users/dev/my-project');
    const second = hashProjectPath('/Users/dev/my-project');
    expect(first).toBe(second);
  });

  it('returns different hash for different path', () => {
    const first = hashProjectPath('/Users/dev/my-project');
    const second = hashProjectPath('/Users/dev/other-project');
    expect(first).not.toBe(second);
  });
});

describe('service naming and paths', () => {
  it('builds macOS label from hash', () => {
    expect(getMacOSLabel('a1b2c3d4')).toBe('com.brain-cache.watcher.a1b2c3d4');
  });

  it('builds Linux unit name from hash', () => {
    expect(getLinuxUnitName('a1b2c3d4')).toBe('brain-cache-watcher-a1b2c3d4.service');
  });

  it('builds plist path in LaunchAgents directory', () => {
    const plistPath = getPlistPath('com.brain-cache.watcher.a1b2c3d4');
    expect(plistPath).toContain('Library/LaunchAgents');
    expect(plistPath).toContain('com.brain-cache.watcher.a1b2c3d4.plist');
  });

  it('builds systemd user unit directory', () => {
    expect(getUserSystemdDir()).toContain('.config/systemd/user');
  });
});

describe('generatePlist', () => {
  it('generates expected launchd XML content', () => {
    const plist = generatePlist({
      label: 'com.brain-cache.watcher.abcd1234',
      nodeExecPath: '/usr/local/bin/node',
      cliPath: '/opt/brain-cache/dist/cli.js',
      projectPath: '/home/dev/project',
    });

    expect(plist.startsWith('<?xml version="1.0"')).toBe(true);
    expect(plist).toContain('<string>com.brain-cache.watcher.abcd1234</string>');
    expect(plist).toContain('<string>/usr/local/bin/node</string>');
    expect(plist).toContain('<string>/opt/brain-cache/dist/cli.js</string>');
    expect(plist).toContain('<string>watch</string>');
    expect(plist).toContain('<key>WorkingDirectory</key>');
    expect(plist).toContain('<string>/home/dev/project</string>');
    expect(plist).toContain('/home/dev/project/.brain-cache/watcher.log');
    expect(plist).toContain('/home/dev/project/.brain-cache/watcher-error.log');
    expect(plist).toContain('<key>SuccessfulExit</key>');
    expect(plist).toContain('<false/>');
    expect(plist).toContain('<key>RunAtLoad</key>');
  });
});

describe('generateSystemdUnit', () => {
  it('generates expected systemd unit content', () => {
    const unit = generateSystemdUnit({
      description: 'brain-cache watcher for project',
      nodeExecPath: '/usr/local/bin/node',
      cliPath: '/opt/brain-cache/dist/cli.js',
      projectPath: '/home/dev/project',
    });

    expect(unit).toContain('[Unit]');
    expect(unit).toContain('[Service]');
    expect(unit).toContain('[Install]');
    expect(unit).toContain('ExecStart=/usr/local/bin/node /opt/brain-cache/dist/cli.js watch');
    expect(unit).toContain('WorkingDirectory=/home/dev/project');
    expect(unit).toContain('Restart=on-failure');
    expect(unit).toContain('RestartSec=5s');
    expect(unit).toContain('StandardOutput=append:/home/dev/project/.brain-cache/watcher.log');
    expect(unit).toContain('StandardError=append:/home/dev/project/.brain-cache/watcher-error.log');
    expect(unit).toContain('WantedBy=default.target');
  });
});

describe('getCliEntryPath', () => {
  it('returns absolute path ending in cli.js', () => {
    const cliPath = getCliEntryPath();
    expect(cliPath.startsWith('/')).toBe(true);
    expect(cliPath.endsWith('cli.js')).toBe(true);
  });
});
