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
  define: {
    __BRAIN_CACHE_VERSION__: JSON.stringify('0.0.0-test'),
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
```

**Key settings:**
- Globals enabled (describe, it, expect available without import) -- but tests explicitly import them from `vitest` anyway
- Node.js environment (not jsdom)
- Tests in separate `tests/` directory (not co-located with source)
- `__BRAIN_CACHE_VERSION__` defined as `'0.0.0-test'` for build-time injection compatibility

## Test File Organization

**Location:** Separate `tests/` directory mirroring `src/` structure

**Naming:** `{module}.test.ts` matching the source file name

**Structure:**
```
tests/
├── mcp/
│   └── server.test.ts          # MCP tool handler tests (src/mcp/index.ts)
├── services/
│   ├── capability.test.ts      # Hardware detection, profile read/write (src/services/capability.ts)
│   ├── chunker.test.ts         # AST parsing, multi-language (src/services/chunker.ts)
│   ├── crawler.test.ts         # File crawling with real temp dirs (src/services/crawler.ts)
│   ├── embedder.test.ts        # Embedding with retry/timeout (src/services/embedder.ts)
│   ├── lancedb.test.ts         # File hash read/write, delete chunks (src/services/lancedb.ts)
│   ├── logger.test.ts          # Log levels, redaction, config constants, Zod schemas
│   ├── ollama.test.ts          # Ollama install/run/start/pull/version (src/services/ollama.ts)
│   ├── retriever.test.ts       # Search, dedup, intent classification (src/services/retriever.ts)
│   └── tokenCounter.test.ts    # Token counting, context assembly (src/services/tokenCounter.ts)
└── workflows/
    ├── askCodebase.test.ts     # Ask workflow (src/workflows/askCodebase.ts)
    ├── buildContext.test.ts    # Context build workflow (src/workflows/buildContext.ts)
    ├── index.test.ts           # Index workflow (src/workflows/index.ts)
    ├── init.test.ts            # Init + Doctor workflows (src/workflows/init.ts, doctor.ts)
    ├── search.test.ts          # Search workflow (src/workflows/search.ts)
    └── status.test.ts          # Status workflow (src/workflows/status.ts)
```

**Total: 16 test files, 225 tests passing (13 currently failing due to missing `countRows` mock in search tests)**

## Test Structure

**Suite Organization:**
```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// 1. Module-level vi.mock() calls BEFORE any imports of mocked modules
vi.mock('../../src/services/capability.js', () => ({
  readProfile: vi.fn(),
  writeProfile: vi.fn(),
}));

// 2. Import the module under test and its mocked dependencies
import { readProfile } from '../../src/services/capability.js';

// 3. Create typed mock references with vi.mocked()
const mockReadProfile = vi.mocked(readProfile);

// 4. Shared test fixtures and constants at module scope
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

// 5. Test suites grouped by exported function name
describe('functionName', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // Set up happy-path defaults
    mockReadProfile.mockResolvedValue({ ...mockProfile });
    // Dynamic import after mocks for workflow tests
    const mod = await import('../../src/workflows/init.js');
    runInit = mod.runInit;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('describes expected behavior', async () => { ... });
});
```

**Conventions:**
- Each `describe` block corresponds to one exported function
- `beforeEach` sets up happy-path mocks; individual tests override for edge cases
- Tests follow arrange-act-assert
- Test descriptions are behavior-focused: `'returns true when "which ollama" succeeds'`
- Mock objects spread with `{ ...mockProfile }` to avoid cross-test mutation

## Mocking

**Framework:** vitest built-in `vi.mock()`, `vi.fn()`, `vi.mocked()`, `vi.spyOn()`

### Mocking External Packages

**Ollama SDK (`tests/services/embedder.test.ts`, `tests/services/ollama.test.ts`):**
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

**Anthropic Tokenizer (`tests/services/tokenCounter.test.ts`):**
```typescript
vi.mock('@anthropic-ai/tokenizer', () => ({
  countTokens: vi.fn((text: string) => text.split(/\s+/).filter(Boolean).length),
}));
```

**MCP SDK (`tests/mcp/server.test.ts`):**
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

**child_process with promisify (`tests/services/capability.test.ts`, `tests/services/ollama.test.ts`):**
```typescript
vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
  spawn: vi.fn(),
}));

// Helper to mock callback-based execFile (which gets promisified in source)
function mockExecFileSuccess(stdout: string) {
  mockExecFile.mockImplementation((...args: unknown[]) => {
    const cb = args[args.length - 1] as (err: null, result: { stdout: string; stderr: string }) => void;
    cb(null, { stdout, stderr: '' });
    return {} as ReturnType<typeof execFile>;
  });
}

function mockExecFileFailure(errorMessage = 'Command not found') {
  mockExecFile.mockImplementation((...args: unknown[]) => {
    const cb = args[args.length - 1] as (err: Error) => void;
    cb(new Error(errorMessage));
    return {} as ReturnType<typeof execFile>;
  });
}
```

**fs/promises partial mock (`tests/services/capability.test.ts`, `tests/workflows/buildContext.test.ts`):**
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

### Mocking Internal Services (Workflow Tests)

**Full module mock -- all exports replaced with vi.fn():**
```typescript
vi.mock('../../src/services/capability.js', () => ({
  readProfile: vi.fn(),
  detectCapabilities: vi.fn(),
  writeProfile: vi.fn(),
}));
```

**Logger mock -- returns stub child logger:**
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

**Constants with inline values (retrieval strategies):**
```typescript
vi.mock('../../src/services/retriever.js', () => ({
  searchChunks: vi.fn(),
  deduplicateChunks: vi.fn(),
  classifyQueryIntent: vi.fn(),
  RETRIEVAL_STRATEGIES: {
    diagnostic: { limit: 20, distanceThreshold: 0.4 },
    knowledge: { limit: 10, distanceThreshold: 0.3 },
  },
}));
```

### Mocking LanceDB Table

**Chain-mockable query builder (`tests/services/retriever.test.ts`):**
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

**Simple mock table for workflow tests:**
```typescript
const mockTable = {} as any;
const mockDb = {
  tableNames: vi.fn().mockResolvedValue(['chunks']),
  openTable: vi.fn().mockResolvedValue(mockTable),
} as any;
```

### Mocking process.stderr/stdout/exit

**Standard pattern used in all workflow tests:**
```typescript
let stderrOutput: string[];
let stdoutOutput: string[];
let stderrWriteSpy: ReturnType<typeof vi.spyOn>;
let stdoutWriteSpy: ReturnType<typeof vi.spyOn>;
let processExitSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  stderrOutput = [];
  stdoutOutput = [];
  stderrWriteSpy = vi.spyOn(process.stderr, 'write').mockImplementation((data: unknown) => {
    stderrOutput.push(String(data));
    return true;
  });
  stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation((data: unknown) => {
    stdoutOutput.push(String(data));
    return true;
  });
  processExitSpy = vi.spyOn(process, 'exit').mockImplementation((_code?: unknown) => {
    throw new Error(`process.exit(${_code})`);
  });
});
```

### Mocking process.platform

**Used in `tests/services/capability.test.ts`:**
```typescript
const originalPlatform = process.platform;

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
});

it('returns null on non-darwin platform', async () => {
  Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
  const result = await detectAppleSiliconVRAM();
  expect(result).toBeNull();
});
```

### Mocking fetch (global)

**Used in `tests/services/ollama.test.ts`:**
```typescript
vi.stubGlobal('fetch', vi.fn());
const mockFetch = vi.fn().mockResolvedValue({ ok: true } as Response);
vi.stubGlobal('fetch', mockFetch);

afterEach(() => {
  vi.unstubAllGlobals();
});
```

### What to Mock

- External SDKs: `ollama`, `@anthropic-ai/sdk`, `@anthropic-ai/tokenizer`
- MCP SDK: `@modelcontextprotocol/sdk/server/mcp.js`, `@modelcontextprotocol/sdk/server/stdio.js`
- LanceDB: `@lancedb/lancedb` (mock at module level or provide mock table objects)
- Node.js I/O: `node:child_process`, `node:fs/promises`
- Process globals: `process.stderr.write`, `process.stdout.write`, `process.exit`, `process.platform`
- All service-layer imports when testing workflow-layer code

### What NOT to Mock

- Pure logic functions: `classifyVRAMTier`, `selectEmbeddingModel`, `classifyQueryIntent`, `deduplicateChunks`, `modelMatches`
- Zod schemas (tested directly with `.parse()` and `.safeParse()`)
- tree-sitter chunking (`tests/services/chunker.test.ts` uses real parser against sample code strings)
- File system in integration-style tests (`tests/services/lancedb.test.ts` uses real temp directories)

## Fixtures and Factories

**Factory function with partial overrides (`tests/services/tokenCounter.test.ts`, `tests/services/retriever.test.ts`):**
```typescript
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
```

**Inline factory for simple cases (workflow tests):**
```typescript
const fakeChunk = (id: string, filePath: string) => ({
  id,
  filePath,
  chunkType: 'function',
  scope: null,
  name: `fn_${id}`,
  content: `function fn_${id}() {}`,
  startLine: 1,
  endLine: 5,
  similarity: 0.85,
});
```

**Shared mock objects duplicated across workflow tests:**
```typescript
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

const mockIndexState = {
  version: 1 as const,
  embeddingModel: 'nomic-embed-text',
  dimension: 768,
  indexedAt: '2026-03-31T00:00:00.000Z',
  fileCount: 5,
  chunkCount: 20,
};
```

**Location:**
- All test helpers and factories defined inline within each test file
- No shared test utilities directory -- mock objects are duplicated across workflow test files

## Dynamic Imports for Module Reset

**Pattern used when testing modules with side effects (logger, MCP server, workflows):**
```typescript
let runInit: () => Promise<void>;

beforeEach(async () => {
  // Set up mocks first
  mockDetectCapabilities.mockResolvedValue({ ...mockProfile });
  // Then dynamically import so mocks are in place before module evaluation
  const mod = await import('../../src/workflows/init.js');
  runInit = mod.runInit;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();  // Critical: clears module cache for next import
});
```

**For environment-dependent modules (`tests/services/logger.test.ts`):**
```typescript
it('BRAIN_CACHE_LOG=debug sets log level to debug', async () => {
  process.env.BRAIN_CACHE_LOG = 'debug';
  vi.resetModules();
  const { logger } = await import('../../src/services/logger.js');
  expect(logger.level).toBe('debug');
});
```

## Coverage

**Requirements:** None enforced (no coverage thresholds configured in `vitest.config.ts`)

**To run with coverage:**
```bash
npx vitest run --coverage
```

## Test Types

**Unit Tests (majority of test suite):**
- Test individual exported functions in isolation
- Mock all external dependencies
- Cover happy paths, edge cases, and error conditions
- Files: `capability.test.ts`, `embedder.test.ts`, `retriever.test.ts`, `tokenCounter.test.ts`, `ollama.test.ts`, all workflow tests

**Integration-style Tests (with real I/O):**
- `tests/services/lancedb.test.ts` -- creates real temp directories, reads/writes real files for hash manifest tests
- `tests/services/chunker.test.ts` -- uses real tree-sitter parser against sample TypeScript, Python, Go, and Rust code strings
- `tests/services/crawler.test.ts` -- creates real temp directories with real files and tests the full crawl pipeline

**E2E Tests:**
- Not used. No end-to-end tests that run the full CLI or MCP server.

## Common Test Patterns

**Async function testing:**
```typescript
it('returns parsed CapabilityProfile from valid JSON file', async () => {
  mockReadFile.mockResolvedValue(JSON.stringify(profile) as unknown as Buffer);
  const result = await readProfile();
  expect(result).not.toBeNull();
  expect(result?.version).toBe(1);
});
```

**Testing thrown errors:**
```typescript
it('throws when no profile found', async () => {
  mockReadProfile.mockResolvedValue(null);
  await expect(runBuildContext('test query')).rejects.toThrow("No profile found. Run 'brain-cache init' first.");
});
```

**Testing process.exit(1) via spy:**
```typescript
it('throws an error when Ollama is not installed', async () => {
  mockIsOllamaInstalled.mockResolvedValue(false);
  await expect(runInit()).rejects.toThrow('Ollama is not installed');
});
```

**Testing stderr output content:**
```typescript
it('prints install instructions to stderr', async () => {
  mockIsOllamaInstalled.mockResolvedValue(false);
  try { await runInit(); } catch { /* expected */ }
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
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

it('retries once on ECONNRESET then succeeds', async () => {
  mockOllama.embed
    .mockRejectedValueOnce(new Error('ECONNRESET'))
    .mockResolvedValueOnce({ embeddings: [[0.7, 0.8, 0.9]], ... });

  vi.useFakeTimers();
  const resultPromise = embedBatchWithRetry('nomic-embed-text', ['hello']);
  await vi.advanceTimersByTimeAsync(6000);  // Advance past 5s retry delay
  const result = await resultPromise;

  expect(mockOllama.embed).toHaveBeenCalledTimes(2);
  expect(result).toEqual([[0.7, 0.8, 0.9]]);
});
```

**Testing MCP tool handlers via captured registrations:**
```typescript
it('returns JSON with status on success', async () => {
  mockRunIndex.mockResolvedValue(undefined);
  mockReadIndexState.mockResolvedValue({ ...mockIndexState });

  const { handler } = registeredTools.get('index_repo')!;
  const result = await handler({ path: '/some/project' });

  expect(result.isError).toBeUndefined();
  const parsed = JSON.parse(result.content[0].text);
  expect(parsed.status).toBe('ok');
  expect(parsed.fileCount).toBe(5);
});
```

**Real temp directory tests (`tests/services/lancedb.test.ts`):**
```typescript
let testDir: string;

beforeEach(async () => {
  testDir = join(tmpdir(), `lancedb-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(join(testDir, '.brain-cache'), { recursive: true });
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});
```

## Test Gaps

**No tests for:**
- `src/cli/index.ts` -- CLI command registration and argument parsing not tested
- LanceDB connection, table creation, schema creation, vector index creation in `src/services/lancedb.ts`
- Error propagation from tree-sitter parser failures in `src/services/chunker.ts`
- Build output validation (`tsup.config.ts`)

**Limited coverage:**
- `src/mcp/index.ts` tested via extracted handler functions, not actual MCP protocol transport
- `src/workflows/doctor.ts` tests bundled inside `tests/workflows/init.test.ts` (not a dedicated file)
- `tests/workflows/search.test.ts` has 2 failing tests (missing `countRows` mock on table object)

**Shared fixtures opportunity:**
- `mockProfile`, `mockIndexState`, `fakeChunk` are duplicated across 6+ workflow test files
- Could be extracted to a `tests/fixtures/` directory

---

*Testing analysis: 2026-04-01*
