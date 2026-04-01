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

  const embedCall = ollama.embed({ model, input: texts, truncate: true }).then((r) => r.embeddings);

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
 * Returns true if the error is an Ollama context-length rejection.
 */
function isContextLengthError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  return msg.includes('input length exceeds the context length');
}

/**
 * Wraps embedBatch with a single cold-start retry and context-length fallback.
 *
 * When a batch fails with "input length exceeds the context length", falls back
 * to embedding each text individually. Texts that still exceed the limit are
 * replaced with zero vectors and a warning is logged.
 *
 * @param model   - Ollama model name
 * @param texts   - Array of text strings to embed
 * @param dimension - Embedding dimension (needed for zero-vector fallback)
 * @param attempt - Internal retry counter (0 = first attempt, 1 = retry)
 */
export async function embedBatchWithRetry(
  model: string,
  texts: string[],
  dimension: number = 768,
  attempt = 0
): Promise<number[][]> {
  try {
    return await embedBatch(model, texts);
  } catch (err) {
    if (attempt === 0 && isConnectionError(err)) {
      log.warn({ model }, 'Ollama cold-start suspected, retrying in 5s');
      await new Promise<void>((r) => setTimeout(r, COLD_START_RETRY_DELAY_MS));
      return embedBatchWithRetry(model, texts, dimension, 1);
    }

    // Context-length error: fall back to one-at-a-time embedding
    if (isContextLengthError(err)) {
      log.warn({ model, batchSize: texts.length }, 'Batch exceeded context length, falling back to individual embedding');
      const results: number[][] = [];
      for (const text of texts) {
        try {
          const [vec] = await embedBatch(model, [text]);
          results.push(vec);
        } catch (innerErr) {
          if (isContextLengthError(innerErr)) {
            process.stderr.write(
              `\nbrain-cache: chunk too large for embedding model, skipping (${text.length} chars)\n`
            );
            results.push(new Array(dimension).fill(0));
          } else {
            throw innerErr;
          }
        }
      }
      return results;
    }

    throw err;
  }
}
