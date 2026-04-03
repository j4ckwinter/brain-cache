import type { Table } from '@lancedb/lancedb';
import type { RetrievedChunk } from '../lib/types.js';
import { formatChunk, countChunkTokens } from './tokenCounter.js';
import { childLogger } from './logger.js';

const log = childLogger('cohesion');

/** Shape of a raw row returned by a LanceDB chunks table query. */
interface ChunkRow {
  id: string;
  file_path: string;
  chunk_type: string;
  scope: string | null;
  name: string | null;
  content: string;
  start_line: number;
  end_line: number;
  [key: string]: unknown;
}

/**
 * Groups retrieved chunks by filePath into a Map.
 * Within each group, chunks are sorted by startLine ascending (source order).
 */
export function groupChunksByFile(chunks: RetrievedChunk[]): Map<string, RetrievedChunk[]> {
  const groups = new Map<string, RetrievedChunk[]>();

  for (const chunk of chunks) {
    const group = groups.get(chunk.filePath);
    if (group === undefined) {
      groups.set(chunk.filePath, [chunk]);
    } else {
      group.push(chunk);
    }
  }

  // Sort each group by startLine ascending
  for (const [, group] of groups) {
    group.sort((a, b) => a.startLine - b.startLine);
  }

  return groups;
}

/**
 * Enriches retrieved chunks by adding parent class chunks for method chunks.
 * For each method chunk with a non-null scope, queries the chunks table for the
 * parent class definition. If found and within token budget, prepends the parent
 * before the method chunk in the result.
 */
export async function enrichWithParentClass(
  chunks: RetrievedChunk[],
  chunksTable: Table,
  opts: { maxTokens: number; currentTokens: number }
): Promise<RetrievedChunk[]> {
  const existingIds = new Set<string>(chunks.map(c => c.id));
  const result: RetrievedChunk[] = [...chunks];
  let { currentTokens } = opts;

  // Collect parents to prepend, in order of discovery
  const parentsToInsert: Array<{ parent: RetrievedChunk; beforeId: string }> = [];

  for (const chunk of chunks) {
    if (chunk.chunkType !== 'method' || chunk.scope === null) {
      continue;
    }

    const escapedScope = chunk.scope.replace(/'/g, "''");
    const escapedFilePath = chunk.filePath.replace(/'/g, "''");

    log.debug({ scope: chunk.scope, filePath: chunk.filePath }, 'Looking for parent class');

    const rows = await chunksTable
      .query()
      .where(`name = '${escapedScope}' AND file_path = '${escapedFilePath}' AND chunk_type = 'class'`)
      .toArray() as ChunkRow[];

    if (rows.length === 0) {
      continue;
    }

    const row = rows[0];
    if (existingIds.has(row.id)) {
      continue;
    }

    const parentChunk: RetrievedChunk = {
      id: row.id,
      filePath: row.file_path,
      chunkType: row.chunk_type,
      scope: row.scope,
      name: row.name,
      content: row.content,
      startLine: row.start_line,
      endLine: row.end_line,
      similarity: 1.0,
    };

    const tokenCost = countChunkTokens(formatChunk(parentChunk));
    if (currentTokens + tokenCost > opts.maxTokens) {
      log.debug({ parentId: row.id, tokenCost, currentTokens, maxTokens: opts.maxTokens }, 'Skipping parent class — token budget exceeded');
      continue;
    }

    existingIds.add(row.id);
    currentTokens += tokenCost;
    parentsToInsert.push({ parent: parentChunk, beforeId: chunk.id });
  }

  // Insert parents before their methods in the result array
  for (const { parent, beforeId } of parentsToInsert) {
    const idx = result.findIndex(c => c.id === beforeId);
    if (idx !== -1) {
      result.splice(idx, 0, parent);
    }
  }

  return result;
}

/**
 * Formats grouped context into a readable string with file headers.
 * Each file section has a "// ── {filePath} ──" header followed by formatted chunks.
 * Sections are separated by "\n\n---\n\n".
 */
export function formatGroupedContext(groups: Map<string, RetrievedChunk[]>): string {
  const sections: string[] = [];

  for (const [filePath, chunks] of groups) {
    const header = `// ── ${filePath} ──`;
    const body = chunks.map(formatChunk).join('\n\n');
    sections.push(`${header}\n${body}`);
  }

  return sections.join('\n\n---\n\n');
}
