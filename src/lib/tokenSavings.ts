import { readFile } from 'node:fs/promises';
import { countChunkTokens } from '../services/tokenCounter.js';
import { TOOL_CALL_OVERHEAD_TOKENS } from './config.js';
import type { RetrievedChunk } from './types.js';

export interface TokenSavingsResult {
  tokensSent: number;
  estimatedWithoutBraincache: number;
  reductionPct: number;
  filesInContext: number;
}

/**
 * Compute token savings by reading actual source files.
 * Matches the canonical pattern from buildContext.ts lines 82-97.
 * Replaces the `tokensSent * 3` magic multiplier in search handlers.
 *
 * Baseline represents what Claude would spend without this tool: one tool call
 * to find relevant files, then one full Read per matched file.
 */
export async function computeTokenSavings(
  chunks: RetrievedChunk[],
): Promise<TokenSavingsResult> {
  const tokensSent = Math.round(
    chunks.reduce((sum, c) => sum + c.content.length, 0) / 4
  );

  const uniqueFiles = [...new Set(chunks.map(c => c.filePath))];
  const filesInContext = uniqueFiles.length;

  let fileContentTokens = 0;
  for (const filePath of uniqueFiles) {
    try {
      const content = await readFile(filePath, 'utf-8');
      fileContentTokens += countChunkTokens(content);
    } catch {
      // File deleted since indexing — skip gracefully
    }
  }

  const toolCalls = 1 + filesInContext;
  const estimatedWithoutBraincache =
    fileContentTokens + toolCalls * TOOL_CALL_OVERHEAD_TOKENS;

  const reductionPct =
    estimatedWithoutBraincache > 0
      ? Math.max(
          0,
          Math.round(
            (1 - tokensSent / estimatedWithoutBraincache) * 100
          )
        )
      : 0;

  return {
    tokensSent,
    estimatedWithoutBraincache,
    reductionPct,
    filesInContext,
  };
}
