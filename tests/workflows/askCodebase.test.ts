import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Use vi.hoisted so mockCreate is available in vi.mock factory (which is hoisted to top)
const { mockCreate } = vi.hoisted(() => {
  return { mockCreate: vi.fn() };
});

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  })),
}));

// Mock buildContext workflow
vi.mock('../../src/workflows/buildContext.js', () => ({
  runBuildContext: vi.fn(),
}));

// Mock logger
vi.mock('../../src/services/logger.js', () => ({
  childLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  })),
}));

import { runBuildContext } from '../../src/workflows/buildContext.js';
import type { ContextResult } from '../../src/lib/types.js';

const mockRunBuildContext = vi.mocked(runBuildContext);

function mockContextResult(): ContextResult {
  return {
    content: 'function hello() { return "world"; }',
    chunks: [
      {
        id: '1',
        filePath: 'test.ts',
        chunkType: 'function',
        scope: null,
        name: 'hello',
        content: 'function hello() {}',
        startLine: 1,
        endLine: 1,
        similarity: 0.95,
        fileType: 'source',
      },
    ],
    metadata: {
      tokensSent: 50,
      estimatedWithoutBraincache: 500,
      reductionPct: 90,
      filesInContext: 1,
      matchedPoolTokens: 200,
      filteringPct: 30,
      savingsDisplayMode: 'full',
      localTasksPerformed: ['embed_query', 'vector_search'],
      cloudCallsMade: 0,
    },
  };
}

const mockClaudeResponse = {
  content: [{ type: 'text', text: 'The hello function returns "world".' }],
  usage: { input_tokens: 60, output_tokens: 20 },
};

describe('runAskCodebase', () => {
  let stderrOutput: string[];
  let stderrWriteSpy: ReturnType<typeof vi.spyOn>;
  const originalApiKey = process.env.ANTHROPIC_API_KEY;
  const originalModel = process.env.BRAIN_CACHE_CLAUDE_MODEL;

  beforeEach(() => {
    stderrOutput = [];

    stderrWriteSpy = vi.spyOn(process.stderr, 'write').mockImplementation((data: unknown) => {
      stderrOutput.push(String(data));
      return true;
    });

    // Set required env by default
    process.env.ANTHROPIC_API_KEY = 'test-key';
    delete process.env.BRAIN_CACHE_CLAUDE_MODEL;

    // Happy path defaults
    mockRunBuildContext.mockResolvedValue(mockContextResult());
    mockCreate.mockReset();
    mockCreate.mockResolvedValue(mockClaudeResponse);
  });

  afterEach(() => {
    // Use clearAllMocks (not restoreAllMocks) to avoid restoring vi.mock() factories
    vi.clearAllMocks();
    stderrWriteSpy.mockRestore();
    // Restore env
    if (originalApiKey === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = originalApiKey;
    }
    if (originalModel === undefined) {
      delete process.env.BRAIN_CACHE_CLAUDE_MODEL;
    } else {
      process.env.BRAIN_CACHE_CLAUDE_MODEL = originalModel;
    }
  });

  it('throws when ANTHROPIC_API_KEY is not set', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const { runAskCodebase } = await import('../../src/workflows/askCodebase.js');
    await expect(runAskCodebase('how does hello work')).rejects.toThrow('ANTHROPIC_API_KEY environment variable is not set.');
  });

  it('calls runBuildContext with question and path option', async () => {
    const { runAskCodebase } = await import('../../src/workflows/askCodebase.js');
    await runAskCodebase('how does hello work', { path: '/my/project' });
    expect(mockRunBuildContext).toHaveBeenCalledWith('how does hello work', {
      maxTokens: undefined,
      path: '/my/project',
    });
  });

  it('sends contextResult.content (not chunks) to Anthropic messages.create (CLD-02)', async () => {
    const { runAskCodebase } = await import('../../src/workflows/askCodebase.js');
    await runAskCodebase('how does hello work');
    expect(mockCreate).toHaveBeenCalledTimes(1);
    const callArgs = mockCreate.mock.calls[0][0];
    const messageContent = callArgs.messages[0].content as string;
    // Must contain the assembled content string
    expect(messageContent).toContain('function hello() { return "world"; }');
    // Must NOT contain raw chunk data (e.g., "similarity" field from chunks array)
    expect(messageContent).not.toContain('"similarity"');
    // Must NOT contain chunk ids
    expect(messageContent).not.toContain('"id": "1"');
  });

  it('returns the answer string from Claude response', async () => {
    const { runAskCodebase } = await import('../../src/workflows/askCodebase.js');
    const result = await runAskCodebase('how does hello work');
    expect(result.answer).toBe('The hello function returns "world".');
  });

  it('uses BRAIN_CACHE_CLAUDE_MODEL env var when set', async () => {
    process.env.BRAIN_CACHE_CLAUDE_MODEL = 'claude-opus-4-5';
    const { runAskCodebase } = await import('../../src/workflows/askCodebase.js');
    await runAskCodebase('how does hello work');
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'claude-opus-4-5' })
    );
  });

  it('returns contextMetadata with tokensSent and reductionPct', async () => {
    const { runAskCodebase } = await import('../../src/workflows/askCodebase.js');
    const result = await runAskCodebase('how does hello work');
    expect(result.contextMetadata.tokensSent).toBe(50);
    expect(result.contextMetadata.reductionPct).toBe(90);
    expect(result.contextMetadata.estimatedWithoutBraincache).toBe(500);
  });

  it('handles response with no text block gracefully', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'tool_use', id: 'tool1', name: 'some_tool', input: {} }],
      usage: { input_tokens: 10, output_tokens: 0 },
    });
    const { runAskCodebase } = await import('../../src/workflows/askCodebase.js');
    const result = await runAskCodebase('how does hello work');
    expect(result.answer).toContain('(no text response');
  });

  it('uses sensible default model when BRAIN_CACHE_CLAUDE_MODEL is not set', async () => {
    const { runAskCodebase } = await import('../../src/workflows/askCodebase.js');
    await runAskCodebase('how does hello work');
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: expect.stringContaining('claude') })
    );
  });

  it('result includes the model name used', async () => {
    const { runAskCodebase } = await import('../../src/workflows/askCodebase.js');
    const result = await runAskCodebase('how does hello work');
    expect(typeof result.model).toBe('string');
    expect(result.model.length).toBeGreaterThan(0);
  });

  describe('API error paths', () => {
    it('throws when ANTHROPIC_API_KEY is empty string', async () => {
      process.env.ANTHROPIC_API_KEY = '';
      const { runAskCodebase } = await import('../../src/workflows/askCodebase.js');
      await expect(runAskCodebase('q')).rejects.toThrow('ANTHROPIC_API_KEY');
    });

    it('propagates rate limit errors from Anthropic', async () => {
      mockCreate.mockRejectedValue(new Error('rate_limit_error: Too many requests'));
      const { runAskCodebase } = await import('../../src/workflows/askCodebase.js');
      await expect(runAskCodebase('q')).rejects.toThrow(/Too many requests|rate/i);
    });

    it('propagates generic API failures', async () => {
      mockCreate.mockRejectedValue(new Error('Internal server error'));
      const { runAskCodebase } = await import('../../src/workflows/askCodebase.js');
      await expect(runAskCodebase('q')).rejects.toThrow('Internal server error');
    });
  });
});
