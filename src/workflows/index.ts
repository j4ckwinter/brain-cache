import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { readProfile } from '../services/capability.js';
import { isOllamaRunning } from '../services/ollama.js';
import { crawlSourceFiles } from '../services/crawler.js';
import { chunkFile } from '../services/chunker.js';
import { embedBatchWithRetry } from '../services/embedder.js';
import {
  openDatabase,
  openOrCreateChunkTable,
  insertChunks,
  writeIndexState,
  type ChunkRow,
} from '../services/lancedb.js';
import { EMBEDDING_DIMENSIONS, DEFAULT_BATCH_SIZE, FILE_READ_CONCURRENCY } from '../lib/config.js';
import { countChunkTokens } from '../services/tokenCounter.js';
import type { CodeChunk } from '../lib/types.js';

/**
 * Orchestrates the full indexing pipeline:
 * 1. Resolve target path
 * 2. Read capability profile
 * 3. Check Ollama is running
 * 4. Open LanceDB
 * 5. Crawl source files
 * 6. Chunk each file (AST-aware)
 * 7. Batch embed + store chunks
 * 8. Write index state
 *
 * All output goes to stderr — zero stdout output (per D-16).
 */
export async function runIndex(targetPath?: string): Promise<void> {
  // Step 1: Resolve path
  const rootDir = resolve(targetPath ?? '.');

  // Step 2: Read profile
  const profile = await readProfile();
  if (profile === null) {
    process.stderr.write("No profile found. Run 'brain-cache init' first.\n");
    process.exit(1);
  }

  // Step 3: Check Ollama is running
  const running = await isOllamaRunning();
  if (!running) {
    process.stderr.write(
      "Error: Ollama is not running. Start it with 'ollama serve' or run 'brain-cache init'.\n"
    );
    process.exit(1);
  }

  // Step 4: Determine dimensions
  let dim = EMBEDDING_DIMENSIONS[profile.embeddingModel];
  if (dim === undefined) {
    process.stderr.write(
      `Warning: Unknown embedding model '${profile.embeddingModel}', defaulting to 768 dimensions.\n`
    );
    dim = 768;
  }

  // Step 5: Open LanceDB
  const db = await openDatabase(rootDir);
  const table = await openOrCreateChunkTable(db, rootDir, profile.embeddingModel, dim);

  // Step 6: Crawl source files
  const files = await crawlSourceFiles(rootDir);
  process.stderr.write(`brain-cache: found ${files.length} source files\n`);

  if (files.length === 0) {
    process.stderr.write(`No source files found in ${rootDir}\n`);
    return;
  }

  // Step 7+8: Concurrent file read + streaming embed pipeline
  // Files are read concurrently (up to FILE_READ_CONCURRENCY). Chunks are
  // embedded and stored in batches as they accumulate, keeping memory bounded.
  let totalRawTokens = 0;
  let totalChunkTokens = 0;
  let totalChunks = 0;
  let processedFiles = 0;
  let processedChunks = 0;

  // Process files in groups of FILE_READ_CONCURRENCY.
  // After each group, flush accumulated chunks through embed+store.
  for (let groupStart = 0; groupStart < files.length; groupStart += FILE_READ_CONCURRENCY) {
    const group = files.slice(groupStart, groupStart + FILE_READ_CONCURRENCY);
    const groupChunks: CodeChunk[] = [];

    // Read files concurrently within the group
    const results = await Promise.all(
      group.map(async (filePath) => {
        const content = await readFile(filePath, 'utf-8');
        const rawTokens = countChunkTokens(content);
        const chunks = chunkFile(filePath, content);
        return { rawTokens, chunks };
      })
    );

    // Collect results (sequential to maintain deterministic ordering)
    for (const result of results) {
      totalRawTokens += result.rawTokens;
      groupChunks.push(...result.chunks);
    }
    processedFiles += group.length;
    totalChunks += groupChunks.length;

    if (processedFiles % 10 === 0 || groupStart + FILE_READ_CONCURRENCY >= files.length) {
      process.stderr.write(`brain-cache: chunked ${processedFiles}/${files.length} files\n`);
    }

    // Embed and store this group's chunks in DEFAULT_BATCH_SIZE batches
    for (let offset = 0; offset < groupChunks.length; offset += DEFAULT_BATCH_SIZE) {
      const batch = groupChunks.slice(offset, offset + DEFAULT_BATCH_SIZE);
      const texts = batch.map((chunk) => chunk.content);
      totalChunkTokens += texts.reduce((sum, t) => sum + countChunkTokens(t), 0);
      const vectors = await embedBatchWithRetry(profile.embeddingModel, texts);

      const rows: ChunkRow[] = batch.map((chunk, i) => ({
        id: chunk.id,
        file_path: chunk.filePath,
        chunk_type: chunk.chunkType,
        scope: chunk.scope,
        name: chunk.name,
        content: chunk.content,
        start_line: chunk.startLine,
        end_line: chunk.endLine,
        vector: vectors[i],
      }));

      await insertChunks(table, rows);
      processedChunks += batch.length;
      process.stderr.write(
        `\rbrain-cache: embedding ${processedChunks}/${totalChunks} chunks (${Math.round((processedChunks / totalChunks) * 100)}%)`
      );
    }
  }
  process.stderr.write('\n');
  process.stderr.write(
    `brain-cache: ${totalChunks} chunks from ${files.length} files\n`
  );

  // Step 9: Write index state
  await writeIndexState(rootDir, {
    version: 1,
    embeddingModel: profile.embeddingModel,
    dimension: dim,
    indexedAt: new Date().toISOString(),
    fileCount: files.length,
    chunkCount: totalChunks,
  });

  // Step 10: Print summary with token savings stats
  const reductionPct = totalRawTokens > 0
    ? Math.round((1 - totalChunkTokens / totalRawTokens) * 100)
    : 0;

  process.stderr.write(
    `brain-cache: indexing complete\n` +
    `  Files:        ${files.length}\n` +
    `  Chunks:       ${totalChunks}\n` +
    `  Model:        ${profile.embeddingModel}\n` +
    `  Raw tokens:   ${totalRawTokens.toLocaleString()}\n` +
    `  Chunk tokens: ${totalChunkTokens.toLocaleString()}\n` +
    `  Reduction:    ${reductionPct}%\n` +
    `  Stored in:    ${rootDir}/.brain-cache/\n`
  );
}
