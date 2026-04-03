import { countChunkTokens } from './tokenCounter.js';
import {
  COMPRESSION_TOKEN_THRESHOLD,
  HIGH_RELEVANCE_SIMILARITY_THRESHOLD,
  COMPRESSION_HARD_LIMIT,
} from '../lib/config.js';
import type { RetrievedChunk } from '../lib/types.js';

/**
 * Structurally compresses a chunk by stripping its body and prepending
 * a // [compressed] manifest.
 *
 * Compression rules (in order):
 * 1. If chunk tokens <= COMPRESSION_TOKEN_THRESHOLD (500): never compress.
 * 2. If chunk tokens > COMPRESSION_HARD_LIMIT (800): always compress
 *    regardless of relevance — guards against budget-hogging chunks.
 * 3. In between (500 < tokens <= 800): compress only when the chunk's
 *    similarity score is below HIGH_RELEVANCE_SIMILARITY_THRESHOLD (0.85).
 *    High-relevance chunks in this range are kept intact so Claude can
 *    answer deep architectural questions without reading source files.
 *
 * Manifest preserves:
 * - JSDoc block (/** through star-slash)
 * - Signature line (first non-JSDoc non-empty line)
 * - Compression metadata
 *
 * Returns original chunk unchanged when compression is not applied.
 */
export function compressChunk(chunk: RetrievedChunk): RetrievedChunk {
  const tokens = countChunkTokens(chunk.content);

  // Rule 1: below base threshold — never compress
  if (tokens <= COMPRESSION_TOKEN_THRESHOLD) return chunk;

  // Rule 2: above hard limit — always compress
  // Rule 3: in the middle range, only compress low-relevance chunks
  const isHighRelevance = chunk.similarity >= HIGH_RELEVANCE_SIMILARITY_THRESHOLD;
  if (tokens <= COMPRESSION_HARD_LIMIT && isHighRelevance) {
    return chunk;
  }

  const lines = chunk.content.split('\n');

  // Extract JSDoc block if present
  const jsDocLines: string[] = [];
  let signatureLine = '';
  let inJsDoc = false;
  let jsDocDone = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!jsDocDone) {
      if (trimmed.startsWith('/**')) {
        inJsDoc = true;
        jsDocLines.push(line);
        if (trimmed.endsWith('*/')) {
          inJsDoc = false;
          jsDocDone = true;
        }
        continue;
      }
      if (inJsDoc) {
        jsDocLines.push(line);
        if (trimmed.endsWith('*/')) {
          inJsDoc = false;
          jsDocDone = true;
        }
        continue;
      }
    }
    // First non-empty, non-JSDoc line is the signature
    if (trimmed.length > 0 && signatureLine === '') {
      signatureLine = line;
      break;
    }
  }

  // If no JSDoc found and no signature found, find first non-empty line
  if (signatureLine === '' && jsDocLines.length === 0) {
    signatureLine = lines.find(l => l.trim().length > 0) ?? '';
  }

  const manifestParts = [
    `// [compressed] ${chunk.name ?? 'unknown'} (lines ${chunk.startLine}-${chunk.endLine})`,
  ];
  if (jsDocLines.length > 0) {
    manifestParts.push(...jsDocLines);
  }
  manifestParts.push(`// Signature: ${signatureLine}`);
  manifestParts.push('// [body stripped]');

  return { ...chunk, content: manifestParts.join('\n') };
}
