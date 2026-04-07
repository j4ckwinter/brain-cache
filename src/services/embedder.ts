import ollama from 'ollama';
import { EMBED_TIMEOUT_MS, COLD_START_RETRY_DELAY_MS, DEFAULT_EMBEDDING_DIMENSION } from '../lib/config.js';
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
 * Uses binary search to find all chunk indices that exceed Ollama's context length.
 * Returns the set of original indices that are problematic.
 * O(k * log N) embed calls where k = number of bad chunks, N = batch size.
 */
async function findContextLengthFailures(
  model: string,
  texts: string[],
  originalIndices: number[],
): Promise<Set<number>> {
  const badIndices = new Set<number>();

  // Try embedding the full sub-batch
  try {
    await embedBatch(model, texts);
    return badIndices; // all good
  } catch (err) {
    if (!isContextLengthError(err)) throw err;
  }

  // Base case: single text that fails = it's the bad one
  if (texts.length === 1) {
    badIndices.add(originalIndices[0]);
    return badIndices;
  }

  // Bisect
  const mid = Math.floor(texts.length / 2);
  const leftBad = await findContextLengthFailures(
    model, texts.slice(0, mid), originalIndices.slice(0, mid)
  );
  const rightBad = await findContextLengthFailures(
    model, texts.slice(mid), originalIndices.slice(mid)
  );

  for (const idx of leftBad) badIndices.add(idx);
  for (const idx of rightBad) badIndices.add(idx);
  return badIndices;
}

/**
 * Wraps embedBatch with a single cold-start retry and context-length fallback.
 *
 * When a batch fails with "input length exceeds the context length", uses binary
 * search to isolate problematic chunks in O(log N) calls per bad chunk, then
 * embeds remaining texts in a single batch.
 *
 * @param model   - Ollama model name
 * @param texts   - Array of text strings to embed
 * @param dimension - Embedding dimension (needed for zero-vector fallback)
 * @param attempt - Internal retry counter (0 = first attempt, 1 = retry)
 * @returns Object with embeddings array and count of skipped texts
 */
export async function embedBatchWithRetry(
  model: string,
  texts: string[],
  dimension: number = DEFAULT_EMBEDDING_DIMENSION,
  attempt = 0
): Promise<{ embeddings: number[][], skipped: number, zeroVectorIndices: Set<number> }> {
  try {
    const embeddings = await embedBatch(model, texts);
    return { embeddings, skipped: 0, zeroVectorIndices: new Set() };
  } catch (err) {
    if (attempt === 0 && isConnectionError(err)) {
      log.warn({ model }, 'Ollama cold-start suspected, retrying in 5s');
      await new Promise<void>((r) => setTimeout(r, COLD_START_RETRY_DELAY_MS));
      return embedBatchWithRetry(model, texts, dimension, 1);
    }

    if (isContextLengthError(err)) {
      log.warn({ model, batchSize: texts.length }, 'Batch exceeded context length, using binary search to isolate bad chunks');
      const originalIndices = texts.map((_, i) => i);
      const badIndices = await findContextLengthFailures(model, texts, originalIndices);

      const zeroVectorIndices = new Set<number>(badIndices);
      const skipped = badIndices.size;

      // Embed the good texts in one batch
      const goodTexts: string[] = [];
      const goodOriginalIndices: number[] = [];
      for (let i = 0; i < texts.length; i++) {
        if (!badIndices.has(i)) {
          goodTexts.push(texts[i]);
          goodOriginalIndices.push(i);
        }
      }

      let goodEmbeddings: number[][] = [];
      if (goodTexts.length > 0) {
        goodEmbeddings = await embedBatch(model, goodTexts);
      }

      // Assemble final embeddings array in original order
      const embeddings: number[][] = new Array(texts.length);
      let goodIdx = 0;
      for (let i = 0; i < texts.length; i++) {
        if (badIndices.has(i)) {
          embeddings[i] = new Array(dimension).fill(0);
        } else {
          embeddings[i] = goodEmbeddings[goodIdx++];
        }
      }

      return { embeddings, skipped, zeroVectorIndices };
    }

    throw err;
  }
}
