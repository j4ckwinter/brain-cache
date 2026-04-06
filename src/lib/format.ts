import dedent from 'dedent';
import type { RetrievedChunk, ContextResult, SavingsDisplayMode } from './types.js';

export interface TokenSavingsInput {
  tokensSent: number;
  estimatedWithout: number;
  reductionPct: number;
  filesInContext: number;
  /** `brain-cache index` completion: raw vs chunked token stats (not Claude grep baseline). */
  indexEmbeddingMode?: boolean;
  /** Present for build_context / honest savings footer */
  matchedPoolTokens?: number;
  filteringPct?: number;
  savingsDisplayMode?: SavingsDisplayMode;
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

/**
 * Human-readable token / savings footer for MCP and CLI.
 * When `matchedPoolTokens` + `savingsDisplayMode` are set (build_context), shows
 * filtering ratio and optional grep baseline; otherwise search_codebase-style lines.
 */
export function formatTokenSavings(input: TokenSavingsInput): string {
  if (input.indexEmbeddingMode) {
    return formatIndexEmbeddingFooter(input);
  }
  if (
    input.matchedPoolTokens !== undefined &&
    input.filteringPct !== undefined &&
    input.savingsDisplayMode !== undefined
  ) {
    return formatContextTokenSavings(input);
  }
  return formatSearchTokenSavings(input);
}

function formatIndexEmbeddingFooter(input: TokenSavingsInput): string {
  const fileSuffix = input.filesInContext !== 1 ? 's' : '';
  return [
    `Tokens sent to Claude: ${input.tokensSent.toLocaleString()}`,
    `Estimated without: ~${input.estimatedWithout.toLocaleString()}  (${input.filesInContext} file${fileSuffix} + overhead)`,
    `Reduction: ${input.reductionPct}%`,
  ].join('\n');
}

function formatContextTokenSavings(input: TokenSavingsInput): string {
  const lines: string[] = [
    `Tokens sent to Claude: ${input.tokensSent.toLocaleString()}`,
  ];
  if (input.matchedPoolTokens! > 0) {
    lines.push(
      `Retrieved ~${input.tokensSent.toLocaleString()} of ~${input.matchedPoolTokens!.toLocaleString()} tokens from matched chunks (${input.filteringPct}% filtered by budget)`,
    );
  }
  if (input.savingsDisplayMode === 'full') {
    lines.push(
      `Vs grep-style baseline (grep + read up to 5 files): ~${input.estimatedWithout.toLocaleString()} — Reduction vs baseline: ${input.reductionPct}%`,
    );
  }
  lines.push(
    'Value: semantic discovery — relevant code without knowing file paths upfront.',
  );
  return lines.join('\n');
}

function formatSearchTokenSavings(input: TokenSavingsInput): string {
  const fileSuffix = input.filesInContext !== 1 ? 's' : '';
  const lines = [
    `Tokens sent to Claude: ${input.tokensSent.toLocaleString()}`,
    `Vs grep-style baseline (grep + read up to 5 files): ~${input.estimatedWithout.toLocaleString()}  (${input.filesInContext} file${fileSuffix} + overhead)`,
  ];
  if (input.savingsDisplayMode !== 'filtering_only') {
    lines.push(`Reduction vs baseline: ${input.reductionPct}%`);
  }
  lines.push(
    'Value: semantic discovery — relevant code without knowing file paths upfront.',
  );
  return lines.join('\n');
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
    const provenance = chunk.sourceKind === 'history' ? '[history]' : '[source]';
    return dedent`
      ${i + 1}. ${name} (${chunk.chunkType}) ${provenance}
         ${chunk.filePath}:${chunk.startLine}
         Score: ${chunk.similarity.toFixed(3)}
    `.trim();
  }).join('\n\n');
}

export function formatContext(result: ContextResult): string {
  return result.content;
}

export function formatPipelineLabel(tasks: string[]): string {
  return tasks.join(' -> ');
}
