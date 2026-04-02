import { describe, it, expect } from 'vitest';
import { formatTokenSavings } from '../../src/lib/format.js';

describe('formatTokenSavings', () => {
  it('formats typical token savings with aligned columns', () => {
    const result = formatTokenSavings({
      tokensSent: 1240,
      estimatedWithout: 18600,
      reductionPct: 93,
      filesInContext: 5,
    });
    expect(result).toBe(
      'Tokens sent to Claude:     1,240\n' +
      'Estimated without:         ~18,600  (5 files + overhead)\n' +
      'Reduction:                 93%'
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
      'Tokens sent to Claude:     0\n' +
      'Estimated without:         ~0  (0 files + overhead)\n' +
      'Reduction:                 0%'
    );
  });

  it('aligns small numbers correctly', () => {
    const result = formatTokenSavings({
      tokensSent: 150,
      estimatedWithout: 1000,
      reductionPct: 85,
      filesInContext: 2,
    });
    expect(result).toBe(
      'Tokens sent to Claude:     150\n' +
      'Estimated without:         ~1,000  (2 files + overhead)\n' +
      'Reduction:                 85%'
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

  it('right-aligns values starting at column 27', () => {
    const result = formatTokenSavings({
      tokensSent: 1240,
      estimatedWithout: 18600,
      reductionPct: 93,
      filesInContext: 5,
    });
    const lines = result.split('\n');
    // Each line should have the label padded to 27 characters
    // Labels: "Tokens sent to Claude:" (22), "Estimated without:" (18), "Reduction:" (10)
    // All padded to 27 with spaces
    for (const line of lines) {
      const labelMatch = line.match(/^(.+?:\s+)/);
      expect(labelMatch).not.toBeNull();
      expect(labelMatch![1].length).toBe(27);
    }
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
    // tokensSent should NOT have ~ prefix
    expect(result).not.toContain('~500');
  });
});
