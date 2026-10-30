import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockRunInit,
  mockRunIndex,
  mockRunSearch,
  mockRunDoctor,
  mockRunStatus,
  mockRunBuildContext,
  mockRunAskCodebase,
  mockRunWatch,
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
  mockRunWatch: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/workflows/init.js', () => ({ runInit: mockRunInit }));
vi.mock('../../src/workflows/index.js', () => ({ runIndex: mockRunIndex }));
vi.mock('../../src/workflows/search.js', () => ({ runSearch: mockRunSearch }));
vi.mock('../../src/workflows/doctor.js', () => ({ runDoctor: mockRunDoctor }));
vi.mock('../../src/workflows/status.js', () => ({ runStatus: mockRunStatus }));
vi.mock('../../src/workflows/buildContext.js', () => ({ runBuildContext: mockRunBuildContext }));
vi.mock('../../src/workflows/askCodebase.js', () => ({ runAskCodebase: mockRunAskCodebase }));
vi.mock('../../src/workflows/watch.js', () => ({ runWatch: mockRunWatch }));

let program: typeof import('../../src/cli/index.js').program;

describe('CLI Commander', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    ({ program } = await import('../../src/cli/index.js'));
    for (const command of [program, ...program.commands]) {
      command.exitOverride();
      command.configureOutput({ writeErr: () => {} });
    }
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

  it('index --verify passes verify: true', async () => {
    await program.parseAsync(['index', '--verify'], { from: 'user' });
    expect(mockRunIndex).toHaveBeenCalledWith(undefined, { force: undefined, verify: true });
  });

  it('index --force --verify passes both flags (force wins at workflow level)', async () => {
    await program.parseAsync(['index', '--force', '--verify'], { from: 'user' });
    expect(mockRunIndex).toHaveBeenCalledWith(undefined, { force: true, verify: true });
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

  it('watch calls runWatch with undefined path by default', async () => {
    await program.parseAsync(['watch'], { from: 'user' });
    expect(mockRunWatch).toHaveBeenCalledWith(undefined);
  });

  it('watch passes path argument to runWatch', async () => {
    await program.parseAsync(['watch', '/some/path'], { from: 'user' });
    expect(mockRunWatch).toHaveBeenCalledWith('/some/path');
  });
  describe.each([
    ['search', '--limit', mockRunSearch, 'limit', 10],
    ['context', '--limit', mockRunBuildContext, 'limit', 10],
    ['context', '--budget', mockRunBuildContext, 'maxTokens', 4096],
    ['ask', '--budget', mockRunAskCodebase, 'maxContextTokens', 4096],
  ] as const)('%s %s', (command, option, workflow, property, defaultValue) => {
    it.each(['10oops', '0', '-1', '1.5', 'Infinity', 'NaN', '9007199254740992', '1e3', '0x10', ' 10', '+10', ''])(
      'rejects %j before invoking the workflow', async value => {
        await expect(program.parseAsync([command, 'query', `${option}=${value}`], { from: 'user' }))
          .rejects.toMatchObject({ code: 'commander.invalidArgument' });
        expect(workflow).not.toHaveBeenCalled();
      },
    );

    it.each(['1', '0007', '100001', '9007199254740991'])(
      'passes valid value %s as a number', async value => {
        await program.parseAsync([command, 'query', option, value], { from: 'user' });
        expect(workflow).toHaveBeenCalledWith('query', expect.objectContaining({ [property]: Number(value) }));
      },
    );

    it('preserves the numeric default', async () => {
      await program.parseAsync([command, 'query'], { from: 'user' });
      expect(workflow).toHaveBeenCalledWith('query', expect.objectContaining({ [property]: defaultValue }));
    });
  });

});
