import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const SCRIPT_PATH = join(process.cwd(), 'src/scripts/statusline.mjs');
const STDIN_JSON = JSON.stringify({
  model: { display_name: 'Sonnet' },
  session_id: 'test-session'
});

/**
 * Runs statusline.mjs as a subprocess, piping input to stdin.
 * Returns { stdout, stderr, code }.
 */
function runScript(
  input: string,
  env: NodeJS.ProcessEnv,
  timeoutMs = 5000
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [SCRIPT_PATH], { env });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Script timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code });
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.stdin.write(input);
    child.stdin.end();
  });
}

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'statusline-integration-'));
  await mkdir(join(tempDir, '.brain-cache'), { recursive: true });
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe('statusline.mjs subprocess integration', () => {
  it('Test 1: valid stats — renders savings line (STAT-03)', async () => {
    const statsPath = join(tempDir, '.brain-cache', 'session-stats.json');
    await writeFile(statsPath, JSON.stringify({
      tokensSent: 371,
      estimatedWithoutBraincache: 2727,
      callCount: 5,
      lastUpdatedAt: new Date().toISOString(),
    }), 'utf-8');

    const { stdout, code } = await runScript(STDIN_JSON, { ...process.env, HOME: tempDir });

    expect(code).toBe(0);
    expect(stdout).toBe('brain-cache  \u219386%  2k saved\n');
  });

  it('Test 2: no stats file — renders idle (STAT-04)', async () => {
    // No stats file written — directory exists but is empty
    const { stdout, code } = await runScript(STDIN_JSON, { ...process.env, HOME: tempDir });

    expect(code).toBe(0);
    expect(stdout).toBe('brain-cache  idle\n');
  });

  it('Test 3: expired stats file — renders idle (STAT-04)', async () => {
    const statsPath = join(tempDir, '.brain-cache', 'session-stats.json');
    await writeFile(statsPath, JSON.stringify({
      tokensSent: 371,
      estimatedWithoutBraincache: 2727,
      callCount: 5,
      lastUpdatedAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    }), 'utf-8');

    const { stdout, code } = await runScript(STDIN_JSON, { ...process.env, HOME: tempDir });

    expect(code).toBe(0);
    expect(stdout).toBe('brain-cache  idle\n');
  });

  it('Test 4: malformed JSON stats file — renders idle (STAT-04)', async () => {
    const statsPath = join(tempDir, '.brain-cache', 'session-stats.json');
    await writeFile(statsPath, '{not valid json', 'utf-8');

    const { stdout, code } = await runScript(STDIN_JSON, { ...process.env, HOME: tempDir });

    expect(code).toBe(0);
    expect(stdout).toBe('brain-cache  idle\n');
  });

  it('Test 5: zero estimated tokens — renders idle (STAT-04)', async () => {
    const statsPath = join(tempDir, '.brain-cache', 'session-stats.json');
    await writeFile(statsPath, JSON.stringify({
      tokensSent: 0,
      estimatedWithoutBraincache: 0,
      callCount: 5,
      lastUpdatedAt: new Date().toISOString(),
    }), 'utf-8');

    const { stdout, code } = await runScript(STDIN_JSON, { ...process.env, HOME: tempDir });

    expect(code).toBe(0);
    expect(stdout).toBe('brain-cache  idle\n');
  });

  it('Test 6: cold-start timing — completes under 500ms (STAT-03)', async () => {
    const statsPath = join(tempDir, '.brain-cache', 'session-stats.json');
    await writeFile(statsPath, JSON.stringify({
      tokensSent: 371,
      estimatedWithoutBraincache: 2727,
      callCount: 5,
      lastUpdatedAt: new Date().toISOString(),
    }), 'utf-8');

    const start = performance.now();
    const { code } = await runScript(STDIN_JSON, { ...process.env, HOME: tempDir });
    const elapsed = performance.now() - start;

    expect(code).toBe(0);
    // Generous allowance for CI VMs; actual cold-start should be < 100ms on real hardware
    expect(elapsed).toBeLessThan(500);
  });
});
