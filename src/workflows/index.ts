import { resolve } from 'node:path';
import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import type { Table } from '@lancedb/lancedb';
import { requireProfile, requireOllama } from '../lib/guards.js';
import { crawlSourceFiles } from '../services/crawler.js';
import { chunkFile } from '../services/chunker.js';
import { embedBatchWithRetry } from '../services/embedder.js';
import { acquireIndexLock, releaseIndexLock } from '../services/indexLock.js';
import { childLogger, setLogLevel } from '../services/logger.js';

const log = childLogger('index');
import {
  getConnection,
  openOrCreateChunkTable,
  insertChunks,
  createVectorIndexIfNeeded,
  writeIndexState,
  readFileHashes,
  writeFileHashes,
  deleteChunksByFilePaths,
  openOrCreateEdgesTable,
  insertEdges,
  withWriteLock,
  classifyFileType,
  type ChunkRow,
} from '../services/lancedb.js';
import { EMBEDDING_DIMENSIONS, DEFAULT_EMBEDDING_DIMENSION, DEFAULT_BATCH_SIZE, FILE_READ_CONCURRENCY, EMBED_MAX_TOKENS } from '../lib/config.js';
import { countChunkTokens } from '../services/tokenCounter.js';
import type { CodeChunk, CallEdge, FileStatEntry } from '../lib/types.js';
import { formatTokenSavings } from '../lib/format.js';

/**
 * Compute a SHA-256 hex digest of file content.
 */
function hashContent(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

/**
 * Stat all files concurrently with capped concurrency (same batch size as readFile loop).
 * Returns a Map from file path to { size, mtimeMs }.
 * Failures are silently omitted — partitionByStatChange treats missing entries as changed.
 */
async function statAllFiles(
  files: string[],
  concurrency: number,
): Promise<Map<string, { size: number; mtimeMs: number }>> {
  const result = new Map<string, { size: number; mtimeMs: number }>();
  for (let groupStart = 0; groupStart < files.length; groupStart += concurrency) {
    const group = files.slice(groupStart, groupStart + concurrency);
    const entries = await Promise.all(
      group.map(async (filePath) => {
        try {
          const s = await stat(filePath);
          return { filePath, size: s.size, mtimeMs: s.mtimeMs };
        } catch {
          return null;
        }
      })
    );
    for (const entry of entries) {
      if (entry !== null) {
        result.set(entry.filePath, { size: entry.size, mtimeMs: entry.mtimeMs });
      }
    }
  }
  return result;
}

/**
 * Partitions files into those whose stat fingerprint (size + mtimeMs) matches the stored
 * manifest and those that differ or are new.
 *
 * Files missing from either `currentStats` or `storedStats` are classified as statChanged.
 * This is exported for unit testing and for callers that need access to the partition sets.
 */
export function partitionByStatChange(
  files: string[],
  currentStats: ReadonlyMap<string, { size: number; mtimeMs: number }>,
  storedStats: Record<string, FileStatEntry>,
): { statUnchanged: string[]; statChanged: string[] } {
  const statUnchanged: string[] = [];
  const statChanged: string[] = [];
  for (const f of files) {
    const cur = currentStats.get(f);
    const stored = storedStats[f];
    if (
      cur !== undefined &&
      stored !== undefined &&
      cur.size === stored.size &&
      cur.mtimeMs === stored.mtimeMs
    ) {
      statUnchanged.push(f);
    } else {
      statChanged.push(f);
    }
  }
  return { statUnchanged, statChanged };
}

export interface FileDiffResult {
  newFiles: string[];
  changedFiles: string[];
  removedFiles: string[];
  unchangedFiles: string[];
}

/**
 * Classifies crawled files against stored hashes into new / changed / removed / unchanged sets.
 */
export function computeFileDiffs(
  files: string[],
  currentHashes: Record<string, string>,
  storedHashes: Record<string, string>,
): FileDiffResult {
  const newFiles: string[] = [];
  const changedFiles: string[] = [];
  const removedFiles: string[] = [];
  const unchangedFiles: string[] = [];
  const crawledSet = new Set(files);

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

  return { newFiles, changedFiles, removedFiles, unchangedFiles };
}

/** Mutable stats for the chunk+embed pipeline (REFAC-01). */
export interface IndexGroupStats {
  totalRawTokens: number;
  totalChunkTokens: number;
  totalChunks: number;
  processedFiles: number;
  processedChunks: number;
  skippedChunks: number;
}

/**
 * Chunks a batch of files, embeds in DEFAULT_BATCH_SIZE batches, inserts rows and edges.
 */
export async function processFileGroup(
  group: string[],
  contentMap: Map<string, string>,
  table: Table,
  edgesTable: Table,
  profile: { embeddingModel: string },
  dim: number,
  stats: IndexGroupStats,
  tokenCounts: Record<string, number>,
  filesToProcessLength: number,
): Promise<void> {
  const groupChunks: CodeChunk[] = [];
  const groupEdges: CallEdge[] = [];

  for (const filePath of group) {
    const content = contentMap.get(filePath)!;
    const rawTokens = countChunkTokens(content);
    stats.totalRawTokens += rawTokens;
    tokenCounts[filePath] = rawTokens;
    try {
      const { chunks, edges } = await chunkFile(filePath, content);
      groupChunks.push(...chunks);
      groupEdges.push(...edges);
    } catch (err) {
      log.warn({ filePath, err }, 'Failed to chunk file, skipping');
    }
  }
  stats.processedFiles += group.length;
  stats.totalChunks += groupChunks.length;

  if (stats.processedFiles % 10 === 0 || stats.processedFiles === filesToProcessLength) {
    process.stderr.write(`brain-cache: chunked ${stats.processedFiles}/${filesToProcessLength} files\n`);
  }

  for (let offset = 0; offset < groupChunks.length; offset += DEFAULT_BATCH_SIZE) {
    const batch = groupChunks.slice(offset, offset + DEFAULT_BATCH_SIZE);

    const embeddableBatch: Array<{ chunk: CodeChunk; tokens: number }> = [];
    for (const chunk of batch) {
      const tokens = countChunkTokens(chunk.content);
      if (tokens > EMBED_MAX_TOKENS) {
        stats.skippedChunks++;
        continue;
      }
      embeddableBatch.push({ chunk, tokens });
    }

    if (embeddableBatch.length === 0) continue;

    const texts = embeddableBatch.map(({ chunk }) => chunk.content);
    stats.totalChunkTokens += embeddableBatch.reduce((sum, { tokens }) => sum + tokens, 0);
    const { embeddings: vectors, skipped, zeroVectorIndices } = await embedBatchWithRetry(profile.embeddingModel, texts, dim);
    stats.skippedChunks += skipped;

    if (zeroVectorIndices.size > 0) {
      log.warn({ count: zeroVectorIndices.size }, 'Skipping zero-vector chunks (content too large to embed)');
    }

    const rows: ChunkRow[] = embeddableBatch
      .map(({ chunk }, i) => ({ chunk, i }))
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
    stats.processedChunks += batch.length;
    process.stderr.write(
      `brain-cache: embedding ${stats.processedChunks}/${stats.totalChunks} chunks (${Math.round((stats.processedChunks / stats.totalChunks) * 100)}%)\n`,
    );
  }

  if (groupEdges.length > 0) {
    await insertEdges(edgesTable, groupEdges);
  }
}

export function printSummary(params: {
  totalFiles: number;
  totalChunks: number;
  embeddingModel: string;
  totalChunkTokens: number;
  totalRawTokens: number;
  rootDir: string;
}): void {
  const { totalFiles, totalChunks, embeddingModel, totalChunkTokens, totalRawTokens, rootDir } = params;
  const reductionPct = totalRawTokens > 0
    ? Math.round((1 - totalChunkTokens / totalRawTokens) * 100)
    : 0;

  const savingsBlock = formatTokenSavings({
    tokensSent: totalChunkTokens,
    estimatedWithout: totalRawTokens,
    reductionPct,
    filesInContext: totalFiles,
    indexEmbeddingMode: true,
  }).split('\n').map(line => `  ${line}`).join('\n');

  process.stderr.write(
    `brain-cache: indexing complete\n` +
    `  Files:                     ${totalFiles}\n` +
    `  Chunks:                    ${totalChunks}\n` +
    `  Model:                     ${embeddingModel}\n` +
    `${savingsBlock}\n` +
    `  Stored in:                 ${rootDir}/.brain-cache/\n`,
  );
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

  // Suppress LanceDB Rust-layer log lines that write directly to stderr via the
  // native NAPI bindings. LanceDB's TypeScript SDK has no log level configuration
  // API -- this monkey-patch is the only available suppression mechanism.
  //
  // Pattern matched: ISO-8601 timestamp prefix followed by "WARN lance" or "INFO lance"
  // (e.g. "[2024-01-15T10:30:00Z WARN lance::dataset] ...")
  // Only these two known patterns are suppressed -- other stderr writes pass through.
  // DEBT-05: tighten regex to avoid swallowing unrelated warnings.
  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((
    chunk: string | Uint8Array,
    encodingOrCb?: BufferEncoding | ((err?: Error | null) => void),
    cb?: (err?: Error | null) => void,
  ): boolean => {
    const str = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8');
    if (/^\[\d{4}-\d{2}-\d{2}T[\d:.]+Z (WARN|INFO) lance/.test(str)) {
      const callback = typeof encodingOrCb === 'function' ? encodingOrCb : cb;
      callback?.(null);
      return true;
    }
    if (typeof encodingOrCb === 'function') {
      return originalStderrWrite(chunk as string, encodingOrCb);
    }
    return originalStderrWrite(chunk as string, encodingOrCb as BufferEncoding, cb);
  }) as typeof process.stderr.write;

  // Step 1: Resolve path (before try so lock can be acquired and released)
  const rootDir = resolve(targetPath ?? '.');
  await acquireIndexLock(rootDir);

  try {
  // Step 2: Read profile and check Ollama
  const profile = await requireProfile();
  await requireOllama();

  // Step 3: Determine dimensions
  const dim = EMBEDDING_DIMENSIONS[profile.embeddingModel] ?? DEFAULT_EMBEDDING_DIMENSION;
  if (!(profile.embeddingModel in EMBEDDING_DIMENSIONS)) {
    process.stderr.write(
      `Warning: Unknown embedding model '${profile.embeddingModel}', defaulting to ${DEFAULT_EMBEDDING_DIMENSION} dimensions.\n`
    );
  }

  // Step 5: Open LanceDB
  const db = await getConnection(rootDir, force);
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
  const { hashes: storedHashes, tokenCounts: existingTokenCounts, stats: existingStats } = force
    ? { hashes: {} as Record<string, string>, tokenCounts: {} as Record<string, number>, stats: {} as Record<string, import('../lib/types.js').FileStatEntry> }
    : await readFileHashes(rootDir);

  const { newFiles, changedFiles, removedFiles, unchangedFiles } = computeFileDiffs(files, currentHashes, storedHashes);

  // Step 6e: Log incremental stats
  process.stderr.write(
    `brain-cache: incremental index -- ${newFiles.length} new, ${changedFiles.length} changed, ` +
    `${removedFiles.length} removed (${unchangedFiles.length} unchanged)\n`
  );

  // Step 6f: Delete chunks for removed + changed files (batch — PERF-02)
  const filesToDelete = [...removedFiles, ...changedFiles];
  if (filesToDelete.length > 0) {
    await deleteChunksByFilePaths(table, filesToDelete);
    // Batch edge deletion with single IN predicate
    await withWriteLock(async () => {
      const escaped = filesToDelete.map(p => `'${p.replace(/'/g, "''")}'`).join(', ');
      await edgesTable.delete(`from_file IN (${escaped})`);
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
    await writeFileHashes(rootDir, { hashes: updatedHashes, tokenCounts: existingTokenCounts, stats: existingStats });

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
  const stats: IndexGroupStats = {
    totalRawTokens: 0,
    totalChunkTokens: 0,
    totalChunks: 0,
    processedFiles: 0,
    processedChunks: 0,
    skippedChunks: 0,
  };
  const tokenCounts: Record<string, number> = {};

  for (let groupStart = 0; groupStart < filesToProcess.length; groupStart += FILE_READ_CONCURRENCY) {
    const group = filesToProcess.slice(groupStart, groupStart + FILE_READ_CONCURRENCY);
    await processFileGroup(
      group,
      contentMap,
      table,
      edgesTable,
      profile,
      dim,
      stats,
      tokenCounts,
      filesToProcess.length,
    );
  }
  if (stats.skippedChunks > 0) {
    process.stderr.write(`brain-cache: ${stats.skippedChunks} chunks skipped (too large for model context)\n`);
  }
  process.stderr.write(
    `brain-cache: ${stats.totalChunks} chunks from ${filesToProcess.length} files\n`
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
  // Carry forward token counts for unchanged files (PERF-03)
  for (const [fp, count] of Object.entries(existingTokenCounts)) {
    if (!(fp in tokenCounts) && fp in updatedHashes) {
      tokenCounts[fp] = count;
    }
  }
  await writeFileHashes(rootDir, { hashes: updatedHashes, tokenCounts, stats: existingStats });

  // Step 9b: Write index state
  const totalFiles = files.length;
  await writeIndexState(rootDir, {
    version: 1,
    embeddingModel: profile.embeddingModel,
    dimension: dim,
    indexedAt: new Date().toISOString(),
    fileCount: totalFiles,
    chunkCount: await table.countRows(),
    totalTokens: allFilesTotalTokens,
  });

  printSummary({
    totalFiles,
    totalChunks: stats.totalChunks,
    embeddingModel: profile.embeddingModel,
    totalChunkTokens: stats.totalChunkTokens,
    totalRawTokens: stats.totalRawTokens,
    rootDir,
  });
  } finally {
    // Restore pino log level and stderr write
    setLogLevel(previousLogLevel as Parameters<typeof setLogLevel>[0]);
    process.stderr.write = originalStderrWrite;
    await releaseIndexLock(rootDir);
  }
}
