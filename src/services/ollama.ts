import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import ollama from 'ollama';
import { childLogger } from './logger.js';

const execFileAsync = promisify(execFile);
const log = childLogger('ollama');

/**
 * Returns the configured Ollama host URL.
 * Defaults to 'http://localhost:11434' when OLLAMA_HOST is not set.
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
  // Guard: refuse to spawn a local server when OLLAMA_HOST points to a remote address.
  // If the user configured a remote Ollama, spawning locally is wrong — the health
  // checks would hit the remote host while a local server runs unsupervised.
  const host = getOllamaHost();
  const isLocalhost =
    host === 'http://localhost:11434' ||
    host === 'http://127.0.0.1:11434';

  if (!isLocalhost) {
    throw new Error(
      `OLLAMA_HOST is set to a remote address (${host}). ` +
      `brain-cache cannot auto-start a remote Ollama server. ` +
      `Ensure Ollama is running at ${host} and try again.`
    );
  }

  // Pre-spawn guard: reduces the TOCTOU race window (but does not eliminate it
  // entirely — Ollama itself handles EADDRINUSE safely if a race still occurs).
  const alreadyRunning = await isOllamaRunning();
  if (alreadyRunning) {
    log.info('Ollama is already running, skipping spawn');
    return true;
  }

  log.info('Starting Ollama server...');

  const child = spawn('ollama', ['serve'], {
    detached: true,
    stdio: 'ignore',
  });

  // Capture PID before unreffing so we can kill on timeout or signal
  const pid = child.pid;
  child.unref();

  const MAX_ATTEMPTS = 10;
  const POLL_INTERVAL_MS = 500;

  // Register signal handlers so that if brain-cache is killed mid-startup,
  // we clean up the spawned Ollama process instead of leaving it as an orphan.
  const cleanup = () => {
    try {
      if (pid !== undefined) process.kill(pid, 'SIGTERM');
    } catch {
      // Ignore ESRCH (process already gone) and other errors
    }
  };
  process.once('SIGINT', cleanup);
  process.once('SIGTERM', cleanup);

  let succeeded = false;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    await new Promise<void>((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    const running = await isOllamaRunning();
    if (running) {
      log.info({ pid, attempt: attempt + 1 }, 'Ollama is now running');
      succeeded = true;
      break;
    }
    log.debug({ attempt: attempt + 1, maxAttempts: MAX_ATTEMPTS }, 'Waiting for Ollama to start...');
  }

  // Remove signal handlers regardless of outcome
  process.removeListener('SIGINT', cleanup);
  process.removeListener('SIGTERM', cleanup);

  if (succeeded) {
    return true;
  }

  // Timeout path: kill the spawned process to prevent it becoming an orphan
  try {
    if (pid !== undefined) process.kill(pid, 'SIGTERM');
  } catch {
    // Ignore ESRCH (process already gone) and other errors
  }
  log.warn({ pid }, 'Ollama did not start within timeout — killed spawned process (PID: ' + pid + ')');
  return false;
}

/**
 * Compares an Ollama listed model name against a profile model name.
 * Strips the `:tag` suffix from both sides and compares base names exactly.
 * Prevents false prefix matches (e.g., 'llama3' must not match 'llama3.2').
 */
export function modelMatches(listedName: string, profileModel: string): boolean {
  const listedBase = listedName.split(':')[0];
  const profileBase = profileModel.split(':')[0];
  return listedBase === profileBase;
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
  const alreadyExists = list.models.some((m) => modelMatches(m.name, model));

  if (alreadyExists) {
    log.info({ model }, 'Model already present, skipping pull');
    return;
  }

  log.info({ model }, 'Model not found locally, pulling...');

  const defaultProgress = (status: string) => {
    process.stderr.write(`\rPulling ${model}: ${status}`);
  };

  const progress = onProgress ?? defaultProgress;

  let lastStatus = '';
  const stream = await ollama.pull({ model, stream: true });
  for await (const chunk of stream) {
    const pct = chunk.total
      ? ` ${Math.round(((chunk.completed ?? 0) / chunk.total) * 100)}%`
      : '';
    const status = `${chunk.status}${pct}`;
    if (status !== lastStatus) {
      progress(status);
      lastStatus = status;
    }
  }
  // End the carriage-return line
  if (!onProgress) process.stderr.write('\n');

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
