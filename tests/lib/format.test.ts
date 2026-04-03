import { describe, it, expect } from 'vitest';
import {
  formatToolResponse,
  formatErrorEnvelope,
  formatTokenSavings,
  formatDoctorOutput,
  formatIndexResult,
} from '../../src/lib/format.js';
import type { DoctorHealth, IndexResult } from '../../src/lib/format.js';

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

describe('formatTokenSavings', () => {
  it('formats typical token savings with plain label: value format (no column alignment)', () => {
    const result = formatTokenSavings({
      tokensSent: 1240,
      estimatedWithout: 18600,
      reductionPct: 93,
      filesInContext: 5,
    });
    expect(result).toBe(
      'Tokens sent to Claude: 1,240\n' +
      'Estimated without: ~18,600  (5 files + overhead)\n' +
      'Reduction: 93%'
    );
  });

  it('handles zero values', () => {
    const result = formatTokenSavings({
      tokensSent: 0,
      estimatedWithout: 0,
      reductionPct: 0,
      filesInContext: 0,
    });
    expect(result).toBe(
      'Tokens sent to Claude: 0\n' +
      'Estimated without: ~0  (0 files + overhead)\n' +
      'Reduction: 0%'
    );
  });

  it('uses singular "file" for single-file context', () => {
    const result = formatTokenSavings({
      tokensSent: 500,
      estimatedWithout: 2000,
      reductionPct: 75,
      filesInContext: 1,
    });
    expect(result).toContain('(1 file + overhead)');
  });

  it('uses plural "files" for multi-file context', () => {
    const result = formatTokenSavings({
      tokensSent: 500,
      estimatedWithout: 2000,
      reductionPct: 75,
      filesInContext: 3,
    });
    expect(result).toContain('(3 files + overhead)');
  });

  it('uses locale formatting with commas for large numbers', () => {
    const result = formatTokenSavings({
      tokensSent: 1234567,
      estimatedWithout: 9876543,
      reductionPct: 87,
      filesInContext: 10,
    });
    expect(result).toContain('1,234,567');
    expect(result).toContain('~9,876,543');
  });

  it('prefixes estimated value with ~ and suffixes reduction with %', () => {
    const result = formatTokenSavings({
      tokensSent: 500,
      estimatedWithout: 2000,
      reductionPct: 75,
      filesInContext: 3,
    });
    expect(result).toContain('~2,000');
    expect(result).toContain('75%');
    expect(result).not.toContain('~500');
  });

  it('uses plain label: value format with no extra spaces between label and value', () => {
    const result = formatTokenSavings({
      tokensSent: 1240,
      estimatedWithout: 18600,
      reductionPct: 93,
      filesInContext: 5,
    });
    // Plain format: "Tokens sent to Claude: " immediately followed by value
    expect(result).toContain('Tokens sent to Claude: 1,240');
    expect(result).toContain('Reduction: 93%');
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

  it('contains Ollama status line', () => {
    const result = formatDoctorOutput(runningHealth);
    expect(result).toContain('Ollama:');
    expect(result).toContain('running');
  });

  it('contains Ollama version when running', () => {
    const result = formatDoctorOutput(runningHealth);
    expect(result).toContain('0.8.0');
  });

  it('contains Index line with file and chunk counts when indexed', () => {
    const result = formatDoctorOutput(runningHealth);
    expect(result).toContain('Index:');
    expect(result).toContain('42');
    expect(result).toContain('317');
  });

  it('contains Embedding model line with model name', () => {
    const result = formatDoctorOutput(runningHealth);
    expect(result).toContain('Embedding model:');
    expect(result).toContain('nomic-embed-text');
  });

  it('contains VRAM line with tier and GiB when available', () => {
    const result = formatDoctorOutput(runningHealth);
    expect(result).toContain('VRAM:');
    expect(result).toContain('8.5');
  });

  it('shows appropriate status for not_installed Ollama', () => {
    const notInstalledHealth: DoctorHealth = {
      ...runningHealth,
      ollamaStatus: 'not_installed',
      ollamaVersion: null,
    };
    const result = formatDoctorOutput(notInstalledHealth);
    expect(result).toContain('Ollama:');
    expect(result).toContain('not_installed');
  });

  it('shows not indexed status when indexed is false', () => {
    const notIndexedHealth: DoctorHealth = {
      ...runningHealth,
      indexFreshness: {
        indexed: false,
        indexedAt: null,
        fileCount: null,
        chunkCount: null,
      },
    };
    const result = formatDoctorOutput(notIndexedHealth);
    expect(result).toContain('Index:');
    expect(result).toContain('not indexed');
  });

  it('shows no GPU detected when vramTier is none', () => {
    const noGpuHealth: DoctorHealth = {
      ...runningHealth,
      vramAvailable: null,
      vramTier: 'none',
    };
    const result = formatDoctorOutput(noGpuHealth);
    expect(result).toContain('VRAM:');
    expect(result).toContain('no GPU');
  });

  it('produces multi-line output with each service on its own line', () => {
    const result = formatDoctorOutput(runningHealth);
    const lines = result.split('\n').filter(l => l.trim() !== '');
    expect(lines.length).toBeGreaterThanOrEqual(4);
  });

  it('contains no ANSI escape codes', () => {
    const result = formatDoctorOutput(runningHealth);
    expect(result).not.toMatch(/\x1b\[/);
  });
});

describe('formatIndexResult', () => {
  it('produces single-line completion summary with counts', () => {
    const result = formatIndexResult({
      status: 'ok',
      path: '/home/user/project',
      fileCount: 42,
      chunkCount: 317,
    });
    expect(result).toBe('Indexed /home/user/project — 42 files, 317 chunks.');
  });

  it('produces short summary without counts when null', () => {
    const result = formatIndexResult({
      status: 'ok',
      path: '/p',
      fileCount: null,
      chunkCount: null,
    });
    expect(result).toBe('Indexed /p.');
  });

  it('uses the path from result', () => {
    const result: IndexResult = {
      status: 'ok',
      path: '/custom/path/here',
      fileCount: 10,
      chunkCount: 50,
    };
    expect(formatIndexResult(result)).toContain('/custom/path/here');
  });
});
