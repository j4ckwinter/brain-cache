# Codebase Concerns

**Analysis Date:** 2026-04-01

## Tech Debt

**No incremental indexing:**
- Issue: `runIndex` in `src/workflows/index.ts` always re-indexes the entire codebase. There is no file-change detection, content hashing, or diffing against the previous index. Every `brain-cache index` run crawls all files, re-chunks, re-embeds, and overwrites the LanceDB table.
- Files: `src/workflows/index.ts` (lines 66-117)
- Impact: Re-indexing a large codebase is slow and burns GPU/CPU time unnecessarily. Users will avoid re-indexing, leading to stale indices.
- Fix approach: Store per-file content hashes in `index_state.json`. On re-index, compare hashes and only re-embed changed/new files. Delete removed files from the table using LanceDB's delete API.

**Hardcoded version strings:**
- Issue: The version `'0.1.0'` is hardcoded in three places instead of being sourced from `package.json`.
- Files: `src/cli/index.ts:8`, `src/mcp/index.ts:19`
- Impact: Version drift between `package.json` and runtime-reported versions after bumps.
- Fix approach: Import version from `package.json` or use a build-time constant injected by tsup.

**Hardcoded Ollama URL:**
- Issue: The Ollama server URL `http://localhost:11434` is hardcoded directly in `isOllamaRunning()`. Users running Ollama on a different host or port cannot configure the connection.
- Files: `src/services/ollama.ts:28`
- Impact: Cannot use remote Ollama instances or non-default ports.
- Fix approach: Read from `OLLAMA_HOST` environment variable (which Ollama's own CLI respects) with `http://localhost:11434` as fallback. The `ollama` npm package may already respect this env var for API calls, but the health check fetch does not.

**Empty barrel exports:**
- Issue: Three barrel export files exist with only `export {};` -- they export nothing and serve no purpose.
- Files: `src/tools/index.ts`, `src/services/index.ts`, `src/lib/index.ts`
- Impact: Misleading. Consumers importing from these barrels get nothing. Dead code that may confuse future contributors.
- Fix approach: Either populate with real re-exports or delete the files entirely.

**`any` types in tree-sitter and LanceDB interop:**
- Issue: Tree-sitter node types and LanceDB query results are typed as `any` because neither library ships usable TypeScript types for these interfaces.
- Files: `src/services/chunker.ts:85,90,123` (`node: any`), `src/services/retriever.ts:46-47` (`r: any`)
- Impact: No compile-time safety on AST node property access or LanceDB row shape. Typos in field names (e.g., `r._distance` vs `r.distance`) would not be caught.
- Fix approach: Define local interface types for tree-sitter nodes (`TreeSitterNode { type: string; parent: TreeSitterNode | null; childCount: number; ... }`) and LanceDB result rows (`ChunkQueryRow`). Cast at the boundary.

**Redundant token counting in index workflow:**
- Issue: `runIndex` counts tokens twice: once on raw file content (line 80) and again on each chunk's content (line 130-132). The second pass iterates all chunks a second time calling `countChunkTokens` for each.
- Files: `src/workflows/index.ts:77-87,130-132`
- Impact: Doubles tokenizer CPU time during indexing. The `@anthropic-ai/tokenizer` is a WASM module, so each call has non-trivial overhead.
- Fix approach: Accumulate chunk token counts during the chunking loop (step 7) and reuse them for the summary.

## Known Bugs

**Fragile model name prefix matching:**
- Symptoms: `pullModelIfMissing` and `runDoctor` check if a model exists using `m.name.startsWith(model)`. Ollama model names include a tag suffix (e.g., `nomic-embed-text:latest`), so `startsWith('nomic-embed-text')` works. But if a model named `nomic-embed-text-v2` existed, it would falsely match, and `startsWith` would fail for models specified with explicit tags like `nomic-embed-text:v1.5`.
- Files: `src/services/ollama.ts:75`, `src/workflows/doctor.ts:41-42`
- Trigger: User specifies a model with an explicit tag, or a model name that is a prefix of another model.
- Workaround: None currently.
- Fix: Normalize model names by stripping `:latest` from both sides before comparison, or compare `m.name === model` after appending `:latest` if no tag is present.

## Security Considerations

**API key handling:**
- Risk: `ANTHROPIC_API_KEY` is read directly from `process.env` with no sanitization. The key value is included in a stderr hint message (`export ANTHROPIC_API_KEY=sk-ant-...`), though this is just an example string.
- Files: `src/workflows/askCodebase.ts:32-36`
- Current mitigation: The key is passed to the Anthropic SDK constructor which reads `process.env.ANTHROPIC_API_KEY` by default. No key is logged or persisted.
- Recommendations: Ensure pino logger never logs request headers or environment variables. Consider masking the key in any future debug output.

**Detached Ollama process:**
- Risk: `startOllama()` spawns `ollama serve` as a detached, unref'd child process. If brain-cache crashes or is killed, the Ollama process remains running with no management. Multiple init calls could spawn multiple Ollama instances.
- Files: `src/services/ollama.ts:43-47`
- Current mitigation: `isOllamaRunning()` is checked before spawning. But a race condition exists if two init processes run simultaneously.
- Recommendations: Check if port 11434 is already bound before spawning. Consider writing a PID file to `.brain-cache/ollama.pid` for tracking.

## Performance Bottlenecks

**Sequential file I/O during indexing:**
- Problem: Files are read one at a time in a `for` loop with `await readFile()`.
- Files: `src/workflows/index.ts:77-87`
- Cause: Sequential `await` in the chunking loop means each file read waits for the previous to complete. File I/O is not CPU-bound, so parallelism is free.
- Improvement path: Use `Promise.all` with a concurrency limiter (e.g., batches of 10-20 files) to read and chunk files in parallel. The chunking (tree-sitter parse) is CPU-bound, so full parallelism may not help, but overlapping I/O with parsing would.

**In-memory chunk accumulation:**
- Problem: All chunks are accumulated in `allChunks: CodeChunk[]` before embedding begins. For large codebases, this array could consume significant memory.
- Files: `src/workflows/index.ts:75-87`
- Cause: The pipeline is designed as crawl-all -> chunk-all -> embed-in-batches rather than a streaming pipeline.
- Improvement path: Stream the pipeline: read a file, chunk it, and when a batch of N chunks is ready, embed and insert. This caps memory at roughly `DEFAULT_BATCH_SIZE` chunks.

**No vector index creation:**
- Problem: LanceDB tables are created and queried without explicitly creating a vector index. LanceDB performs brute-force scans by default on small tables, but this degrades as table size grows.
- Files: `src/services/lancedb.ts:99-104`
- Cause: The `createTable` call does not follow up with `createIndex`. LanceDB supports IVF-PQ indices for faster search.
- Improvement path: After indexing, call `table.createIndex('vector', { type: 'ivf_pq', ... })` if chunk count exceeds a threshold (e.g., 1000 chunks).

**Redundant separator token counting:**
- Problem: In `assembleContext`, `countChunkTokens(separator)` is called for every chunk after the first. The separator string `'\n\n---\n\n'` is constant, so its token count should be computed once.
- Files: `src/services/tokenCounter.ts:48`
- Cause: Oversight -- the separator cost is recalculated each iteration.
- Improvement path: Compute `sepCost` once outside the loop and reuse.

## Fragile Areas

**`process.exit(1)` throughout workflows:**
- Files: `src/workflows/index.ts:40,49`, `src/workflows/buildContext.ts:31,40,50,60`, `src/workflows/askCodebase.ts:37`, `src/workflows/status.ts:21,30`, `src/workflows/search.ts:27,36,46,56`, `src/workflows/doctor.ts:26`, `src/mcp/index.ts:273`
- Why fragile: Workflows call `process.exit(1)` on error conditions (no profile, Ollama not running, no index). This makes the functions untestable without mocking `process.exit`, prevents composition (a caller cannot catch errors), and kills the process in MCP server context. The MCP `doctor` tool has a comment explicitly noting it cannot call `runDoctor()` because of `process.exit`.
- Safe modification: Replace `process.exit(1)` with thrown errors (e.g., `throw new BrainCacheError('No profile found')`). Let the CLI entry point catch and exit. The MCP server already wraps calls in try/catch.
- Test coverage: Tests mock `process.exit` to throw, which works but is brittle.

**Tree-sitter CJS `require()` hack:**
- Files: `src/services/chunker.ts:1-11`
- Why fragile: The project is ESM (`"type": "module"` in `package.json`), but tree-sitter and its language bindings are CJS-only native modules. The code uses `createRequire(import.meta.url)` to bridge this gap. This works but breaks if the bundler (tsup) tries to resolve these requires, or if tree-sitter ships ESM in a future version.
- Safe modification: Do not change the require pattern without verifying the built output with `tsup`. If tree-sitter adds ESM support, switch to standard imports.
- Test coverage: Chunker tests exercise this code path indirectly and pass, confirming the CJS bridge works.

**Arrow function depth heuristic:**
- Files: `src/services/chunker.ts:159-172`
- Why fragile: Arrow functions are filtered by AST depth (depth <= 5 = top-level/exported, depth > 5 = nested callback). This heuristic is based on typical TypeScript AST shapes but is not guaranteed. Unusual nesting patterns (e.g., deeply nested export statements, or flat callback patterns) could be misclassified.
- Safe modification: Add test cases for edge-case nesting depths. Consider using parent node types (e.g., skip if parent chain contains `call_expression > arguments`) instead of raw depth counting.
- Test coverage: The test suite covers basic extraction but does not test the depth threshold boundary.

**Query intent classification by keyword matching:**
- Files: `src/services/retriever.ts:13-24`
- Why fragile: Diagnostic vs. knowledge intent is classified by checking if the query string contains any of a hardcoded keyword list (e.g., "why", "bug", "error"). The word "null" triggers diagnostic mode even for "how does the null coalescing operator work?" -- a knowledge query.
- Safe modification: Add exclusion patterns or use bigrams. Consider making the keyword list configurable.
- Test coverage: `tests/services/retriever.test.ts` likely tests this, but edge cases with false positives are not covered.

## Scaling Limits

**In-memory chunk accumulation:**
- Current capacity: Works for codebases with thousands of files (typical project).
- Limit: A monorepo with 50,000+ source files could produce hundreds of thousands of chunks, each holding full function source text. Memory usage could reach several GB.
- Scaling path: Stream the pipeline as described in Performance Bottlenecks. Process files in batches, embed and insert as you go, then discard chunks from memory.

**Single-table design in LanceDB:**
- Current capacity: All chunks go into one `chunks` table regardless of project.
- Limit: If brain-cache is used across multiple projects, each project gets its own `.brain-cache/index` directory (scoped by project root), so this is not a cross-project issue. However, within a large project, a single flat table with no partitioning may slow down as row count grows.
- Scaling path: Create a vector index (IVF-PQ) after initial load. Consider partitioning by file path prefix for very large codebases.

**Embedding batch size:**
- Current capacity: `DEFAULT_BATCH_SIZE = 32` chunks per Ollama embed call.
- Limit: Very large chunks (entire files via fallback) could exceed Ollama's context window (8192 tokens for nomic-embed-text). The embedder does not check or truncate input length.
- Scaling path: Truncate chunk content to the model's context window before embedding. Log a warning when truncation occurs.

## Dependencies at Risk

**`@anthropic-ai/tokenizer` v0.0.4:**
- Risk: Pre-1.0 package at version 0.0.4. The API could change without notice. It is a WASM-based tokenizer that may have compatibility issues with future Node.js versions.
- Impact: `countChunkTokens` in `src/services/tokenCounter.ts` depends on it. If it breaks, token budgeting and savings calculations fail.
- Migration plan: Anthropic's `messages.countTokens` API endpoint is an alternative but requires an API call. For local-only counting, monitor the package for updates or pin to a known-good version.

**Native tree-sitter modules:**
- Risk: `tree-sitter` v0.25.0 and its language bindings (`tree-sitter-typescript`, `tree-sitter-python`, `tree-sitter-go`, `tree-sitter-rust`) are native Node.js addons compiled with node-gyp. They require a C++ toolchain at install time, fail on some CI environments, and must be rebuilt for each Node.js major version.
- Impact: Installation failures on machines without build tools. Cannot use in environments where native compilation is restricted (e.g., some serverless platforms, Windows without Visual Studio build tools).
- Files: `src/services/chunker.ts:6-11`, `package.json` dependencies
- Migration plan: Consider `web-tree-sitter` (WASM-based) as a drop-in replacement. It is slower but has zero native dependencies. The API differs slightly (async initialization required).

**`@lancedb/lancedb` v0.27.1:**
- Risk: LanceDB is pre-1.0 and the API has changed between minor versions. The `@lancedb/lancedb` package also includes native Rust bindings via NAPI.
- Impact: API breaks on upgrades. Native build requirements similar to tree-sitter.
- Migration plan: Pin version strictly. Monitor changelogs before upgrading.

## Missing Critical Features

**No watch mode for indexing:**
- Problem: Users must manually run `brain-cache index` after code changes. There is no file watcher to auto-update the index.
- Blocks: Real-time index freshness. Users working in an editor get stale results without re-indexing.

**No system prompt for ask command:**
- Problem: `runAskCodebase` sends context and question to Claude without a system prompt. There is no instruction telling Claude to use the provided context, stay grounded, or format responses appropriately.
- Files: `src/workflows/askCodebase.ts:56-65`
- Blocks: Response quality. Claude may ignore the provided context or hallucinate beyond it.

**No re-ranking of retrieved chunks:**
- Problem: Retrieved chunks are ranked purely by vector cosine similarity. There is no cross-encoder re-ranking, keyword boosting, or recency weighting.
- Files: `src/services/retriever.ts:31-58`
- Blocks: Retrieval precision. Semantic similarity alone misses keyword-exact matches and may rank irrelevant but semantically similar chunks higher.

**No staleness detection:**
- Problem: `index_state.json` records `indexedAt` timestamp and file/chunk counts, but there is no mechanism to compare the index against current filesystem state. The `doctor` and `status` commands do not warn about stale indices.
- Files: `src/services/lancedb.ts:124-133`, `src/workflows/status.ts`, `src/workflows/doctor.ts`
- Blocks: Users have no signal that their index is outdated.

**No Markdown/text file support:**
- Problem: Only code files with tree-sitter grammars are indexed. Documentation files (`.md`, `.txt`, `.rst`) are excluded entirely.
- Files: `src/services/crawler.ts:9-15` (SOURCE_EXTENSIONS), `src/services/chunker.ts:17-30` (LANGUAGE_MAP)
- Blocks: Questions about project documentation, READMEs, or architecture docs return no results.

## Test Coverage Gaps

**No doctor workflow tests:**
- What's not tested: `runDoctor()` in `src/workflows/doctor.ts` has no dedicated test file.
- Files: `src/workflows/doctor.ts`
- Risk: The doctor command could break silently. It has a `process.exit(1)` call and does live Ollama queries.
- Priority: Medium -- doctor is a diagnostic tool, not a data path.

**No LanceDB service unit tests:**
- What's not tested: `src/services/lancedb.ts` functions (`openDatabase`, `openOrCreateChunkTable`, `insertChunks`, `readIndexState`, `writeIndexState`) have no direct unit tests. They are only tested indirectly through workflow tests that mock them entirely.
- Files: `src/services/lancedb.ts`
- Risk: Schema mismatches, table creation edge cases, and index state serialization bugs would not be caught. The `openOrCreateChunkTable` function has complex logic around model/dimension mismatch detection.
- Priority: High -- this is core data infrastructure.

**No integration or E2E tests:**
- What's not tested: The entire pipeline (crawl -> chunk -> embed -> store -> search -> assemble context) is never tested end-to-end. All workflow tests mock every service dependency.
- Files: All `tests/workflows/*.test.ts` files mock services completely.
- Risk: Integration bugs between services (e.g., schema mismatch between chunker output and LanceDB schema, vector dimension mismatches) would not be caught.
- Priority: High -- requires Ollama running and real LanceDB, so needs a dedicated test environment or CI setup.

**No MCP server integration tests:**
- What's not tested: `tests/mcp/server.test.ts` exists but the MCP tools are tested in isolation. No test exercises the full stdio transport with a real MCP client.
- Files: `src/mcp/index.ts`, `tests/mcp/server.test.ts`
- Risk: MCP protocol-level issues (serialization, transport errors) would not be caught.
- Priority: Medium -- MCP SDK handles protocol details, but tool registration and error handling should be tested.

**Arrow function depth heuristic untested at boundary:**
- What's not tested: The depth-5 threshold for filtering arrow functions is not directly tested. No test case verifies that a depth-6 arrow function is excluded or that a depth-5 one is included.
- Files: `src/services/chunker.ts:159-172`, `tests/services/chunker.test.ts`
- Risk: Refactoring the chunker could silently change which arrow functions are extracted.
- Priority: Low -- the current heuristic works for typical code patterns.

---

*Concerns audit: 2026-04-01*
