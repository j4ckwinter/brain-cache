import dedent from 'dedent';
import type { RetrievedChunk, ContextResult } from './types.js';
import type { TraceFlowResult } from '../workflows/traceFlow.js';

export interface TokenSavingsInput {
  tokensSent: number;
  estimatedWithout: number;
  reductionPct: number;
  filesInContext: number;
}

export interface DoctorHealth {
  ollamaStatus: 'not_installed' | 'running' | 'not_running';
  ollamaVersion: string | null;
  indexFreshness: {
    indexed: boolean;
    indexedAt: string | null;
    fileCount: number | null;
    chunkCount: number | null;
  };
  modelLoaded: boolean;
  embeddingModel: string | null;
  vramAvailable: number | null;
  vramTier: 'none' | 'standard' | 'large';
}

export interface IndexResult {
  status: string;
  path: string;
  fileCount: number | null;
  chunkCount: number | null;
}

export function formatToolResponse(summary: string, body: string): string {
  return `${summary}\n\n${body}`;
}

export function formatErrorEnvelope(message: string, suggestion?: string): string {
  const lines = [`Error: ${message}`];
  if (suggestion) lines.push(`Suggestion: ${suggestion}`);
  return lines.join('\n');
}

export function formatTokenSavings(input: TokenSavingsInput): string {
  const fileSuffix = input.filesInContext !== 1 ? 's' : '';
  return [
    `Tokens sent to Claude: ${input.tokensSent.toLocaleString()}`,
    `Estimated without: ~${input.estimatedWithout.toLocaleString()}  (${input.filesInContext} file${fileSuffix} + overhead)`,
    `Reduction: ${input.reductionPct}%`,
  ].join('\n');
}

export function formatDoctorOutput(health: DoctorHealth): string {
  const lines: string[] = [];

  // Ollama status line
  let ollamaLine = `Ollama: ${health.ollamaStatus}`;
  if (health.ollamaStatus === 'running' && health.ollamaVersion) {
    ollamaLine += ` (v${health.ollamaVersion})`;
  }
  lines.push(ollamaLine);

  // Index status line
  if (health.indexFreshness.indexed) {
    const { fileCount, chunkCount, indexedAt } = health.indexFreshness;
    let indexLine = 'Index: indexed';
    if (fileCount !== null && chunkCount !== null) {
      indexLine += ` — ${fileCount} files, ${chunkCount} chunks`;
    }
    if (indexedAt) {
      indexLine += ` (at ${indexedAt})`;
    }
    lines.push(indexLine);
  } else {
    lines.push('Index: not indexed');
  }

  // Embedding model line
  lines.push(`Embedding model: ${health.embeddingModel ?? 'none'}`);

  // VRAM line
  if (health.vramTier === 'none') {
    lines.push('VRAM: no GPU detected');
  } else {
    const vramVal = health.vramAvailable !== null ? `${health.vramAvailable} GiB` : 'unknown';
    lines.push(`VRAM: ${health.vramTier} (${vramVal})`);
  }

  return lines.join('\n');
}

export function formatIndexResult(result: IndexResult): string {
  if (result.fileCount !== null && result.chunkCount !== null) {
    return `Indexed ${result.path} — ${result.fileCount} files, ${result.chunkCount} chunks.`;
  }
  return `Indexed ${result.path}.`;
}

export function formatSearchResults(chunks: RetrievedChunk[]): string {
  if (chunks.length === 0) {
    return 'No results found for the given query.';
  }
  return chunks.map((chunk, i) => {
    const name = chunk.name ?? '(anonymous)';
    return dedent`
      ${i + 1}. ${name} (${chunk.chunkType})
         ${chunk.filePath}:${chunk.startLine}
         Score: ${chunk.similarity.toFixed(3)}
    `.trim();
  }).join('\n\n');
}

export function formatTraceFlow(result: TraceFlowResult): string {
  if (result.hops.length === 0) {
    return 'No call hops found. The entrypoint may not be indexed — run index_repo first.';
  }
  return result.hops.map((hop, i) => {
    const name = hop.name ?? '(anonymous)';
    const calls = hop.callsFound.length > 0 ? hop.callsFound.join(', ') : '(none)';
    return dedent`
      ${i + 1}. depth:${hop.hopDepth} ${name}
         ${hop.filePath}:${hop.startLine}
         Calls: ${calls}
    `.trim();
  }).join('\n\n');
}

export function formatContext(result: ContextResult): string {
  return result.content;
}

export function formatPipelineLabel(tasks: string[]): string {
  return tasks.join(' -> ');
}
