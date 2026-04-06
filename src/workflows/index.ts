import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { readProfile } from '../services/capability.js';
import { isOllamaRunning } from '../services/ollama.js';
import { crawlSourceFiles } from '../services/crawler.js';
import { chunkFile } from '../services/chunker.js';
import { embedBatchWithRetry } from '../services/embedder.js';
import { acquireIndexLock, releaseIndexLock } from '../services/indexLock.js';
import { childLogger, setLogLevel } from '../services/logger.js';

const log = childLogger('index');
import {
  openDatabase,
  openOrCreateChunkTable,
  insertChunks,
  createVectorIndexIfNeeded,
  writeIndexState,
  readFileHashes,
  writeFileHashes,
  deleteChunksByFilePath,
  openOrCreateEdgesTable,
  insertEdges,
  withWriteLock,
  classifyFileType,
  type ChunkRow,
} from '../services/lancedb.js';
import { EMBEDDING_DIMENSIONS, DEFAULT_EMBEDDING_DIMENSION, DEFAULT_BATCH_SIZE, FILE_READ_CONCURRENCY, EMBED_MAX_TOKENS } from '../lib/config.js';
import { countChunkTokens } from '../services/tokenCounter.js';
import type { CodeChunk, CallEdge } from '../lib/types.js';
import { formatTokenSavings } from '../lib/format.js';

/**
 * Compute a SHA-256 hex digest of file content.
 */
function hashContent(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

/**
 * Orchestrates the full indexing pipeline with incremental support:
 * 1. Resolve target path
 * 2. Read capability profile
 * 3. Check Ollama is running
 * 4. Open LanceDB
 * 5. Crawl source files
 * 6. Read all files, compute SHA-256 hashes, diff against stored manifest
 * 7. Delete chunks for removed + changed files
 * 8. Chunk, embed, and store new + changed files only
 * 9. Write updated hash manifest and index state
 *
 * All output goes to stderr — zero stdout output (per D-16).
 *
 * @param targetPath - Directory to index (defaults to current directory)
 * @param opts.force - If true, ignore stored hashes and perform full reindex
 */
export async function runIndex(targetPath?: string, opts?: { force?: boolean }): Promise<void> {
  const force = opts?.force ?? false;

  // Suppress pino JSON output during indexing — the workflow writes its own human-friendly messages.
  const previousLogLevel = process.env.BRAIN_CACHE_LOG ?? 'warn';
  setLogLevel('silent');

  // Filter LanceDB Rust-layer warnings that write directly to stderr.
  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: any, ...args: any[]) => {
    const str = typeof chunk === 'string' ? chunk : chunk.toString();
    if (/^\[[\d\-T:Z]+ WARN lance/.test(str) || /^\[[\d\-T:Z]+ INFO lance/.test(str)) {
      return true; // swallow
    }
    return originalStderrWrite(chunk, ...args);
  }) as typeof process.stderr.write;

  // Step 1: Resolve path (before try so lock can be acquired and released)
  const rootDir = resolve(targetPath ?? '.');
  await acquireIndexLock(rootDir);

  try {
  // Step 2: Read profile
  const profile = await readProfile();
  if (profile === null) {
    throw new Error("No profile found. Run 'brain-cache init' first.");
  }

  // Step 3: Check Ollama is running
  const running = await isOllamaRunning();
  if (!running) {
    throw new Error("Ollama is not running. Start it with 'ollama serve' or run 'brain-cache init'.");
  }

  // Step 4: Determine dimensions
  const dim = EMBEDDING_DIMENSIONS[profile.embeddingModel] ?? DEFAULT_EMBEDDING_DIMENSION;
  if (!(profile.embeddingModel in EMBEDDING_DIMENSIONS)) {
    process.stderr.write(
      `Warning: Unknown embedding model '${profile.embeddingModel}', defaulting to ${DEFAULT_EMBEDDING_DIMENSION} dimensions.\n`
    );
  }

  // Step 5: Open LanceDB
  const db = await openDatabase(rootDir);
  const table = await openOrCreateChunkTable(db, rootDir, profile.embeddingModel, dim);
  const edgesTable = await openOrCreateEdgesTable(db);

  // Step 6: Crawl source files
  const files = await crawlSourceFiles(rootDir);
  process.stderr.write(`brain-cache: found ${files.length} source files\n`);

  if (files.length === 0) {
    process.stderr.write(`No source files found in ${rootDir}\n`);
    return;
  }

  // Step 6b: Read all files and compute SHA-256 hashes
  const contentMap = new Map<string, string>();
  const currentHashes: Record<string, string> = {};

  for (let groupStart = 0; groupStart < files.length; groupStart += FILE_READ_CONCURRENCY) {
    const group = files.slice(groupStart, groupStart + FILE_READ_CONCURRENCY);
    const results = await Promise.all(
      group.map(async (filePath) => {
        const content = await readFile(filePath, 'utf-8');
        return { filePath, content, hash: hashContent(content) };
      })
    );
    for (const { filePath, content, hash } of results) {
      contentMap.set(filePath, content);
      currentHashes[filePath] = hash;
    }
  }

  // Step 6c: Load stored hashes (skip if force)
  const storedHashes = force ? {} : await readFileHashes(rootDir);
  const crawledSet = new Set(files);

  // Step 6d: Compute diff sets
  const newFiles: string[] = [];
  const changedFiles: string[] = [];
  const removedFiles: string[] = [];
  const unchangedFiles: string[] = [];

  for (const filePath of files) {
    const currentHash = currentHashes[filePath];
    if (!(filePath in storedHashes)) {
      newFiles.push(filePath);
    } else if (storedHashes[filePath] !== currentHash) {
      changedFiles.push(filePath);
    } else {
      unchangedFiles.push(filePath);
    }
  }

  for (const filePath of Object.keys(storedHashes)) {
    if (!crawledSet.has(filePath)) {
      removedFiles.push(filePath);
    }
  }

  // Step 6e: Log incremental stats
  process.stderr.write(
    `brain-cache: incremental index -- ${newFiles.length} new, ${changedFiles.length} changed, ` +
    `${removedFiles.length} removed (${unchangedFiles.length} unchanged)\n`
  );

  // Step 6f: Delete chunks for removed + changed files
  for (const filePath of [...removedFiles, ...changedFiles]) {
    await deleteChunksByFilePath(table, filePath);
    // Also delete edges for this file
    await withWriteLock(async () => {
      const escaped = filePath.replace(/'/g, "''");
      await edgesTable.delete(`from_file = '${escaped}'`);
    });
  }

  // Step 6g: Remove hash entries for removed files
  const updatedHashes = { ...storedHashes };
  for (const filePath of removedFiles) {
    delete updatedHashes[filePath];
  }

  // Step 6h: Filter to only new + changed files for processing
  const filesToProcess = [...newFiles, ...changedFiles];

  // Step 6i: Compute total raw tokens across all files (for savings baseline)
  let allFilesTotalTokens = 0;
  for (const [, content] of contentMap) {
    allFilesTotalTokens += countChunkTokens(content);
  }

  // Step 6j: Nothing to do
  if (filesToProcess.length === 0) {
    process.stderr.write(`brain-cache: nothing to re-index\n`);
    // Write updated manifest (may have removed some entries) and index state
    for (const filePath of files) {
      updatedHashes[filePath] = currentHashes[filePath];
    }
    await writeFileHashes(rootDir, updatedHashes);

    // Update index state with current totals
    const totalFiles = unchangedFiles.length;
    const chunkCount = await table.countRows();
    await writeIndexState(rootDir, {
      version: 1,
      embeddingModel: profile.embeddingModel,
      dimension: dim,
      indexedAt: new Date().toISOString(),
      fileCount: totalFiles,
      chunkCount,
      totalTokens: allFilesTotalTokens,
    });
    process.stderr.write(
      `brain-cache: indexing complete\n` +
      `  Files:        ${totalFiles}\n` +
      `  Chunks:       ${chunkCount}\n` +
      `  Model:        ${profile.embeddingModel}\n` +
      `  Stored in:    ${rootDir}/.brain-cache/\n`
    );
    return;
  }

  // Steps 7+8: Group-based chunk + embed pipeline (PERF-02, DEBT-06)
  let totalRawTokens = 0;
  let totalChunkTokens = 0;
  let totalChunks = 0;
  let processedFiles = 0;
  let processedChunks = 0;
  let skippedChunks = 0;

  for (let groupStart = 0; groupStart < filesToProcess.length; groupStart += FILE_READ_CONCURRENCY) {
    const group = filesToProcess.slice(groupStart, groupStart + FILE_READ_CONCURRENCY);
    const groupChunks: CodeChunk[] = [];
    const groupEdges: CallEdge[] = [];

    for (const filePath of group) {
      const content = contentMap.get(filePath)!;
      totalRawTokens += countChunkTokens(content);
      try {
        const { chunks, edges } = await chunkFile(filePath, content);
        groupChunks.push(...chunks);
        groupEdges.push(...edges);
      } catch (err) {
        log.warn({ filePath, err }, 'Failed to chunk file, skipping');
      }
    }
    processedFiles += group.length;
    totalChunks += groupChunks.length;

    if (processedFiles % 10 === 0 || groupStart + FILE_READ_CONCURRENCY >= filesToProcess.length) {
      process.stderr.write(`brain-cache: chunked ${processedFiles}/${filesToProcess.length} files\n`);
    }

    // Embed and store this group's chunks in DEFAULT_BATCH_SIZE batches
    for (let offset = 0; offset < groupChunks.length; offset += DEFAULT_BATCH_SIZE) {
      const batch = groupChunks.slice(offset, offset + DEFAULT_BATCH_SIZE);

      // Pre-flight: skip chunks that exceed the embedding model's token limit.
      // Sending oversized input causes Ollama to throw "input length exceeds the
      // context length", crashing the entire indexing run.
      // We count tokens with the Anthropic tokenizer. nomic-embed-text runs on
      // llama.cpp with a BERT tokenizer that produces ~1.4x more tokens for code,
      // so EMBED_MAX_TOKENS is set conservatively (1400 Anthropic ≈ 1960 BERT < 2048
      // real context limit). truncate: true in ollama.embed() is a hard safety net.
      const embeddableBatch = batch.filter((chunk) => {
        const tokens = countChunkTokens(chunk.content);
        if (tokens > EMBED_MAX_TOKENS) {
          skippedChunks++;
          return false;
        }
        return true;
      });

      if (embeddableBatch.length === 0) continue;

      const texts = embeddableBatch.map((chunk) => chunk.content);
      totalChunkTokens += texts.reduce((sum, t) => sum + countChunkTokens(t), 0);
      const { embeddings: vectors, skipped, zeroVectorIndices } = await embedBatchWithRetry(profile.embeddingModel, texts, dim);
      skippedChunks += skipped;

      if (zeroVectorIndices.size > 0) {
        log.warn({ count: zeroVectorIndices.size }, 'Skipping zero-vector chunks (content too large to embed)');
      }

      // Build rows, skipping any chunk whose embedding fell back to a zero vector.
      // vectors[i] corresponds to embeddableBatch[i] — zeroVectorIndices tracks which are zero.
      const rows: ChunkRow[] = embeddableBatch
        .map((chunk, i) => ({ chunk, i }))
        .filter(({ i }) => !zeroVectorIndices.has(i))
        .map(({ chunk, i }) => ({
          id: chunk.id,
          file_path: chunk.filePath,
          chunk_type: chunk.chunkType,
          scope: chunk.scope,
          name: chunk.name,
          content: chunk.content,
          start_line: chunk.startLine,
          end_line: chunk.endLine,
          file_type: classifyFileType(chunk.filePath),
          vector: vectors[i],
        }));

      await insertChunks(table, rows);
      processedChunks += batch.length;
      process.stderr.write(
        `brain-cache: embedding ${processedChunks}/${totalChunks} chunks (${Math.round((processedChunks / totalChunks) * 100)}%)\n`
      );
    }

    // Insert call/import edges for this group
    if (groupEdges.length > 0) {
      await insertEdges(edgesTable, groupEdges);
    }
  }
  if (skippedChunks > 0) {
    process.stderr.write(`brain-cache: ${skippedChunks} chunks skipped (too large for model context)\n`);
  }
  process.stderr.write(
    `brain-cache: ${totalChunks} chunks from ${filesToProcess.length} files\n`
  );

  // Log edge stats
  const edgeCount = await edgesTable.countRows();
  if (edgeCount === 0) {
    process.stderr.write(`brain-cache: no call edges extracted — check source files\n`);
  } else {
    process.stderr.write(`brain-cache: ${edgeCount} call/import edges stored\n`);
  }

  // Step 8b: Create vector index if table is large enough
  await createVectorIndexIfNeeded(table, profile.embeddingModel);

  // Step 9a: Merge new/changed hashes into manifest
  for (const filePath of filesToProcess) {
    updatedHashes[filePath] = currentHashes[filePath];
  }
  // Also ensure unchanged files stay in manifest
  for (const filePath of unchangedFiles) {
    updatedHashes[filePath] = currentHashes[filePath];
  }
  await writeFileHashes(rootDir, updatedHashes);

  // Step 9b: Write index state
  const totalFiles = files.length;
  const chunkCount = await table.countRows();
  await writeIndexState(rootDir, {
    version: 1,
    embeddingModel: profile.embeddingModel,
    dimension: dim,
    indexedAt: new Date().toISOString(),
    fileCount: totalFiles,
    chunkCount,
    totalTokens: allFilesTotalTokens,
  });

  // Step 10: Print summary with token savings stats
  const reductionPct = totalRawTokens > 0
    ? Math.round((1 - totalChunkTokens / totalRawTokens) * 100)
    : 0;

  const savingsBlock = formatTokenSavings({
    tokensSent: totalChunkTokens,
    estimatedWithout: totalRawTokens,
    reductionPct,
    filesInContext: totalFiles,
  }).split('\n').map(line => `  ${line}`).join('\n');

  process.stderr.write(
    `brain-cache: indexing complete\n` +
    `  Files:                     ${totalFiles}\n` +
    `  Chunks:                    ${totalChunks}\n` +
    `  Model:                     ${profile.embeddingModel}\n` +
    `${savingsBlock}\n` +
    `  Stored in:                 ${rootDir}/.brain-cache/\n`
  );
  } finally {
    // Restore pino log level and stderr write
    setLogLevel(previousLogLevel as Parameters<typeof setLogLevel>[0]);
    process.stderr.write = originalStderrWrite;
    await releaseIndexLock(rootDir);
  }
}
