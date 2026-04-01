import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import ollama from 'ollama';
import { childLogger } from './logger.js';

const execFileAsync = promisify(execFile);
const log = childLogger('ollama');

/**
 * Returns the Ollama host URL, respecting the OLLAMA_HOST environment variable.
 * Falls back to http://localhost:11434 when not set.
 */
export function getOllamaHost(): string {
  return process.env.OLLAMA_HOST ?? 'http://localhost:11434';
}

/**
 * Checks whether the Ollama binary is installed on this machine.
 * Uses 'which' on Unix/Mac, 'where' on Windows.
 */
export async function isOllamaInstalled(): Promise<boolean> {
  try {
    const cmd = process.platform === 'win32' ? 'where' : 'which';
    await execFileAsync(cmd, ['ollama']);
    return true;
  } catch {
    return false;
  }
}

/**
 * Checks whether the Ollama server is currently running.
 * Uses OLLAMA_HOST env var when set, falls back to http://localhost:11434.
 */
export async function isOllamaRunning(): Promise<boolean> {
  try {
    const res = await fetch(getOllamaHost());
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Spawns 'ollama serve' as a detached background process, then polls
 * for readiness every 500ms for up to 5 seconds (10 attempts).
 * Returns true if Ollama becomes ready, false if timeout is reached.
 */
export async function startOllama(): Promise<boolean> {
  log.info('Starting Ollama server...');

  const child = spawn('ollama', ['serve'], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  const MAX_ATTEMPTS = 10;
  const POLL_INTERVAL_MS = 500;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    await new Promise<void>((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    const running = await isOllamaRunning();
    if (running) {
      log.info({ attempt: attempt + 1 }, 'Ollama is now running');
      return true;
    }
    log.debug({ attempt: attempt + 1, maxAttempts: MAX_ATTEMPTS }, 'Waiting for Ollama to start...');
  }

  log.warn('Ollama did not start within timeout');
  return false;
}

/**
 * Pulls a model from Ollama if it is not already present in the local model list.
 * Reports progress via onProgress callback (defaults to stderr output).
 */
export async function pullModelIfMissing(
  model: string,
  onProgress?: (status: string) => void
): Promise<void> {
  const list = await ollama.list();
  const alreadyExists = list.models.some((m) => m.name.startsWith(model));

  if (alreadyExists) {
    log.info({ model }, 'Model already present, skipping pull');
    return;
  }

  log.info({ model }, 'Model not found locally, pulling...');

  const defaultProgress = (status: string) => {
    process.stderr.write(`Pulling ${model}: ${status}\n`);
  };

  const progress = onProgress ?? defaultProgress;

  const stream = await ollama.pull({ model, stream: true });
  for await (const chunk of stream) {
    progress(chunk.status);
  }

  log.info({ model }, 'Model pull complete');
}

/**
 * Returns the installed Ollama version string, or null if not available.
 */
export async function getOllamaVersion(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('ollama', ['--version']);
    return stdout.trim();
  } catch {
    return null;
  }
}
