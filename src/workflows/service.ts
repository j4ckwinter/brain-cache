import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { PROJECT_DATA_DIR } from '../lib/config.js';
import {
  generatePlist,
  generateSystemdUnit,
  getCliEntryPath,
  getLinuxUnitName,
  getMacOSLabel,
  getPlistPath,
  getUserSystemdDir,
  hashProjectPath,
} from '../lib/serviceUnit.js';

export async function runServiceInstall(): Promise<void> {
  const projectPath = resolve(process.cwd());
  const hash = hashProjectPath(projectPath);
  const logsDir = resolve(projectPath, PROJECT_DATA_DIR);

  if (process.platform === 'win32') {
    process.stderr.write(
      'Windows service management is not built in.\n' +
      'Use NSSM or Task Scheduler to run "brain-cache watch" for this project.\n',
    );
    return;
  }

  if (process.platform === 'darwin') {
    const label = getMacOSLabel(hash);
    const plistPath = getPlistPath(label);
    if (existsSync(plistPath)) {
      throw new Error(`Service already installed for this project (${label}). Run 'brain-cache service uninstall' first.`);
    }
    if (typeof process.getuid !== 'function') {
      throw new Error('Service install requires a POSIX system');
    }

    const uid = process.getuid();
    const plist = generatePlist({
      label,
      nodeExecPath: process.execPath,
      cliPath: getCliEntryPath(),
      projectPath,
    });

    await mkdir(logsDir, { recursive: true });
    await writeFile(plistPath, plist, 'utf8');
    execSync(`launchctl bootstrap gui/${uid} "${plistPath}"`, { stdio: 'inherit' });
    process.stderr.write(`Service installed: ${label}\nLogs: ${projectPath}/${PROJECT_DATA_DIR}/watcher.log\n`);
    return;
  }

  if (process.platform === 'linux') {
    const unitName = getLinuxUnitName(hash);
    const unitDir = getUserSystemdDir();
    const unitPath = `${unitDir}/${unitName}`;
    if (existsSync(unitPath)) {
      throw new Error(`Service already installed for this project (${unitName}). Run 'brain-cache service uninstall' first.`);
    }

    const unit = generateSystemdUnit({
      description: `brain-cache watcher for ${projectPath}`,
      nodeExecPath: process.execPath,
      cliPath: getCliEntryPath(),
      projectPath,
    });

    await mkdir(unitDir, { recursive: true });
    await mkdir(logsDir, { recursive: true });
    await writeFile(unitPath, unit, 'utf8');

    execSync('systemctl --user daemon-reload', { stdio: 'inherit' });
    execSync(`systemctl --user enable --now ${unitName}`, { stdio: 'inherit' });
    const username = execSync('whoami', { encoding: 'utf8' }).trim();
    execSync(`loginctl enable-linger ${username}`, { stdio: 'inherit' });

    process.stderr.write(`Service installed: ${unitName}\nLogs: ${projectPath}/${PROJECT_DATA_DIR}/watcher.log\n`);
    return;
  }

  throw new Error(`Unsupported platform for service install: ${process.platform}`);
}

export async function runServiceUninstall(): Promise<void> {
  const projectPath = resolve(process.cwd());
  const hash = hashProjectPath(projectPath);

  if (process.platform === 'win32') {
    process.stderr.write(
      'Windows service management is not built in.\n' +
      'Remove your NSSM/Task Scheduler entry manually.\n',
    );
    return;
  }

  if (process.platform === 'darwin') {
    const label = getMacOSLabel(hash);
    const plistPath = getPlistPath(label);
    if (!existsSync(plistPath)) {
      throw new Error('Service not installed for this project.');
    }
    if (typeof process.getuid !== 'function') {
      throw new Error('Service uninstall requires a POSIX system');
    }

    const uid = process.getuid();
    try {
      execSync(`launchctl bootout gui/${uid} "${plistPath}"`, { stdio: 'inherit' });
    } catch {
      // Not loaded is safe during uninstall.
    }
    await unlink(plistPath);
    process.stderr.write(`Service uninstalled: ${label}\n`);
    return;
  }

  if (process.platform === 'linux') {
    const unitName = getLinuxUnitName(hash);
    const unitPath = `${getUserSystemdDir()}/${unitName}`;
    if (!existsSync(unitPath)) {
      throw new Error('Service not installed for this project.');
    }

    try {
      execSync(`systemctl --user stop ${unitName}`, { stdio: 'inherit' });
    } catch {
      // Ignore stop errors on missing runtime unit.
    }
    try {
      execSync(`systemctl --user disable ${unitName}`, { stdio: 'inherit' });
    } catch {
      // Ignore disable errors when unit is already disabled.
    }
    await unlink(unitPath);
    execSync('systemctl --user daemon-reload', { stdio: 'inherit' });
    process.stderr.write(`Service uninstalled: ${unitName}\n`);
    return;
  }

  throw new Error(`Unsupported platform for service uninstall: ${process.platform}`);
}

export async function runServiceStatus(): Promise<void> {
  const projectPath = resolve(process.cwd());
  const hash = hashProjectPath(projectPath);

  if (process.platform === 'win32') {
    process.stderr.write('Service management is not available on Windows.\n');
    return;
  }

  if (process.platform === 'darwin') {
    const label = getMacOSLabel(hash);
    const plistPath = getPlistPath(label);
    process.stderr.write(`Current project service: ${label}\n`);
    process.stderr.write(`Installed file: ${existsSync(plistPath) ? 'yes' : 'no'}\n`);

    if (typeof process.getuid !== 'function') {
      throw new Error('Service status requires a POSIX system');
    }
    const uid = process.getuid();
    try {
      const status = execSync(`launchctl print gui/${uid}/${label}`, {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      process.stderr.write(`${status}\n`);
    } catch {
      process.stderr.write('launchctl status: not loaded\n');
    }

    const launchAgentsDir = `${homedir()}/Library/LaunchAgents`;
    const files = await readdir(launchAgentsDir).catch(() => []);
    const other = files.filter(name => name.startsWith('com.brain-cache.watcher.'));
    process.stderr.write(`Other brain-cache services (${other.length}):\n`);
    for (const entry of other) {
      process.stderr.write(`- ${entry}\n`);
    }
    return;
  }

  if (process.platform === 'linux') {
    const unitName = getLinuxUnitName(hash);
    process.stderr.write(`Current project service: ${unitName}\n`);
    try {
      const status = execSync(`systemctl --user status ${unitName}`, {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      process.stderr.write(`${status}\n`);
    } catch {
      process.stderr.write('systemctl status: not installed or not running\n');
    }

    try {
      const list = execSync('systemctl --user list-units "brain-cache-watcher-*" --no-legend', {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
      process.stderr.write(`Other brain-cache services:\n${list || '(none)'}\n`);
    } catch {
      process.stderr.write('Other brain-cache services: (none)\n');
    }
    return;
  }

  throw new Error(`Unsupported platform for service status: ${process.platform}`);
}
