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
 * 6. Stat all files; partition by changed fingerprint; read+hash only those needing read
 * 7. Delete chunks for removed + changed files
 * 8. Chunk, embed, and store new + changed files only
 * 9. Write updated hash manifest (with stats) and index state
 *
 * All output goes to stderr — zero stdout output (per D-16).
 *
 * **Incremental modes (D-48-05):**
 * - *(default)*: stat fast-path skips readFile+hash for files with matching size+mtime in manifest.
 * - `opts.verify`: bypass stat cache — re-read and re-hash all files; still incremental embeds
 *   (unchanged content hashes equal → no chunk/embed work). Use when stat cache may be stale.
 * - `opts.force`: full reindex — ignore manifest entirely, drop and rebuild tables.
 *   **`force` wins over `verify`**: if both are true, `verify` is ignored.
 *
 * @param targetPath - Directory to index (defaults to current directory)
 * @param opts.force - If true, ignore stored hashes and perform full reindex
 * @param opts.verify - If true (and force is false), re-read all files bypassing stat cache
 */
export async function runIndex(targetPath?: string, opts?: { force?: boolean; verify?: boolean }): Promise<void> {
  const force = opts?.force ?? false;
  // D-48-05: --force wins over --verify
  const verifyEffective = (opts?.verify ?? false) && !force;

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

  // Step 6b: Stat all files (needed to determine which files changed fingerprint)
  const currentStats = await statAllFiles(files, FILE_READ_CONCURRENCY);

  // Step 6c: Load stored manifest (skip if force — empty baseline for full reindex)
  const { hashes: storedHashes, tokenCounts: existingTokenCounts, stats: storedStats } = force
    ? { hashes: {} as Record<string, string>, tokenCounts: {} as Record<string, number>, stats: {} as Record<string, FileStatEntry> }
    : await readFileHashes(rootDir);

  // Step 6d: Determine which files need full read+hash
  // - force or verifyEffective: read everything
  // - else: stat-changed files + new files (no stored hash) + token backfill files (D-48-06)
  let filesNeedingRead: string[];
  if (force || verifyEffective) {
    filesNeedingRead = files;
  } else {
    const { statChanged } = partitionByStatChange(files, currentStats, storedStats);
    const statChangedSet = new Set(statChanged);
    filesNeedingRead = files.filter(
      (fp) =>
        statChangedSet.has(fp) ||
        !(fp in storedHashes) ||
        existingTokenCounts[fp] === undefined, // D-48-06: backfill missing tokenCounts
    );
  }

  // Step 6e: Read file bytes and compute hashes only for filesNeedingRead
  const contentMap = new Map<string, string>();
  const freshHashes: Record<string, string> = {};

  for (let groupStart = 0; groupStart < filesNeedingRead.length; groupStart += FILE_READ_CONCURRENCY) {
    const group = filesNeedingRead.slice(groupStart, groupStart + FILE_READ_CONCURRENCY);
    const results = await Promise.all(
      group.map(async (filePath) => {
        const content = await readFile(filePath, 'utf-8');
        return { filePath, content, hash: hashContent(content) };
      })
    );
    for (const { filePath, content, hash } of results) {
      contentMap.set(filePath, content);
      freshHashes[filePath] = hash;
    }
  }

  // Step 6f: Build currentHashes — fresh for read files, stored for stat-skipped
  const currentHashes: Record<string, string> = {};
  for (const fp of files) {
    if (fp in freshHashes) {
      currentHashes[fp] = freshHashes[fp];
    } else if (fp in storedHashes) {
      currentHashes[fp] = storedHashes[fp];
    }
    // Files that have no hash (shouldn't happen — filesNeedingRead includes no-hash files) are omitted
  }

  const { newFiles, changedFiles, removedFiles, unchangedFiles } = computeFileDiffs(files, currentHashes, storedHashes);

  // Step 6g: Log incremental stats
  process.stderr.write(
    `brain-cache: incremental index -- ${newFiles.length} new, ${changedFiles.length} changed, ` +
    `${removedFiles.length} removed (${unchangedFiles.length} unchanged)\n`
  );

  // Step 6h: Delete chunks for removed + changed files (batch — PERF-02)
  const filesToDelete = [...removedFiles, ...changedFiles];
  if (filesToDelete.length > 0) {
    await deleteChunksByFilePaths(table, filesToDelete);
    // Batch edge deletion with single IN predicate
    await withWriteLock(async () => {
      const escaped = filesToDelete.map(p => `'${p.replace(/'/g, "''")}'`).join(', ');
      await edgesTable.delete(`from_file IN (${escaped})`);
    });
  }

  // Step 6i: Remove hash entries for removed files
  const updatedHashes = { ...storedHashes };
  for (const filePath of removedFiles) {
    delete updatedHashes[filePath];
  }

  // Step 6j: Filter to only new + changed files for processing
  const filesToProcess = [...newFiles, ...changedFiles];

  // Build merged stats for all currently crawled files (from currentStats, for manifest write)
  const mergedStats: Record<string, FileStatEntry> = {};
  for (const fp of files) {
    const s = currentStats.get(fp);
    if (s !== undefined) {
      mergedStats[fp] = { size: s.size, mtimeMs: s.mtimeMs };
    }
  }

  // Build outTokenCounts: fresh counts for read files, carried forward for stat-skipped (PERF-03 + D-48-06)
  const outTokenCounts: Record<string, number> = {};
  // Carry forward from manifest for all files first
  for (const fp of files) {
    if (existingTokenCounts[fp] !== undefined) {
      outTokenCounts[fp] = existingTokenCounts[fp];
    }
  }
  // processFileGroup will overwrite counts for files it processes (via tokenCounts arg below)

  // Compute total tokens for index state — uses outTokenCounts (filled after processFileGroup below)
  // We compute this after the process loop to capture both fresh and carried-forward counts.

  // Step 6k: Nothing to do
  if (filesToProcess.length === 0) {
    process.stderr.write(`brain-cache: nothing to re-index\n`);
    // Write updated manifest (may have removed some entries) and index state
    for (const filePath of files) {
      updatedHashes[filePath] = currentHashes[filePath];
    }
    await writeFileHashes(rootDir, { hashes: updatedHashes, tokenCounts: outTokenCounts, stats: mergedStats });

    // allFilesTotalTokens = sum of outTokenCounts for all crawled files
    let allFilesTotalTokens = 0;
    for (const fp of files) {
      allFilesTotalTokens += outTokenCounts[fp] ?? 0;
    }

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
  const pipelineStats: IndexGroupStats = {
    totalRawTokens: 0,
    totalChunkTokens: 0,
    totalChunks: 0,
    processedFiles: 0,
    processedChunks: 0,
    skippedChunks: 0,
  };
  // processedTokenCounts: token counts for files read this run (new + changed)
  // processFileGroup writes into this; it overwrites outTokenCounts carried-forward entries
  const processedTokenCounts: Record<string, number> = {};

  for (let groupStart = 0; groupStart < filesToProcess.length; groupStart += FILE_READ_CONCURRENCY) {
    const group = filesToProcess.slice(groupStart, groupStart + FILE_READ_CONCURRENCY);
    await processFileGroup(
      group,
      contentMap,
      table,
      edgesTable,
      profile,
      dim,
      pipelineStats,
      processedTokenCounts,
      filesToProcess.length,
    );
  }
  if (pipelineStats.skippedChunks > 0) {
    process.stderr.write(`brain-cache: ${pipelineStats.skippedChunks} chunks skipped (too large for model context)\n`);
  }
  process.stderr.write(
    `brain-cache: ${pipelineStats.totalChunks} chunks from ${filesToProcess.length} files\n`
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

  // Merge token counts: fresh counts from processFileGroup override carried-forward
  for (const [fp, count] of Object.entries(processedTokenCounts)) {
    outTokenCounts[fp] = count;
  }

  // allFilesTotalTokens = sum of outTokenCounts for all crawled files
  let allFilesTotalTokens = 0;
  for (const fp of files) {
    allFilesTotalTokens += outTokenCounts[fp] ?? 0;
  }

  await writeFileHashes(rootDir, { hashes: updatedHashes, tokenCounts: outTokenCounts, stats: mergedStats });

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
    totalChunks: pipelineStats.totalChunks,
    embeddingModel: profile.embeddingModel,
    totalChunkTokens: pipelineStats.totalChunkTokens,
    totalRawTokens: pipelineStats.totalRawTokens,
    rootDir,
  });
  } finally {
    // Restore pino log level and stderr write
    setLogLevel(previousLogLevel as Parameters<typeof setLogLevel>[0]);
    process.stderr.write = originalStderrWrite;
    await releaseIndexLock(rootDir);
  }
}
