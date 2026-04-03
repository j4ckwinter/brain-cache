import { countChunkTokens } from './tokenCounter.js';
import { COMPRESSION_TOKEN_THRESHOLD } from '../lib/config.js';
import type { RetrievedChunk } from '../lib/types.js';

/**
 * Structurally compresses a chunk by stripping its body and prepending
 * a // [compressed] manifest. Only applies when chunk content exceeds
 * COMPRESSION_TOKEN_THRESHOLD tokens.
 *
 * Manifest preserves:
 * - JSDoc block (/** through star-slash)
 * - Signature line (first non-JSDoc non-empty line)
 * - Compression metadata
 *
 * Returns original chunk unchanged if below threshold.
 */
export function compressChunk(chunk: RetrievedChunk): RetrievedChunk {
  const tokens = countChunkTokens(chunk.content);
  if (tokens <= COMPRESSION_TOKEN_THRESHOLD) return chunk;

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
