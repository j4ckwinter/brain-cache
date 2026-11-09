#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const requiredWasm = [
  'dist/wasm/tree-sitter.wasm',
  'dist/wasm/tree-sitter-typescript.wasm',
  'dist/wasm/tree-sitter-tsx.wasm',
  'dist/wasm/tree-sitter-python.wasm',
  'dist/wasm/tree-sitter-go.wasm',
  'dist/wasm/tree-sitter-rust.wasm',
];
const npmExecPath = process.env.npm_execpath;
function runNpm(args, options = {}) {
  if (npmExecPath) {
    return execFileSync(process.execPath, [npmExecPath, ...args], options);
  }
  return execFileSync('npm', args, {
    ...options,
    shell: process.platform === 'win32',
  });
}

const output = runNpm(['pack', '--dry-run', '--json'], {
  encoding: 'utf8',
});
// `prepare` rebuilds here, and npm 10 prints that build output to stdout before the JSON.
const jsonStart = output.search(/^\[$/m);
if (jsonStart < 0) throw new Error(`npm pack did not print JSON:\n${output}`);
const pack = JSON.parse(output.slice(jsonStart))[0];
const packaged = new Set(pack.files.map((file) => file.path.replaceAll('\\', '/')));
const wasm = [...packaged].filter((file) => file.endsWith('.wasm'));

for (const file of requiredWasm) {
  if (!packaged.has(file)) throw new Error(`Package is missing ${file}`);
}
if (wasm.length !== requiredWasm.length) {
  throw new Error(`Expected ${requiredWasm.length} WASM files, found ${wasm.length}`);
}

const smokeRoot = await mkdtemp(join(tmpdir(), 'brain-cache-pack-'));
try {
  const npmCache = join(smokeRoot, 'npm-cache');
  const installRoot = join(smokeRoot, 'install');
  await mkdir(installRoot, { recursive: true });
  const tarball = runNpm(['pack', '--silent', '--pack-destination', smokeRoot], {
    encoding: 'utf8',
  }).trim().split(/\r?\n/).at(-1);
  runNpm(['init', '-y'], { cwd: installRoot, stdio: 'ignore' });
  runNpm(['install', '--ignore-scripts', join(smokeRoot, tarball)], {
    cwd: installRoot,
    stdio: 'ignore',
    env: { ...process.env, npm_config_cache: npmCache },
  });
  const installedRoot = join(installRoot, 'node_modules', 'brain-cache');
  const installedPackage = JSON.parse(await readFile(join(installedRoot, 'package.json'), 'utf8'));
  if (!installedPackage.version) throw new Error('Installed package has no version');
  for (const file of requiredWasm) {
    await readFile(join(installedRoot, file)).catch(() => {
      throw new Error(`Installed package is missing ${file}`);
    });
  }
  const cli = join(installRoot, 'node_modules', 'brain-cache', 'dist', 'cli.js');
  const version = execFileSync(process.execPath, [cli, '--version'], {
    cwd: installRoot,
    encoding: 'utf8',
  }).trim();
  if (version !== installedPackage.version) {
    throw new Error(`Installed CLI reported ${version}, expected ${installedPackage.version}`);
  }

  const isolatedHome = join(smokeRoot, 'home');
  await mkdir(isolatedHome, { recursive: true });
  const smokeEnv = { ...process.env, HOME: isolatedHome, USERPROFILE: isolatedHome };
  try {
    execFileSync(process.execPath, [cli, 'doctor'], {
      cwd: installRoot,
      encoding: 'utf8',
      env: smokeEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    throw new Error('doctor unexpectedly succeeded without a profile');
  } catch (error) {
    const stderr = String(error?.stderr ?? '');
    if (!stderr.includes("No profile found. Run 'brain-cache init' first.")) {
      throw error;
    }
  }
} finally {
  await rm(smokeRoot, { recursive: true, force: true });
}

process.stdout.write('Distribution verification passed.\n');
