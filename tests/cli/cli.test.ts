import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockRunInit,
  mockRunIndex,
  mockRunSearch,
  mockRunDoctor,
  mockRunStatus,
  mockRunBuildContext,
  mockRunAskCodebase,
} = vi.hoisted(() => ({
  mockRunInit: vi.fn().mockResolvedValue(undefined),
  mockRunIndex: vi.fn().mockResolvedValue(undefined),
  mockRunSearch: vi.fn().mockResolvedValue({ chunks: [], fallback: false }),
  mockRunDoctor: vi.fn().mockResolvedValue(undefined),
  mockRunStatus: vi.fn().mockResolvedValue(undefined),
  mockRunBuildContext: vi.fn().mockResolvedValue({
    content: '',
    metadata: {
      tokensSent: 1,
      estimatedWithoutBraincache: 2,
      reductionPct: 0,
      filesInContext: 1,
      matchedPoolTokens: 5,
      filteringPct: 0,
      savingsDisplayMode: 'full',
      localTasksPerformed: [],
      cloudCallsMade: 0,
    },
  }),
  mockRunAskCodebase: vi.fn().mockResolvedValue({
    answer: 'ok',
    contextMetadata: {
      tokensSent: 1,
      estimatedWithoutBraincache: 2,
      reductionPct: 0,
      filesInContext: 1,
      matchedPoolTokens: 5,
      filteringPct: 0,
      savingsDisplayMode: 'full',
    },
  }),
}));

vi.mock('../../src/workflows/init.js', () => ({ runInit: mockRunInit }));
vi.mock('../../src/workflows/index.js', () => ({ runIndex: mockRunIndex }));
vi.mock('../../src/workflows/search.js', () => ({ runSearch: mockRunSearch }));
vi.mock('../../src/workflows/doctor.js', () => ({ runDoctor: mockRunDoctor }));
vi.mock('../../src/workflows/status.js', () => ({ runStatus: mockRunStatus }));
vi.mock('../../src/workflows/buildContext.js', () => ({ runBuildContext: mockRunBuildContext }));
vi.mock('../../src/workflows/askCodebase.js', () => ({ runAskCodebase: mockRunAskCodebase }));

import { program } from '../../src/cli/index.js';

describe('CLI Commander', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('init calls runInit', async () => {
    await program.parseAsync(['init'], { from: 'user' });
    expect(mockRunInit).toHaveBeenCalledTimes(1);
  });

  it('index calls runIndex with undefined path and no force by default', async () => {
    await program.parseAsync(['index'], { from: 'user' });
    expect(mockRunIndex).toHaveBeenCalledWith(undefined, { force: undefined });
  });

  it('index --force passes force: true', async () => {
    await program.parseAsync(['index', '--force'], { from: 'user' });
    expect(mockRunIndex).toHaveBeenCalledWith(undefined, { force: true });
  });

  it('index /some/path passes path', async () => {
    await program.parseAsync(['index', '/some/path'], { from: 'user' });
    expect(mockRunIndex).toHaveBeenCalledWith('/some/path', { force: undefined });
  });

  it('search passes query and default limit', async () => {
    await program.parseAsync(['search', 'hello world'], { from: 'user' });
    expect(mockRunSearch).toHaveBeenCalledWith('hello world', {
      limit: 10,
      path: undefined,
    });
  });

  it('status calls runStatus', async () => {
    await program.parseAsync(['status'], { from: 'user' });
    expect(mockRunStatus).toHaveBeenCalled();
  });

  it('doctor calls runDoctor', async () => {
    await program.parseAsync(['doctor'], { from: 'user' });
    expect(mockRunDoctor).toHaveBeenCalled();
  });

  it('search without query errors', async () => {
    await expect(program.parseAsync(['search'], { from: 'user' })).rejects.toThrow();
  });
});
