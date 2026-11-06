import { withIndexSnapshot } from '../services/indexStorage.js';
import { resolve } from "node:path";
import { requireProfile } from "../lib/guards.js";
import { withIndexConnection, readIndexState } from "../services/lancedb.js";
import { NoIndexError } from "../lib/errors.js";
import { retrieveQuery } from "../services/queryRetrieval.js";
import { deduplicateChunks } from "../services/retriever.js";
import type { RetrievedChunk } from "../lib/types.js";

export interface SearchRunOptions {
  limit?: number;
  path?: string;
  /** A snapshot held by the caller for the entire request. */
  indexDirectory?: string;
}

export interface SearchResult {
  chunks: RetrievedChunk[];
  fallback: boolean;
}

export async function runSearch(
  query: string,
  opts?: SearchRunOptions,
): Promise<SearchResult> {
  await requireProfile();

  const rootDir = resolve(opts?.path ?? ".");
  const read = async (dataDirectory: string): Promise<SearchResult> => {
    const indexState = await readIndexState(rootDir, dataDirectory);
    if (indexState === null) {
      throw new NoIndexError(rootDir);
    }

    return withIndexConnection(rootDir, dataDirectory, async (db) => {
      const tableNames = await db.tableNames();
      if (!tableNames.includes("chunks")) {
        throw new Error("No chunks table found. Run 'brain-cache index' first.");
      }
      const table = await db.openTable("chunks");

      const rowCount = await table.countRows();
      if (rowCount === 0) {
        throw new Error(
          `Index is empty at ${rootDir}. No source files were indexed.`,
        );
      }

      process.stderr.write("brain-cache: searching...\n");
      const { chunks: results, fallback } = await retrieveQuery(
        table, indexState.embeddingModel, query, opts?.limit,
      );
      if (fallback) {
        process.stderr.write(
          "brain-cache: [FALLBACK] Ollama is unavailable. Using keyword search — results may be less relevant.\n",
        );
      }

      const deduped = deduplicateChunks(results);

      process.stderr.write(
        `brain-cache: found ${deduped.length} chunks (${results.length} before dedup)\n`,
      );
      for (const chunk of deduped) {
        process.stderr.write(
          `  ${chunk.similarity.toFixed(3)} ${chunk.filePath}:${chunk.startLine}-${chunk.endLine} [${chunk.chunkType}] ${chunk.name ?? ""}\n`,
        );
      }

      return { chunks: deduped, fallback };
    });
  };
  return opts?.indexDirectory ? read(opts.indexDirectory) : withIndexSnapshot(rootDir, read);
}
