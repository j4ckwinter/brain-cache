import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROJECT_DATA_DIR } from './config.js';

interface PlistOptions {
  label: string;
  nodeExecPath: string;
  cliPath: string;
  projectPath: string;
}

interface SystemdUnitOptions {
  description: string;
  nodeExecPath: string;
  cliPath: string;
  projectPath: string;
}

export function hashProjectPath(projectPath: string): string {
  return createHash('sha256').update(resolve(projectPath)).digest('hex').slice(0, 8);
}

export function getMacOSLabel(hash: string): string {
  return `com.brain-cache.watcher.${hash}`;
}

export function getLinuxUnitName(hash: string): string {
  return `brain-cache-watcher-${hash}.service`;
}

export function getPlistPath(label: string): string {
  return `${homedir()}/Library/LaunchAgents/${label}.plist`;
}

export function getUserSystemdDir(): string {
  return `${homedir()}/.config/systemd/user`;
}

export function getCliEntryPath(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', 'cli.js');
}

export function generatePlist(opts: PlistOptions): string {
  const logDir = `${opts.projectPath}/${PROJECT_DATA_DIR}`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${opts.label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${opts.nodeExecPath}</string>
    <string>${opts.cliPath}</string>
    <string>watch</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${opts.projectPath}</string>
  <key>StandardOutPath</key>
  <string>${logDir}/watcher.log</string>
  <key>StandardErrorPath</key>
  <string>${logDir}/watcher-error.log</string>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>RunAtLoad</key>
  <true/>
</dict>
</plist>`;
}

export function generateSystemdUnit(opts: SystemdUnitOptions): string {
  const logDir = `${opts.projectPath}/${PROJECT_DATA_DIR}`;

  return `[Unit]
Description=${opts.description}
After=network.target

[Service]
Type=simple
ExecStart=${opts.nodeExecPath} ${opts.cliPath} watch
WorkingDirectory=${opts.projectPath}
Restart=on-failure
RestartSec=5s
StandardOutput=append:${logDir}/watcher.log
StandardError=append:${logDir}/watcher-error.log

[Install]
WantedBy=default.target
`;
}
