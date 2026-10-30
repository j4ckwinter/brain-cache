import { countTokens } from '@anthropic-ai/tokenizer';
import { childLogger } from './logger.js';
import type { RetrievedChunk } from '../lib/types.js';

const log = childLogger('tokenCounter');

/**
 * Estimates tokens locally using Anthropic's legacy tokenizer.
 * Modern Claude token counts differ; this is a budget heuristic, not billing usage.
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
 * Fills the estimated token budget with source chunks before git history.
 * Preserves retrieval order within each group and skips chunks that do not fit.
 */
export function assembleContext(
  chunks: RetrievedChunk[],
  opts: { maxTokens: number }
): AssembledContext {
  const kept: RetrievedChunk[] = [];
  let content = '';
  let totalTokens = 0;
  let hasHistory = false;
  const ordered = [
    ...chunks.filter(chunk => chunk.sourceKind !== 'history'),
    ...chunks.filter(chunk => chunk.sourceKind === 'history'),
  ];

  for (const chunk of ordered) {
    const isHistory = chunk.sourceKind === 'history';
    const separator = content.length === 0 ? '' : isHistory ? '\n\n' : '\n\n---\n\n';
    const heading = isHistory && !hasHistory ? '## Git History\n\n' : '';
    const formatted = isHistory
      ? `### ${chunk.name ?? chunk.id}\n${chunk.content}`
      : formatChunk(chunk);
    const candidate = content + separator + heading + formatted;
    const candidateTokens = countChunkTokens(candidate);

    if (candidateTokens > opts.maxTokens) {
      log.debug({ candidateTokens, maxTokens: opts.maxTokens }, 'Skipping chunk that exceeds token budget');
      continue;
    }

    kept.push(chunk);
    content = candidate;
    totalTokens = candidateTokens;
    if (isHistory) hasHistory = true;
  }

  return { content, chunks: kept, tokenCount: totalTokens };
}
