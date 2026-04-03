import type { Table } from '@lancedb/lancedb';
import { queryEdgesFrom } from './lancedb.js';
import type { FlowHop } from '../lib/types.js';
import { childLogger } from './logger.js';

const log = childLogger('flowTracer');

/** Shape of a row returned by a LanceDB chunks table query. */
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
 * Resolves a symbol name to a chunk ID by querying the chunks table.
 * Prefers a same-file match (locality heuristic) when multiple chunks share the name.
 * Returns null when no chunk has the given name.
 * Single-quotes in the symbol name are escaped to prevent SQL injection.
 */
export async function resolveSymbolToChunkId(
  chunksTable: Table,
  toSymbol: string,
  fromFile: string
): Promise<string | null> {
  const escaped = toSymbol.replace(/'/g, "''");
  const rows = await chunksTable.query().where(`name = '${escaped}'`).toArray() as ChunkRow[];

  if (rows.length === 0) {
    return null;
  }

  const sameFile = rows.find(r => r.file_path === fromFile);
  return (sameFile ?? rows[0]).id;
}

/**
 * Traces call edges breadth-first from a seed chunk, returning all reachable
 * chunks (including the seed) ordered by hop depth.
 *
 * @param edgesTable  - LanceDB table containing call/import edges
 * @param chunksTable - LanceDB table containing code chunks
 * @param seedChunkId - ID of the starting chunk (hop 0)
 * @param opts.maxHops - Maximum number of hops from seed (default: 3)
 *
 * Design decisions:
 * - Only 'call' edges are followed — 'import' edges are skipped
 * - Cycle detection uses a visited Set<string> of chunk IDs
 * - Dead-end edges (toSymbol not found in chunks table) are silently skipped
 * - toFile is null at index time — resolved at query time via resolveSymbolToChunkId
 */
export async function traceFlow(
  edgesTable: Table,
  chunksTable: Table,
  seedChunkId: string,
  opts?: { maxHops?: number }
): Promise<FlowHop[]> {
  const maxHops = opts?.maxHops ?? 3;
  const visited = new Set<string>();
  const queue: Array<{ chunkId: string; depth: number }> = [{ chunkId: seedChunkId, depth: 0 }];
  const hops: FlowHop[] = [];

  log.debug({ seedChunkId, maxHops }, 'Starting BFS flow trace');

  while (queue.length > 0) {
    const { chunkId, depth } = queue.shift()!;

    if (visited.has(chunkId)) {
      continue;
    }
    visited.add(chunkId);

    // Fetch the chunk content for this hop
    const escapedId = chunkId.replace(/'/g, "''");
    const chunkRows = await chunksTable.query().where(`id = '${escapedId}'`).toArray() as ChunkRow[];

    if (chunkRows.length === 0) {
      log.debug({ chunkId }, 'Chunk not found — skipping hop');
      continue;
    }

    const row = chunkRows[0];

    // Always query edges for content hops — needed to populate callsFound
    const edges = await queryEdgesFrom(edgesTable, chunkId);
    const callEdges = edges.filter(e => e.edge_type === 'call');

    hops.push({
      chunkId,
      filePath: row.file_path,
      name: row.name,
      startLine: row.start_line,
      endLine: row.end_line,
      content: row.content,
      hopDepth: depth,
      callsFound: callEdges.map(e => e.to_symbol),
    });

    // Do not enqueue children beyond maxHops
    if (depth >= maxHops) {
      continue;
    }

    for (const edge of callEdges) {
      const nextChunkId = await resolveSymbolToChunkId(chunksTable, edge.to_symbol, edge.from_file);
      if (nextChunkId !== null && !visited.has(nextChunkId)) {
        queue.push({ chunkId: nextChunkId, depth: depth + 1 });
      }
    }
  }

  log.debug({ seedChunkId, hopsFound: hops.length, maxDepthReached: hops.length > 0 ? Math.max(...hops.map(h => h.hopDepth)) : 0 }, 'BFS flow trace complete');

  return hops;
}
