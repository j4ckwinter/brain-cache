// Services barrel export
export {
  openDatabase,
  openOrCreateChunkTable,
  insertChunks,
  readIndexState,
  writeIndexState,
  createVectorIndexIfNeeded,
  readFileHashes,
  writeFileHashes,
  deleteChunksByFilePath,
  chunkSchema,
  type ChunkRow,
} from './lancedb.js';
