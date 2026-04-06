import { describe, it, expect } from 'vitest';
import {
  formatToolResponse,
  formatErrorEnvelope,
  formatTokenSavings,
  formatDoctorOutput,
  formatIndexResult,
  formatSearchResults,
  formatContext,
  formatPipelineLabel,
} from '../../src/lib/format.js';
import type { DoctorHealth, IndexResult } from '../../src/lib/format.js';
import type { RetrievedChunk, ContextResult, ContextMetadata } from '../../src/lib/types.js';

describe('formatToolResponse', () => {
  it('joins summary and body with a blank line separator', () => {
    const result = formatToolResponse('Found 3 results', '1. foo\n2. bar\n3. baz');
    expect(result).toBe('Found 3 results\n\n1. foo\n2. bar\n3. baz');
  });

  it('first line of return value is exactly the summary string', () => {
    const result = formatToolResponse('Summary line', 'Body content');
    const lines = result.split('\n');
    expect(lines[0]).toBe('Summary line');
  });

  it('summary and body separated by exactly one blank line', () => {
    const result = formatToolResponse('Summary', 'Body');
    const lines = result.split('\n');
    expect(lines[1]).toBe('');
    expect(lines[2]).toBe('Body');
  });
});

describe('formatErrorEnvelope', () => {
  it('produces "Error: <msg>" without suggestion', () => {
    const result = formatErrorEnvelope('something went wrong');
    expect(result).toBe('Error: something went wrong');
  });

  it('produces error with suggestion when provided', () => {
    const result = formatErrorEnvelope('Ollama not running', 'Run ollama serve');
    expect(result).toBe('Error: Ollama not running\nSuggestion: Run ollama serve');
  });

  it('no Suggestion line when suggestion is undefined', () => {
    const result = formatErrorEnvelope('some error');
    expect(result).not.toContain('Suggestion:');
  });
});

describe('formatTokenSavings (index embedding)', () => {
  it('uses legacy index wording for chunk vs raw stats', () => {
    const result = formatTokenSavings({
      tokensSent: 500,
      estimatedWithout: 2000,
      reductionPct: 75,
      filesInContext: 3,
      indexEmbeddingMode: true,
    });
    expect(result).toContain('Estimated without:');
    expect(result).toContain('Reduction: 75%');
    expect(result).not.toContain('grep-style');
  });
});

describe('formatTokenSavings (search_codebase)', () => {
  it('formats search footer with grep baseline and value line', () => {
    const result = formatTokenSavings({
      tokensSent: 1240,
      estimatedWithout: 18600,
      reductionPct: 93,
      filesInContext: 5,
      savingsDisplayMode: 'full',
    });
    expect(result).toContain('Tokens sent to Claude: 1,240');
    expect(result).toContain('Vs grep-style baseline');
    expect(result).toContain('~18,600');
    expect(result).toContain('Reduction vs baseline: 93%');
    expect(result).toContain('semantic discovery');
  });

  it('handles zero values', () => {
    const result = formatTokenSavings({
      tokensSent: 0,
      estimatedWithout: 300,
      reductionPct: 0,
      filesInContext: 0,
      savingsDisplayMode: 'full',
    });
    expect(result).toContain('Tokens sent to Claude: 0');
    expect(result).toContain('~300');
  });

  it('uses singular "file" for single-file context', () => {
    const result = formatTokenSavings({
      tokensSent: 500,
      estimatedWithout: 2000,
      reductionPct: 75,
      filesInContext: 1,
      savingsDisplayMode: 'full',
    });
    expect(result).toContain('(1 file + overhead)');
  });

  it('omits reduction line when savingsDisplayMode is filtering_only', () => {
    const result = formatTokenSavings({
      tokensSent: 10,
      estimatedWithout: 5000,
      reductionPct: 98,
      filesInContext: 2,
      savingsDisplayMode: 'filtering_only',
    });
    expect(result).not.toContain('Reduction vs baseline');
    expect(result).toContain('semantic discovery');
  });
});

describe('formatTokenSavings (build_context)', () => {
  it('shows matched chunk pool and optional grep baseline', () => {
    const result = formatTokenSavings({
      tokensSent: 3757,
      estimatedWithout: 12000,
      reductionPct: 68,
      filesInContext: 14,
      matchedPoolTokens: 48000,
      filteringPct: 92,
      savingsDisplayMode: 'full',
    });
    expect(result).toContain('Tokens sent to Claude: 3,757');
    expect(result).toContain('~48,000');
    expect(result).toContain('92% filtered by budget');
    expect(result).toContain('Vs grep-style baseline');
    expect(result).toContain('semantic discovery');
  });

  it('hides grep baseline line when savingsDisplayMode is filtering_only', () => {
    const result = formatTokenSavings({
      tokensSent: 100,
      estimatedWithout: 50000,
      reductionPct: 98,
      filesInContext: 3,
      matchedPoolTokens: 40000,
      filteringPct: 99,
      savingsDisplayMode: 'filtering_only',
    });
    expect(result).not.toContain('Vs grep-style baseline');
    expect(result).toContain('filtered by budget');
  });
});

describe('formatDoctorOutput', () => {
  const runningHealth: DoctorHealth = {
    ollamaStatus: 'running',
    ollamaVersion: '0.8.0',
    indexFreshness: {
      indexed: true,
      indexedAt: '2026-04-03T08:00:00Z',
      fileCount: 42,
      chunkCount: 317,
    },
    modelLoaded: true,
    embeddingModel: 'nomic-embed-text',
    vramAvailable: 8.5,
    vramTier: 'standard',
  };

  it('includes Ollama and index lines when running', () => {
    const out = formatDoctorOutput(runningHealth);
    expect(out).toContain('Ollama: running');
    expect(out).toContain('Index: indexed');
  });
});

describe('formatSearchResults', () => {
  it('returns empty message when no chunks', () => {
    expect(formatSearchResults([])).toContain('No results');
  });
});

describe('formatContext', () => {
  it('returns content only', () => {
    const result: ContextResult = {
      content: 'ctx',
      chunks: [],
      metadata: {} as ContextMetadata,
    };
    expect(formatContext(result)).toBe('ctx');
  });
});

describe('formatPipelineLabel', () => {
  it('joins tasks with arrow', () => {
    expect(formatPipelineLabel(['a', 'b'])).toBe('a -> b');
  });
});

describe('formatIndexResult', () => {
  it('formats with counts', () => {
    const r: IndexResult = {
      status: 'ok',
      path: '/p',
      fileCount: 3,
      chunkCount: 10,
    };
    expect(formatIndexResult(r)).toContain('3 files');
  });
});
