import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';

describe('npm pack --dry-run', () => {
  it('includes all 6 required WASM files in package output', { timeout: 60000 }, () => {
    // Build first — npm pack --dry-run does not run prepare
    execSync('npm run build', { encoding: 'utf8', stdio: 'pipe' });

    const output = execSync('npm pack --dry-run 2>&1', {
      cwd: process.cwd(),
      encoding: 'utf8',
    });

    const required = [
      'dist/wasm/tree-sitter.wasm',
      'dist/wasm/tree-sitter-typescript.wasm',
      'dist/wasm/tree-sitter-tsx.wasm',
      'dist/wasm/tree-sitter-python.wasm',
      'dist/wasm/tree-sitter-go.wasm',
      'dist/wasm/tree-sitter-rust.wasm',
    ];

    for (const file of required) {
      expect(output, `Expected ${file} in npm pack output`).toContain(file);
    }
  });

  it('pack output contains exactly 6 .wasm files', () => {
    const output = execSync('npm pack --dry-run 2>&1', {
      cwd: process.cwd(),
      encoding: 'utf8',
    });

    // Filter to only "npm notice" lines containing .wasm to avoid counting
    // postbuild command echo lines that also contain .wasm paths
    const wasmLines = output.split('\n').filter(
      (line) => line.includes('npm notice') && line.includes('.wasm'),
    );
    expect(wasmLines.length).toBe(6);
  });
});
