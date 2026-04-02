import Anthropic from '@anthropic-ai/sdk';
import { runBuildContext } from './buildContext.js';
import type { BuildContextOptions } from './buildContext.js';
import { childLogger } from '../services/logger.js';
import { formatTokenSavings } from '../lib/format.js';

const log = childLogger('ask-codebase');

const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-4-20250514';
const DEFAULT_MAX_RESPONSE_TOKENS = 4096;

const SYSTEM_PROMPT = `You are a codebase assistant. Answer questions strictly based on the provided codebase context.

- Do not hallucinate or infer implementation details not present in the provided context.
- Prioritize code-level explanations and reference specific files and functions when available.
- If the provided context is insufficient to answer the question, say "I don't see enough context to answer that" rather than guessing.
- Be precise and grounded in the actual code shown.`;

export interface AskCodebaseOptions {
  path?: string;
  maxContextTokens?: number;
  maxResponseTokens?: number;
}

export interface AskCodebaseResult {
  answer: string;
  contextMetadata: {
    tokensSent: number;
    estimatedWithoutBraincache: number;
    reductionPct: number;
    filesInContext: number;
  };
  model: string;
}

export async function runAskCodebase(
  question: string,
  opts?: AskCodebaseOptions
): Promise<AskCodebaseResult> {
  // 1. Check ANTHROPIC_API_KEY early
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY environment variable is not set.');
  }

  // 2. Build context locally (all local GPU work happens here)
  const buildOpts: BuildContextOptions = {
    maxTokens: opts?.maxContextTokens,
    path: opts?.path,
  };
  const contextResult = await runBuildContext(question, buildOpts);

  process.stderr.write(
    `brain-cache: context assembled\n${formatTokenSavings({ tokensSent: contextResult.metadata.tokensSent, estimatedWithout: contextResult.metadata.estimatedWithoutBraincache, reductionPct: contextResult.metadata.reductionPct, filesInContext: contextResult.metadata.filesInContext })}\n`
  );

  // 3. Send ONLY assembled content to Claude — NOT raw chunks (CLD-02)
  const model = process.env.BRAIN_CACHE_CLAUDE_MODEL ?? DEFAULT_CLAUDE_MODEL;
  const maxTokens = opts?.maxResponseTokens ?? DEFAULT_MAX_RESPONSE_TOKENS;

  const client = new Anthropic();
  const response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Here is relevant context from the codebase:\n\n${contextResult.content}\n\nQuestion: ${question}`,
      },
    ],
  });

  // 4. Extract text response
  const textBlock = response.content.find((b) => b.type === 'text');
  const answer = (textBlock as { type: 'text'; text: string } | undefined)?.text ?? '(no text response from Claude)';

  log.info(
    {
      model,
      inputTokens: response.usage?.input_tokens,
      outputTokens: response.usage?.output_tokens,
    },
    'ask-codebase complete'
  );

  return {
    answer,
    contextMetadata: {
      tokensSent: contextResult.metadata.tokensSent,
      estimatedWithoutBraincache: contextResult.metadata.estimatedWithoutBraincache,
      reductionPct: contextResult.metadata.reductionPct,
      filesInContext: contextResult.metadata.filesInContext,
    },
    model,
  };
}
