import ollama from 'ollama';
import { EMBED_TIMEOUT_MS, COLD_START_RETRY_DELAY_MS } from '../lib/config.js';
import { childLogger } from './logger.js';

const log = childLogger('embedder');

/**
 * Calls ollama.embed with the given model and text batch.
 * Returns an empty array immediately if texts is empty (no API call made).
 * Races the embed call against a timeout — throws if timeout fires first.
 *
 * @param model     - Ollama model name (e.g. 'nomic-embed-text')
 * @param texts     - Array of text strings to embed in one batch
 * @param timeoutMs - Optional timeout override (defaults to EMBED_TIMEOUT_MS = 120s)
 */
export async function embedBatch(
  model: string,
  texts: string[],
  timeoutMs: number = EMBED_TIMEOUT_MS
): Promise<number[][]> {
  if (texts.length === 0) {
    return [];
  }

  log.debug({ model, batchSize: texts.length }, 'Embedding batch');

  const embedCall = ollama.embed({ model, input: texts }).then((r) => r.embeddings);

  let timerId: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timerId = setTimeout(
      () => reject(new Error(`Embed timeout after ${timeoutMs}ms`)),
      timeoutMs
    );
  });
  // Suppress unhandled rejection if the race resolves before the timeout fires
  timeoutPromise.catch(() => {});

  try {
    return await Promise.race([embedCall, timeoutPromise]);
  } finally {
    clearTimeout(timerId!);
  }
}

/**
 * Returns true if the error looks like a transient connection failure
 * (Ollama cold-start: model loading from disk to VRAM takes 13–46 seconds).
 */
function isConnectionError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  return (
    msg.includes('econnreset') ||
    msg.includes('econnrefused') ||
    msg.includes('fetch failed') ||
    msg.includes('socket hang up')
  );
}

/**
 * Wraps embedBatch with a single cold-start retry.
 * On the first attempt, if a connection error is detected (ECONNRESET, ECONNREFUSED,
 * fetch failed, socket hang up), waits COLD_START_RETRY_DELAY_MS then retries once.
 * Subsequent failures (including the retry) are rethrown without further retries.
 *
 * @param model   - Ollama model name
 * @param texts   - Array of text strings to embed
 * @param attempt - Internal retry counter (0 = first attempt, 1 = retry)
 */
export async function embedBatchWithRetry(
  model: string,
  texts: string[],
  attempt = 0
): Promise<number[][]> {
  try {
    return await embedBatch(model, texts);
  } catch (err) {
    if (attempt === 0 && isConnectionError(err)) {
      log.warn({ model }, 'Ollama cold-start suspected, retrying in 5s');
      await new Promise<void>((r) => setTimeout(r, COLD_START_RETRY_DELAY_MS));
      return embedBatchWithRetry(model, texts, 1);
    }
    throw err;
  }
}
