import { dirname, relative, basename } from 'node:path';
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

/**
 * Extracts the first plain-text sentence from a JSDoc comment in chunk content.
 * Skips compressed manifest lines (// [compressed], // Signature:, // [body stripped])
 * before searching for JSDoc. Returns null if no JSDoc or no plain description found (D-05).
 */
export function extractBehavioralSummary(content: string): string | null {
  const lines = content.split('\n');
  const jsDocLines: string[] = [];
  let inJsDoc = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (
      trimmed.startsWith('// [compressed]') ||
      trimmed.startsWith('// Signature:') ||
      trimmed.startsWith('// [body stripped]')
    ) continue;
    if (trimmed.startsWith('/**')) {
      inJsDoc = true;
      jsDocLines.push(line);
      if (trimmed.endsWith('*/')) break;
      continue;
    }
    if (inJsDoc) {
      jsDocLines.push(line);
      if (trimmed.endsWith('*/')) break;
      continue;
    }
  }
  if (jsDocLines.length === 0) return null;
  const descLines = jsDocLines
    .map(l => l.replace(/^\s*\/?\*+\s?/, '').replace(/\s*\*\/.*$/, '').trim())
    .filter(l => l.length > 0 && !l.startsWith('@') && l !== '/');
  return descLines[0] ?? null;
}

/**
 * Groups chunks by their parent directory (module) relative to rootDir.
 * Within each group, chunks are sorted by startLine ascending.
 */
export function groupChunksByModule(
  chunks: RetrievedChunk[],
  rootDir: string,
): Map<string, RetrievedChunk[]> {
  const groups = new Map<string, RetrievedChunk[]>();
  for (const chunk of chunks) {
    const rel = relative(rootDir, chunk.filePath);
    const moduleKey = dirname(rel) || '.';
    const group = groups.get(moduleKey);
    if (group === undefined) groups.set(moduleKey, [chunk]);
    else group.push(chunk);
  }
  for (const [, group] of groups) {
    group.sort((a, b) => a.startLine - b.startLine);
  }
  return groups;
}

/**
 * Extracts internal dependency stems from relative imports in chunk content.
 * Excludes external packages and Node.js builtins (D-10).
 * Returns sorted, deduplicated module stems.
 */
export function extractWiringAnnotations(chunks: RetrievedChunk[]): string[] {
  const importPattern = /from\s+['"](\.[^'"]+)['"]/g;
  const internalDeps = new Set<string>();
  for (const chunk of chunks) {
    for (const match of chunk.content.matchAll(importPattern)) {
      const importPath = match[1];
      const stem = importPath.replace(/\.js$/, '').split('/').pop();
      if (stem && stem.length > 1) {
        internalDeps.add(stem);
      }
    }
  }
  return [...internalDeps].sort();
}

/**
 * Formats module-grouped chunks into narrative prose with behavioral summaries
 * and wiring annotations. Uses "### module:" headers (D-07).
 */
export function formatModuleNarratives(groups: Map<string, RetrievedChunk[]>): string {
  const sections: string[] = [];

  for (const [moduleKey, chunks] of groups) {
    const lines: string[] = [`### module: ${moduleKey}`];

    // Sub-group by file within the module
    const byFile = new Map<string, RetrievedChunk[]>();
    for (const chunk of chunks) {
      const file = chunk.filePath;
      const group = byFile.get(file);
      if (group === undefined) byFile.set(file, [chunk]);
      else group.push(chunk);
    }

    for (const [filePath, fileChunks] of byFile) {
      const fileName = basename(filePath);
      const summary = extractBehavioralSummary(fileChunks[0].content);
      if (summary) {
        lines.push(`\n**${fileName}** -- ${summary}`);
      } else {
        lines.push(`\n**${fileName}**`);
      }

      const wiring = extractWiringAnnotations(fileChunks);
      if (wiring.length > 0) {
        lines.push(`  imports: ${wiring.join(', ')}`);
      }
    }

    sections.push(lines.join('\n'));
  }

  return sections.join('\n\n');
}
