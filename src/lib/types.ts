import { z } from 'zod';

export type VRAMTier = 'none' | 'standard' | 'large';

export const CapabilityProfileSchema = z.object({
  version:        z.literal(1),
  detectedAt:     z.string().datetime(),
  vramTier:       z.enum(['none', 'standard', 'large']),
  vramGiB:        z.number().nullable(),
  gpuVendor:      z.enum(['nvidia', 'apple', 'none']),
  embeddingModel: z.string(),
  ollamaVersion:  z.string().nullable(),
  platform:       z.string(),
});

export type CapabilityProfile = z.infer<typeof CapabilityProfileSchema>;

export const CodeChunkSchema = z.object({
  id:         z.string(),
  filePath:   z.string(),
  chunkType:  z.enum(['function', 'class', 'method', 'file']),
  scope:      z.string().nullable(),
  name:       z.string().nullable(),
  content:    z.string(),
  startLine:  z.number().int(),
  endLine:    z.number().int(),
});
export type CodeChunk = z.infer<typeof CodeChunkSchema>;

export const IndexStateSchema = z.object({
  version:        z.literal(1),
  embeddingModel: z.string(),
  dimension:      z.number().int(),
  indexedAt:      z.string().datetime(),
  fileCount:      z.number().int(),
  chunkCount:     z.number().int(),
  totalTokens:    z.number().int().default(0),
});
export type IndexState = z.infer<typeof IndexStateSchema>;

// --- Phase 3: Retrieval types ---

export type QueryIntent = 'lookup' | 'trace' | 'explore';

export interface SearchOptions {
  limit: number;
  distanceThreshold: number; // cosine distance (0.3 = 0.7 similarity)
  keywordBoostWeight?: number; // per-mode boost weight for keyword matching (RET-01)
}

// --- Phase 16: Flow tracing types ---

export interface FlowHop {
  chunkId: string;
  filePath: string;
  name: string | null;
  startLine: number;
  endLine: number;
  content: string;
  hopDepth: number;
  callsFound: string[];
}

export interface RetrievedChunk {
  id: string;
  filePath: string;
  chunkType: string;
  scope: string | null;
  name: string | null;
  content: string;
  startLine: number;
  endLine: number;
  similarity: number; // 1 - _distance (higher = more similar)
}

export interface ContextMetadata {
  tokensSent: number;
  estimatedWithoutBraincache: number;
  reductionPct: number;
  filesInContext: number;
  localTasksPerformed: string[];
  cloudCallsMade: number;
}

export interface ContextResult {
  content: string;
  chunks: RetrievedChunk[];
  metadata: ContextMetadata;
}

export interface CallEdge {
  fromChunkId: string;
  fromFile: string;
  fromSymbol: string | null;
  toSymbol: string;
  toFile: string | null;
  edgeType: 'call' | 'import';
}

export interface ChunkResult {
  chunks: CodeChunk[];
  edges: CallEdge[];
}
