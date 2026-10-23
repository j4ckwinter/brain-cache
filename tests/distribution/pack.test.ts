import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const exec = promisify(execFile);
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const repoRoot = process.cwd();
let scratch: string;
let tarball: string;
let version: string;
let packedFiles: string[];

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'brain-cache-package-'));
  const pkg = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8'));
  version = pkg.version;
  // npm pack runs prepare, so this verifies the release build too.
  await exec(npm, ['pack', '--silent', '--pack-destination', scratch], {
    cwd: repoRoot, timeout: 120_000,
  });
  tarball = join(scratch, `brain-cache-${version}.tgz`);
  const listing = await exec('tar', ['-tf', tarball]);
  packedFiles = listing.stdout.trim().split('\n');
}, 150_000);

afterAll(async () => {
  if (scratch) await rm(scratch, { recursive: true, force: true });
});

describe('published package', () => {
  it('ships all six WASM assets and the Claude skill', () => {
    expect(packedFiles.filter(file => file.endsWith('.wasm')).sort()).toEqual([
      'tree-sitter.wasm', 'tree-sitter-typescript.wasm', 'tree-sitter-tsx.wasm',
      'tree-sitter-python.wasm', 'tree-sitter-go.wasm', 'tree-sitter-rust.wasm',
    ].map(file => `package/dist/wasm/${file}`).sort());
    expect(packedFiles).toContain('package/.claude/skills/brain-cache/SKILL.md');
  });

  it.each(['local', 'global'] as const)('runs CLI, MCP, and grammars from a %s tarball installation', async mode => {
    const prefix = join(scratch, `${mode} install with spaces`);
    await mkdir(prefix);
    if (mode === 'local') {
      await writeFile(join(prefix, 'package.json'), JSON.stringify({ name: 'install-smoke', private: true }));
    }
    await exec(npm, [
      'install', ...(mode === 'global' ? ['--global'] : []), '--prefix', prefix,
      '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund', tarball,
    ], { cwd: prefix, timeout: 120_000 });
    const modules = mode === 'local'
      ? join(prefix, 'node_modules')
      : (await exec(npm, ['root', '--global', '--prefix', prefix], { cwd: prefix })).stdout.trim();
    const installed = join(modules, 'brain-cache');
    const launcher = mode === 'local'
      ? join(modules, '.bin', 'brain-cache')
      : join(prefix, 'bin', 'brain-cache');
    const cli = await exec(launcher, ['--version'], { cwd: prefix });
    expect(cli.stdout.trim()).toBe(version);

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [join(installed, 'dist', 'mcp.js')],
      cwd: prefix,
      stderr: 'pipe',
    });
    const client = new Client({ name: 'distribution-smoke', version: '1.0.0' });
    try {
      await client.connect(transport);
      expect((await client.listTools()).tools.map(tool => tool.name).sort()).toEqual([
        'build_context', 'doctor', 'index_repo', 'search_codebase',
      ]);
    } finally {
      await client.close();
      await transport.close();
    }

    // Load the published assets, never source-tree WASM or a globally installed parser.
    const probe = `
      import { Parser, Language } from 'web-tree-sitter';
      import { join } from 'node:path';
      const wasm = process.argv[1];
      await Parser.init({ locateFile: name => join(wasm, name) });
      const samples = {
        typescript: 'export function hello(): number { return 1; }',
        tsx: 'const element = <div>Hello</div>;',
        python: 'def hello():\\n    return 1\\n',
        go: 'package main\\nfunc hello() int { return 1 }',
        rust: 'fn hello() -> i32 { 1 }',
      };
      for (const [name, source] of Object.entries(samples)) {
        const parser = new Parser();
        parser.setLanguage(await Language.load(join(wasm, 'tree-sitter-' + name + '.wasm')));
        const tree = parser.parse(source);
        if (!tree || tree.rootNode.hasError) throw new Error('Parse failed: ' + name);
        tree.delete();
        parser.delete();
      }
      console.log('5 grammars passed');
    `;
    const result = await exec(process.execPath, [
      '--input-type=module', '-e', probe, join(installed, 'dist', 'wasm'),
    ], { cwd: installed, timeout: 15_000 });
    expect(result.stdout.trim()).toBe('5 grammars passed');
  }, 150_000);
});
