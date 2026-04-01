# Testing Patterns

**Analysis Date:** 2026-04-01

## Test Framework

**Runner:**
- vitest 2.x
- Config: `vitest.config.ts`

**Assertion Library:**
- vitest built-in `expect` (Chai-compatible API)

**Run Commands:**
```bash
npm test                # Run all tests (vitest run)
npm run test:watch      # Watch mode (vitest)
```

## Test Configuration

```typescript
// vitest.config.ts
export default defineConfig({
  test: {
    globals: true,          // describe, it, expect available globally
    environment: 'node',    // Node.js environment (not jsdom)
    include: ['tests/**/*.test.ts'],
  },
});
```

**Key settings:**
- Globals enabled -- do NOT need to import `describe`, `it`, `expect` (but tests DO import them explicitly from `vitest`)
- Tests located in separate `tests/` directory (not co-located with source)
- Only `.test.ts` files in `tests/` are included

## Test File Organization

**Location:** Separate `tests/` directory mirroring `src/` structure

**Naming:** `{module}.test.ts` matching the source file name

**Structure:**
```
tests/
├── mcp/
│   └── server.test.ts          # Tests for src/mcp/index.ts
├── services/
│   ├── capability.test.ts      # Tests for src/services/capability.ts
│   ├── chunker.test.ts         # Tests for src/services/chunker.ts
│   ├── crawler.test.ts         # Tests for src/services/crawler.ts
│   ├── embedder.test.ts        # Tests for src/services/embedder.ts
│   ├── logger.test.ts          # Tests for src/services/logger.ts + src/lib/types.ts + src/lib/config.ts
│   ├── ollama.test.ts          # Tests for src/services/ollama.ts
│   ├── retriever.test.ts       # Tests for src/services/retriever.ts
│   └── tokenCounter.test.ts    # Tests for src/services/tokenCounter.ts
└── workflows/
    ├── askCodebase.test.ts     # Tests for src/workflows/askCodebase.ts
    ├── buildContext.test.ts    # Tests for src/workflows/buildContext.ts
    ├── index.test.ts           # Tests for src/workflows/index.ts
    ├── init.test.ts            # Tests for src/workflows/init.ts + src/workflows/doctor.ts
    ├── search.test.ts          # Tests for src/workflows/search.ts
    └── status.test.ts          # Tests for src/workflows/status.ts
```

**Total: 15 test files, 224 tests passing**

## Test Structure

**Suite Organization:**
```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// 1. Module-level vi.mock() calls (BEFORE any imports of the mocked modules)
vi.mock('../../src/services/capability.js', () => ({
  readProfile: vi.fn(),
  writeProfile: vi.fn(),
}));

// 2. Import the module under test and its mocked dependencies
import { runInit } from '../../src/workflows/init.js';
import { readProfile } from '../../src/services/capability.js';

// 3. Create typed mock references
const mockReadProfile = vi.mocked(readProfile);

// 4. Shared test fixtures/constants
const mockProfile = { version: 1 as const, ... };

// 5. Test suites grouped by function name
describe('functionName', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Set up happy path defaults
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('describes expected behavior', () => { ... });
});
```

**Patterns:**
- Each `describe` block corresponds to one exported function
- `beforeEach` sets up happy-path mocks; individual tests override for edge cases
- Tests follow the pattern: setup (arrange), act, assert
- Test descriptions are behavior-focused: `'returns true when "which ollama" succeeds'`

## Mocking

**Framework:** vitest built-in `vi.mock()`, `vi.fn()`, `vi.mocked()`, `vi.spyOn()`

### Mocking External Packages

**Ollama SDK:**
```typescript
vi.mock('ollama', () => ({
  default: {
    embed: vi.fn(),
    list: vi.fn(),
    pull: vi.fn(),
  },
}));
import ollama from 'ollama';
const mockOllama = vi.mocked(ollama);
```

**Anthropic SDK (with vi.hoisted for factory access):**
```typescript
const { mockCreate } = vi.hoisted(() => {
  return { mockCreate: vi.fn() };
});
vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  })),
}));
```

**Anthropic Tokenizer:**
```typescript
vi.mock('@anthropic-ai/tokenizer', () => ({
  countTokens: vi.fn((text: string) => text.split(/\s+/).filter(Boolean).length),
}));
```

**MCP SDK:**
```typescript
const registeredTools = new Map<string, { schema: any; handler: Function }>();
vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: vi.fn().mockImplementation(() => ({
    registerTool: vi.fn((name: string, config: any, handler: Function) => {
      registeredTools.set(name, { schema: config, handler });
    }),
    connect: vi.fn().mockResolvedValue(undefined),
  })),
}));
```

### Mocking Node.js Built-ins

**child_process (execFile with promisify pattern):**
```typescript
vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
  spawn: vi.fn(),
}));

// Helper to mock the callback-based execFile that gets promisified
function mockExecFileSuccess(stdout: string) {
  mockExecFile.mockImplementation((...args: unknown[]) => {
    const cb = args[args.length - 1] as (err: null, result: { stdout: string }) => void;
    cb(null, { stdout, stderr: '' });
    return {} as ReturnType<typeof execFile>;
  });
}
```

**fs/promises (partial mock preserving real implementations):**
```typescript
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    readFile: vi.fn(),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
  };
});
```

### Mocking Internal Services

**Full module mock (all exports replaced):**
```typescript
vi.mock('../../src/services/capability.js', () => ({
  readProfile: vi.fn(),
  detectCapabilities: vi.fn(),
  writeProfile: vi.fn(),
}));
```

**Logger mock (returns stub child logger):**
```typescript
vi.mock('../../src/services/logger.js', () => ({
  childLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  })),
}));
```

### Mocking LanceDB Table

**Chain-mockable query builder pattern:**
```typescript
function makeMockTable(rows: Record<string, unknown>[]) {
  const toArray = vi.fn().mockResolvedValue(rows);
  const limit = vi.fn().mockReturnValue({ toArray });
  const distanceType = vi.fn().mockReturnValue({ limit });
  const nearestTo = vi.fn().mockReturnValue({ distanceType });
  const query = vi.fn().mockReturnValue({ nearestTo });
  return { query } as unknown as import('@lancedb/lancedb').Table;
}
```

### Mocking process.stderr/stdout/exit

**Standard pattern used in all workflow tests:**
```typescript
let stderrOutput: string[];
let stdoutOutput: string[];
let processExitSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  stderrOutput = [];
  stdoutOutput = [];

  vi.spyOn(process.stderr, 'write').mockImplementation((data: unknown) => {
    stderrOutput.push(String(data));
    return true;
  });
  vi.spyOn(process.stdout, 'write').mockImplementation((data: unknown) => {
    stdoutOutput.push(String(data));
    return true;
  });
  processExitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: unknown) => {
    throw new Error(`process.exit(${code})`);
  });
});
```

**Testing process.exit(1) calls:**
```typescript
it('exits with code 1 when Ollama is not installed', async () => {
  mockIsOllamaInstalled.mockResolvedValue(false);
  await expect(runInit()).rejects.toThrow('process.exit(1)');
  expect(processExitSpy).toHaveBeenCalledWith(1);
});
```

### What to Mock

- External service SDKs: `ollama`, `@anthropic-ai/sdk`, `@anthropic-ai/tokenizer`
- MCP SDK: `@modelcontextprotocol/sdk`
- LanceDB: `@lancedb/lancedb` (mock at module level or provide mock table objects)
- Node.js I/O: `node:child_process`, `node:fs/promises`
- Process globals: `process.stderr.write`, `process.stdout.write`, `process.exit`, `process.platform`
- All service-layer imports when testing workflow-layer code

### What NOT to Mock

- Pure logic functions: `classifyVRAMTier`, `selectEmbeddingModel`, `classifyQueryIntent`, `deduplicateChunks`
- Zod schemas (tested directly in `logger.test.ts`)
- tree-sitter chunking (tested with real parser in `chunker.test.ts`)
- File system operations in integration-style tests (`crawler.test.ts` uses real temp directories)

## Fixtures and Factories

**Test Data Helpers:**
```typescript
// Common pattern: factory function with partial overrides
function makeChunk(overrides: Partial<RetrievedChunk> = {}): RetrievedChunk {
  return {
    id: 'chunk-1',
    filePath: 'src/foo.ts',
    chunkType: 'function',
    scope: null,
    name: 'myFunction',
    content: 'function myFunction() {}',
    startLine: 10,
    endLine: 25,
    similarity: 0.9,
    ...overrides,
  };
}

// Inline factory for simple cases
const fakeChunk = (id: string) => ({
  id,
  filePath: `/project/src/${id}.ts`,
  chunkType: 'function',
  scope: null,
  name: `fn_${id}`,
  content: `function fn_${id}() {}`,
  startLine: 1,
  endLine: 5,
  similarity: 0.9,
});

// Shared mock profile object used across workflow tests
const mockProfile = {
  version: 1 as const,
  detectedAt: '2026-03-31T00:00:00.000Z',
  vramTier: 'large' as const,
  vramGiB: 16,
  gpuVendor: 'nvidia' as const,
  embeddingModel: 'nomic-embed-text',
  ollamaVersion: null,
  platform: 'linux',
};
```

**Location:**
- Test helpers and factories are defined inline within each test file (no shared test utilities directory)
- Mock profile and index state objects are duplicated across workflow test files

## Dynamic Imports for Module Reset

**Pattern used when testing modules with side effects (logger, MCP server):**
```typescript
// Use vi.resetModules() to clear module cache, then dynamic import
afterEach(() => {
  vi.resetModules();
});

it('BRAIN_CACHE_LOG=debug sets log level to debug', async () => {
  process.env.BRAIN_CACHE_LOG = 'debug';
  vi.resetModules();
  const { logger } = await import('../../src/services/logger.js');
  expect(logger.level).toBe('debug');
});
```

**Also used for workflow tests to ensure mocks are in place before module evaluation:**
```typescript
let runInit: () => Promise<void>;

beforeEach(async () => {
  // Set up mocks first
  mockDetectCapabilities.mockResolvedValue({ ...mockProfile });
  // Then dynamically import
  const mod = await import('../../src/workflows/init.js');
  runInit = mod.runInit;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});
```

## Coverage

**Requirements:** None enforced (no coverage thresholds configured)

**No coverage configuration in vitest.config.ts.** To add coverage:
```bash
npx vitest run --coverage
```

## Test Types

**Unit Tests (majority):**
- Test individual exported functions in isolation
- Mock all external dependencies
- Cover happy paths, edge cases, and error conditions
- Examples: `capability.test.ts`, `embedder.test.ts`, `retriever.test.ts`, `tokenCounter.test.ts`

**Integration-style Tests:**
- `tests/services/crawler.test.ts` creates real temp directories with real files and tests the full crawl pipeline
- `tests/services/chunker.test.ts` uses the real tree-sitter parser against sample source code strings
- No network calls or real database operations in any tests

**E2E Tests:**
- Not used. No end-to-end tests that run the full CLI or MCP server.

## Common Patterns

**Async Testing:**
```typescript
it('returns parsed CapabilityProfile from valid JSON file', async () => {
  mockReadFile.mockResolvedValue(JSON.stringify(profile) as unknown as Buffer);
  const result = await readProfile();
  expect(result).not.toBeNull();
  expect(result?.version).toBe(1);
});
```

**Error Testing:**
```typescript
it('exits with code 1 when Ollama is not installed', async () => {
  mockIsOllamaInstalled.mockResolvedValue(false);
  await expect(runInit()).rejects.toThrow('process.exit(1)');
  expect(processExitSpy).toHaveBeenCalledWith(1);
});
```

**Testing stderr output content:**
```typescript
it('prints install instructions to stderr when Ollama is not installed', async () => {
  mockIsOllamaInstalled.mockResolvedValue(false);
  try {
    await runInit();
  } catch {
    // expected - process.exit throws
  }
  const combined = stderrOutput.join('');
  expect(combined).toContain('Ollama is not installed');
});
```

**Testing zero stdout (D-16 compliance):**
```typescript
it('produces zero output on stdout', async () => {
  await runInit();
  expect(stdoutOutput).toHaveLength(0);
  expect(stdoutWriteSpy).not.toHaveBeenCalled();
});
```

**Fake timers for polling/retry:**
```typescript
it('spawns "ollama serve" detached and polls readiness', async () => {
  vi.useFakeTimers();
  const resultPromise = startOllama();
  await vi.runAllTimersAsync();
  const result = await resultPromise;
  expect(result).toBe(true);
});
```

**Testing pipeline call order:**
```typescript
it('calls pipeline in correct order: crawl -> chunk -> embed -> store -> writeIndexState', async () => {
  const callOrder: string[] = [];
  mockCrawlSourceFiles.mockImplementation(async () => { callOrder.push('crawl'); return fakeFiles; });
  mockChunkFile.mockImplementation((fp, _c) => { callOrder.push('chunk'); return [fakeChunk(fp, 1)]; });
  // ...
  await runIndex('/project');
  expect(callOrder[0]).toBe('crawl');
  expect(callOrder[callOrder.length - 1]).toBe('writeState');
});
```

## Test Gaps

**No tests for:**
- `src/cli/index.ts` -- CLI command registration and argument parsing are not tested
- `src/services/lancedb.ts` -- LanceDB connection, table creation, and insert operations are not unit tested (only mocked from workflow tests)
- Error propagation from tree-sitter parser failures in `src/services/chunker.ts`
- `tsup.config.ts` build output validation

**Limited coverage:**
- `src/mcp/index.ts` is tested via registered tool handler extraction, but not via actual MCP protocol transport
- `src/workflows/doctor.ts` tests are bundled inside `tests/workflows/init.test.ts` rather than having a dedicated file

---

*Testing analysis: 2026-04-01*
