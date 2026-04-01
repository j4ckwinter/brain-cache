import { countTokens } from '@anthropic-ai/tokenizer';
import { childLogger } from './logger.js';
import type { RetrievedChunk } from '../lib/types.js';

const log = childLogger('tokenCounter');

/**
 * Counts tokens in a text string using Anthropic's tokenizer.
 * Returns 0 for empty strings.
 */
export function countChunkTokens(text: string): number {
  if (text.length === 0) return 0;
  return countTokens(text);
}

/**
 * Formats a retrieved chunk into a context block string.
 * Format:
 *   // File: src/foo.ts (lines 10-25)
 *   <chunk content here>
 */
export function formatChunk(chunk: RetrievedChunk): string {
  return `// File: ${chunk.filePath} (lines ${chunk.startLine}-${chunk.endLine})\n${chunk.content}`;
}

export interface AssembledContext {
  content: string;
  chunks: RetrievedChunk[];
  tokenCount: number;
}

/**
 * Assembles context from chunks using greedy fill.
 * Chunks must already be sorted by similarity descending (caller responsibility).
 * Adds chunks in order until the next chunk would exceed maxTokens.
 */
export function assembleContext(
  chunks: RetrievedChunk[],
  opts: { maxTokens: number }
): AssembledContext {
  const kept: RetrievedChunk[] = [];
  let totalTokens = 0;
  const separator = '\n\n---\n\n';
  const separatorTokens = countChunkTokens(separator); // compute once (4 tokens)

  for (const chunk of chunks) {
    const formatted = formatChunk(chunk);
    const chunkTokens = countChunkTokens(formatted);
    const sepCost = kept.length > 0 ? separatorTokens : 0;

    if (totalTokens + chunkTokens + sepCost > opts.maxTokens) {
      log.debug({ totalTokens, chunkTokens, maxTokens: opts.maxTokens }, 'Token budget reached');
      break;
    }

    kept.push(chunk);
    totalTokens += chunkTokens + sepCost;
  }

  const content = kept.map(formatChunk).join(separator);

  return { content, chunks: kept, tokenCount: totalTokens };
}
