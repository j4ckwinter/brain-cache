import * as lancedb from '@lancedb/lancedb';
import { Index } from '@lancedb/lancedb';
import { Schema, Field, Utf8, Int32, Float32, FixedSizeList } from 'apache-arrow';
import { join } from 'node:path';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { PROJECT_DATA_DIR, VECTOR_INDEX_THRESHOLD, EMBEDDING_DIMENSIONS, DEFAULT_EMBEDDING_DIMENSION, FILE_HASHES_FILENAME, CONNECTION_POOL_TTL_MS } from '../lib/config.js';
import { childLogger } from './logger.js';
import type { CodeChunk, IndexState, CallEdge, FileStatEntry } from '../lib/types.js';
import { IndexStateSchema } from '../lib/types.js';

const log = childLogger('lancedb');

export type FileType = 'test' | 'source';

/**
 * Classifies a file path as 'test' or 'source' based on filename patterns.
 * Test patterns: *.test.{ts,tsx,js,jsx}, *.spec.{ts,tsx,js,jsx}, __tests__/ directory.
 */
export function classifyFileType(filePath: string): FileType {
  const normalized = filePath.replace(/\\/g, '/');
  const fileName = normalized.split('/').pop() ?? '';
  if (/\.(test|spec)\.[tj]sx?$/.test(fileName)) return 'test';
  if (normalized.includes('/__tests__/')) return 'test';
  return 'source';
}

// --- Write mutex ---

let _writeMutex: Promise<void> = Promise.resolve();

/**
 * Serializes concurrent write operations within the same Node.js process.
 * Prevents LanceDB table corruption when multiple index operations run concurrently.
 * Always advances the mutex chain, even on error — prevents deadlock.
 */
export function withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = _writeMutex.then(() => fn());
  // Always advance mutex regardless of success/failure to prevent deadlock
  _writeMutex = next.then(() => undefined, () => undefined);
  return next;
}

/**
 * Builds the Apache Arrow schema for the chunks table.
 * The vector column is FixedSizeList<Float32> with the given dimension
 * (768 for nomic-embed-text, 1024 for mxbai-embed-large).
 */
export function chunkSchema(dim: number): Schema {
  return new Schema([
    new Field('id',         new Utf8(),  false),
    new Field('file_path',  new Utf8(),  false),
    new Field('chunk_type', new Utf8(),  false),
    new Field('scope',      new Utf8(),  true),
    new Field('name',       new Utf8(),  true),
    new Field('content',    new Utf8(),  false),
    new Field('start_line', new Int32(), false),
    new Field('end_line',   new Int32(), false),
    new Field('file_type',  new Utf8(),  false),
    new Field('source_kind', new Utf8(), false),
    new Field('vector',
      new FixedSizeList(dim, new Field('item', new Float32(), true)),
      false
    ),
  ]);
}

/**
 * Builds the Apache Arrow schema for the edges table.
 * No vector column — this is a plain relational table queried via SQL predicates.
 */
export function edgeSchema(): Schema {
  return new Schema([
    new Field('from_chunk_id', new Utf8(), false),
    new Field('from_file',     new Utf8(), false),
    new Field('from_symbol',   new Utf8(), true),
    new Field('to_symbol',     new Utf8(), false),
    new Field('to_file',       new Utf8(), true),
    new Field('edge_type',     new Utf8(), false),
  ]);
}

// --- Connection pool (PERF-01) ---
// Caches Connection only — NEVER cache Table handles.
// Stale Table handles after --force reindex cause silent wrong-data bugs.
interface PoolEntry {
  connection: lancedb.Connection;
  createdAt: number;
}

const _connectionPool = new Map<string, PoolEntry>();

/**
 * Injects a connection entry into the pool at the given key.
 * FOR TESTING ONLY — allows unit tests to inject mock connections without real disk I/O.
 */
export function _setPoolEntryForTest(
  projectRoot: string,
  connection: lancedb.Connection,
  createdAt: number
): void {
  _connectionPool.set(projectRoot, { connection, createdAt });
}

/**
 * Returns a cached LanceDB connection for the given project root.
 * Opens a new connection if none is cached.
 * Pass force=true to evict the cached connection (used after --force reindex).
 *
 * PERF-01: One Connection per project directory, reused across operations.
 * D-03: Keys by project path only. D-04: Evicts on force flag.
 * DEBT-04: TTL eviction (30min) and isOpen() health validation prevent stale connections.
 */
export async function getConnection(
  projectRoot: string,
  force?: boolean
): Promise<lancedb.Connection> {
  if (force) {
    const entry = _connectionPool.get(projectRoot);
    if (entry) {
      if (entry.connection.isOpen()) entry.connection.close();
      _connectionPool.delete(projectRoot);
    }
  }

  const existing = _connectionPool.get(projectRoot);
  if (existing) {
    const expired = Date.now() - existing.createdAt > CONNECTION_POOL_TTL_MS;
    const healthy = existing.connection.isOpen();
    if (!expired && healthy) {
      return existing.connection;
    }
    // Evict stale or unhealthy connection
    if (healthy) existing.connection.close();
    _connectionPool.delete(projectRoot);
  }

  const connection = await openDatabase(projectRoot);
  _connectionPool.set(projectRoot, { connection, createdAt: Date.now() });
  return connection;
}

/**
 * Opens a LanceDB connection at <projectRoot>/.brain-cache/index.
 * Creates the .brain-cache directory if it does not exist.
 */
export async function openDatabase(projectRoot: string): Promise<lancedb.Connection> {
  const dataDir = join(projectRoot, PROJECT_DATA_DIR);
  await mkdir(dataDir, { recursive: true });
  const dbPath = join(dataDir, 'index');
  return lancedb.connect(dbPath);
}

/**
 * Shape of a row stored in the LanceDB chunks table.
 * Field names use snake_case to match the Arrow schema column names.
 */
export interface ChunkRow {
  id: string;
  file_path: string;
  chunk_type: string;
  scope: string | null;
  name: string | null;
  content: string;
  start_line: number;
  end_line: number;
  file_type: string;
  source_kind: 'file' | 'history';
  vector: number[];
  /** Index signature required by LanceDB's Data type (Record<string, unknown>[]). */
  [key: string]: unknown;
}

export async function migrateSourceKindColumn(table: lancedb.Table): Promise<void> {
  const tableSchema = await table.schema();
  const hasSourceKind = tableSchema.fields.some(
    (f: { name: string }) => f.name === 'source_kind',
  );
  if (hasSourceKind) return;
  await table.addColumns([{ name: 'source_kind', valueSql: "'file'" }]);
}

/**
 * Shape of a row stored in the LanceDB edges table.
 * Field names use snake_case to match the Arrow schema column names.
 */
export interface EdgeRow {
  from_chunk_id: string;
  from_file: string;
  from_symbol: string | null;
  to_symbol: string;
  to_file: string | null;
  edge_type: 'call' | 'import';
  /** Index signature required by LanceDB's Data type (Record<string, unknown>[]). */
  [key: string]: unknown;
}

/**
 * Opens the 'chunks' table if it already exists and its index state matches
 * the requested model and dimension. If the model or dimension has changed,
 * the old table is dropped and a fresh one is created.
 * If the table does not yet exist, it is created with an explicit Arrow schema.
 *
 * @param db          - LanceDB connection (opened via openDatabase)
 * @param projectRoot - Absolute path to the indexed project root (needed to read index_state.json)
 * @param model       - Embedding model name (e.g. 'nomic-embed-text')
 * @param dim         - Embedding dimension (768 or 1024)
 */
export async function openOrCreateChunkTable(
  db: lancedb.Connection,
  projectRoot: string,
  model: string,
  dim: number
): Promise<lancedb.Table> {
  const tableNames = await db.tableNames();

  if (tableNames.includes('chunks')) {
    const state = await readIndexState(projectRoot);
    const mismatch =
      state === null ||
      state.embeddingModel !== model ||
      state.dimension !== dim;

    if (mismatch) {
      log.warn(
        { storedModel: state?.embeddingModel, storedDim: state?.dimension, model, dim },
        'Embedding model or dimension changed — dropping and recreating chunks table'
      );
      await db.dropTable('chunks');
      if (tableNames.includes('edges')) {
        await db.dropTable('edges');
        log.warn('Also dropped edges table (stale chunk IDs)');
      }
    } else {
      const existingTable = await db.openTable('chunks');
      const tableSchema = await existingTable.schema();
      const hasFileType = tableSchema.fields.some(
        (f: { name: string }) => f.name === 'file_type'
      );
      const hasSourceKind = tableSchema.fields.some(
        (f: { name: string }) => f.name === 'source_kind'
      );
      if (!hasFileType) {
        log.warn('Schema missing file_type column — dropping and recreating chunks table');
        await db.dropTable('chunks');
        if (tableNames.includes('edges')) {
          await db.dropTable('edges');
          log.warn('Also dropped edges table (stale chunk IDs)');
        }
      } else {
        if (!hasSourceKind) {
          await migrateSourceKindColumn(existingTable);
          const refreshed = await db.openTable('chunks');
          log.info({ model, dim }, 'Opened existing chunks table after source_kind migration');
          return refreshed;
        }
        log.info({ model, dim }, 'Opened existing chunks table');
        return existingTable;
      }
    }
  }

  // Create new table with explicit Arrow schema
  const schema = chunkSchema(dim);
  const emptyData = lancedb.makeArrowTable([], { schema });
  const table = await db.createTable('chunks', emptyData, { mode: 'overwrite' });
  log.info({ model, dim }, 'Created new chunks table');
  return table;
}

/**
 * Inserts a batch of chunk rows into the LanceDB table.
 * No-ops if rows is empty.
 */
export async function insertChunks(table: lancedb.Table, rows: ChunkRow[]): Promise<void> {
  if (rows.length === 0) {
    return;
  }
  await withWriteLock(async () => {
    await table.add(rows);
    log.debug({ count: rows.length }, 'Inserted chunk rows');
  });
}

/**
 * Creates an IVF-PQ vector index on the chunks table if:
 * - The table has at least VECTOR_INDEX_THRESHOLD rows, AND
 * - No vector index already exists.
 *
 * IVF-PQ parameters are derived from the embedding model dimension:
 * - numPartitions: 256 (good for 10k+ rows)
 * - numSubVectors: dim / 8 (768→96, 1024→128)
 *
 * This should be called once after all chunks have been inserted.
 */
export async function createVectorIndexIfNeeded(
  table: lancedb.Table,
  embeddingModel: string,
): Promise<void> {
  const rowCount = await table.countRows();

  if (rowCount < VECTOR_INDEX_THRESHOLD) {
    log.debug(
      { rowCount, threshold: VECTOR_INDEX_THRESHOLD },
      'Row count below threshold — skipping IVF-PQ index creation'
    );
    return;
  }

  // Check if a vector index already exists
  const indices = await table.listIndices();
  const hasVectorIndex = indices.some(
    (idx) => idx.columns.includes('vector')
  );

  if (hasVectorIndex) {
    log.debug('IVF-PQ index already exists — skipping creation');
    return;
  }

  // Derive numSubVectors from embedding dimension
  const dim = EMBEDDING_DIMENSIONS[embeddingModel] ?? DEFAULT_EMBEDDING_DIMENSION;
  const numSubVectors = Math.floor(dim / 8);

  log.info(
    { rowCount, numPartitions: 256, numSubVectors },
    'Creating IVF-PQ vector index'
  );

  await table.createIndex('vector', {
    config: Index.ivfPq({ numPartitions: 256, numSubVectors }),
  });

  log.info('IVF-PQ vector index created successfully');
}

/**
 * Reads and validates the index state JSON file from
 * <projectRoot>/.brain-cache/index_state.json.
 * Returns null if the file is missing or invalid.
 */
export async function readIndexState(projectRoot: string): Promise<IndexState | null> {
  const statePath = join(projectRoot, PROJECT_DATA_DIR, 'index_state.json');
  try {
    const raw = await readFile(statePath, 'utf-8');
    const parsed = IndexStateSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Writes the index state to <projectRoot>/.brain-cache/index_state.json.
 * Creates the directory if it does not exist.
 */
export async function writeIndexState(projectRoot: string, state: IndexState): Promise<void> {
  const dataDir = join(projectRoot, PROJECT_DATA_DIR);
  await mkdir(dataDir, { recursive: true });
  const statePath = join(dataDir, 'index_state.json');
  await writeFile(statePath, JSON.stringify(state, null, 2), 'utf-8');
}

/**
 * Manifest stored in file-hashes.json.
 * Extends the legacy format (plain Record<string, string>) with per-file token counts
 * and stat fingerprints for incremental I/O.
 * PERF-03: token counts cached here allow buildContext to skip disk reads.
 * DAILY-01: stats map holds size + mtimeMs per path for the stat fast-path skip logic.
 */
export interface FileHashManifest {
  hashes: Record<string, string>;
  tokenCounts: Record<string, number>;
  stats: Record<string, FileStatEntry>;
}

/**
 * Reads the file hash manifest from <projectRoot>/.brain-cache/file-hashes.json.
 * Returns a FileHashManifest with hashes and tokenCounts.
 * Gracefully degrades from the legacy format (plain Record<string, string>).
 */
export async function readFileHashes(projectRoot: string): Promise<FileHashManifest> {
  const hashPath = join(projectRoot, PROJECT_DATA_DIR, FILE_HASHES_FILENAME);
  try {
    const raw = await readFile(hashPath, 'utf-8');
    const parsed = JSON.parse(raw);
    // Graceful degradation: old format is just Record<string, string> without tokenCounts
    if (parsed && typeof parsed === 'object' && !parsed.hashes) {
      // Old format — migrate: treat entire object as hashes, no token counts, no stats
      return { hashes: parsed as Record<string, string>, tokenCounts: {}, stats: {} };
    }
    return {
      hashes: parsed.hashes ?? {},
      tokenCounts: parsed.tokenCounts ?? {},
      stats: parsed.stats ?? {},
    };
  } catch {
    return { hashes: {}, tokenCounts: {}, stats: {} };
  }
}

/**
 * Writes the file hash manifest to <projectRoot>/.brain-cache/file-hashes.json.
 * Creates the directory if it does not exist.
 */
export async function writeFileHashes(
  projectRoot: string,
  manifest: FileHashManifest
): Promise<void> {
  const dataDir = join(projectRoot, PROJECT_DATA_DIR);
  await mkdir(dataDir, { recursive: true });
  const hashPath = join(dataDir, FILE_HASHES_FILENAME);
  await writeFile(hashPath, JSON.stringify(manifest, null, 2), 'utf-8');
}

/**
 * Deletes all LanceDB rows where file_path matches the given filePath.
 * Uses SQL-style predicate with single-quote escaping.
 * Wrapped in withWriteLock to prevent interleaving with concurrent inserts.
 */
export async function deleteChunksByFilePath(
  table: lancedb.Table,
  filePath: string
): Promise<void> {
  const escaped = filePath.replace(/'/g, "''");
  await withWriteLock(async () => {
    await table.delete(`file_path = '${escaped}'`);
  });
}

/**
 * Deletes all chunk rows where file_path is in the given set.
 * Uses a single SQL IN predicate — one write lock acquire vs N serial acquires.
 * No-ops if filePaths is empty. Each path is single-quote escaped.
 * PERF-02: batch deletion for incremental re-index.
 */
export async function deleteChunksByFilePaths(
  table: lancedb.Table,
  filePaths: string[]
): Promise<void> {
  if (filePaths.length === 0) return;
  const escaped = filePaths.map(p => `'${p.replace(/'/g, "''")}'`).join(', ');
  await withWriteLock(async () => {
    await table.delete(`file_path IN (${escaped})`);
  });
}

export async function deleteHistoryChunks(table: lancedb.Table): Promise<void> {
  await withWriteLock(async () => {
    await table.delete("source_kind = 'history'");
  });
}

// --- Edges table ---

/**
 * Opens the 'edges' table if it already exists, or creates it with the edge schema.
 * Pass { shouldReset: true } to drop and recreate (used when chunks table is reset
 * due to embedding model change — old chunk IDs become stale).
 */
export async function openOrCreateEdgesTable(
  db: lancedb.Connection,
  opts?: { shouldReset?: boolean }
): Promise<lancedb.Table> {
  const tableNames = await db.tableNames();
  if (tableNames.includes('edges')) {
    if (opts?.shouldReset) {
      log.warn('Resetting edges table (chunks table was recreated)');
      await db.dropTable('edges');
    } else {
      log.info('Opened existing edges table');
      return db.openTable('edges');
    }
  }
  const schema = edgeSchema();
  const emptyData = lancedb.makeArrowTable([], { schema });
  const table = await db.createTable('edges', emptyData, { mode: 'overwrite' });
  log.info('Created new edges table');
  return table;
}

/**
 * Inserts a batch of call edges into the LanceDB edges table.
 * No-ops if edges is empty. Wrapped in withWriteLock.
 */
export async function insertEdges(
  table: lancedb.Table,
  edges: CallEdge[]
): Promise<void> {
  if (edges.length === 0) return;
  const rows: EdgeRow[] = edges.map(e => ({
    from_chunk_id: e.fromChunkId,
    from_file:     e.fromFile,
    from_symbol:   e.fromSymbol,
    to_symbol:     e.toSymbol,
    to_file:       e.toFile,
    edge_type:     e.edgeType,
  }));
  await withWriteLock(async () => {
    await table.add(rows);
    log.debug({ count: rows.length }, 'Inserted edge rows');
  });
}

/**
 * Escapes a string value for use in a LanceDB SQL predicate.
 * Doubles any single-quote characters to prevent SQL injection.
 */
export function escapeSqlLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

/**
 * Returns all edge rows where from_chunk_id matches the given value.
 * Returns empty array if no matches. Uses SQL predicate with single-quote escaping.
 */
export async function queryEdgesFrom(
  edgesTable: lancedb.Table,
  fromChunkId: string
): Promise<EdgeRow[]> {
  const escaped = escapeSqlLiteral(fromChunkId);
  return edgesTable.query().where(`from_chunk_id = '${escaped}'`).toArray() as Promise<EdgeRow[]>;
}

// Re-export CodeChunk for consumers of this module that only import from lancedb.ts
export type { CodeChunk };
