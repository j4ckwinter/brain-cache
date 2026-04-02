# Codebase Concerns

**Analysis Date:** 2026-04-01

## Tech Debt

**Tree-sitter CJS Interop Workaround:**
- Issue: `createRequire()` is used to load tree-sitter packages because they lack ESM entry points. This is a documented workaround but adds fragility during Node.js upgrades.
- Files: `src/services/chunker.ts` (lines 1-26)
- Impact: If tree-sitter ships ESM (tracked in >= 0.24.0) or Node changes CJS interop behavior, this breaks. The alternative (web-tree-sitter WASM) is explicitly out of scope.
- Fix approach: Monitor tree-sitter ESM support. When available, replace `createRequire` block with standard ESM imports.

**Parser Instantiation Per File:**
- Issue: `new Parser()` is called inside `chunkFile()` for every single file. For large repos (1000+ files), this creates and discards thousands of parser instances.
- Files: `src/services/chunker.ts` (line 165)
- Impact: Unnecessary GC pressure and object allocation during indexing. Not a correctness issue but a performance waste.
- Fix approach: Create one `Parser` instance per language and reuse across files. Store in a module-level `Map<object, Parser>` keyed by language object.

**MCP Server Module-Level Singleton:**
- Issue: The MCP server is instantiated at module scope (`const server = new McpServer(...)`) with all tools registered at import time. This makes testing difficult and prevents multiple server instances.
- Files: `src/mcp/index.ts` (line 22)
- Impact: The MCP test file (`tests/mcp/server.test.ts`) must work around the singleton pattern. Cannot run MCP server tests in parallel or test different configurations.
- Fix approach: Wrap server creation in a factory function `createMcpServer()` that returns the configured server instance.

**Duplicated Guard Logic Across MCP Tools:**
- Issue: Every MCP tool handler repeats the same `readProfile()` null check and `isOllamaRunning()` check. Four tools have eight identical guard blocks.
- Files: `src/mcp/index.ts` (lines 44-67, 121-144, 186-209)
- Impact: Maintenance burden. If guard logic changes (e.g., add a version check), four places need updating.
- Fix approach: Extract a `guardPrerequisites()` helper that returns an error response object or null, and call it at the top of each handler.

**Duplicated Boilerplate Across Workflows:**
- Issue: `runSearch`, `runBuildContext`, and `runIndex` all repeat the same sequence: read profile, check Ollama running, resolve path, read index state, open database. Five lines of identical setup.
- Files: `src/workflows/search.ts` (lines 22-53), `src/workflows/buildContext.ts` (lines 23-51), `src/workflows/index.ts` (lines 48-77)
- Impact: Same maintenance burden as MCP guards. Any change to the init sequence must be replicated across three files.
- Fix approach: Create a `prepareWorkflow(path?)` helper that returns `{ profile, rootDir, db, table, indexState }` or throws with a descriptive error.

**Redundant Token Counting in Index Workflow:**
- Issue: `runIndex` counts tokens on raw file content (line 196) and also counts tokens for each chunk's content in the embed loop (line 233). The chunk token count is computed twice: once in the oversized-chunk filter (line 219) and again for the running total (line 233).
- Files: `src/workflows/index.ts` (lines 196, 219, 233)
- Impact: Extra tokenizer calls during indexing. The `@anthropic-ai/tokenizer` is WASM-based, so each call has non-trivial overhead.
- Fix approach: Count tokens once per chunk during the filter step and reuse the value for the running total.

## Known Bugs

**Zero-Vector Chunks Pollute Search Results:**
- Symptoms: When a chunk exceeds the embedding model context length, it is stored with a zero vector (`new Array(dimension).fill(0)`). This chunk will still appear in vector search results with a non-trivial cosine distance, returning irrelevant content.
- Files: `src/services/embedder.ts` (line 108), `src/services/retriever.ts` (line 88)
- Trigger: Index a file with a function larger than ~1400 Anthropic tokens (roughly 100+ lines of dense code).
- Workaround: The distance threshold filter in `src/services/retriever.ts` (line 88) partially mitigates this, but zero vectors can still match within threshold for certain queries. Consider marking zero-vector chunks with a metadata flag and excluding them from search.

## Security Considerations

**No Path Traversal Validation on MCP Inputs:**
- Risk: The `path` parameter in MCP tools (`index_repo`, `search_codebase`, `build_context`, `doctor`) is passed directly to `resolve()` without validation. A malicious MCP client could pass paths like `/etc/` or `../../sensitive-dir` to index arbitrary filesystem locations.
- Files: `src/mcp/index.ts` (lines 42, 120, 185, 249)
- Current mitigation: Zod validates the input is a string, but does not restrict the path to safe directories. The crawler's extension filter (`src/services/crawler.ts`) limits what file types are read, which reduces impact.
- Recommendations: Add path validation that rejects absolute paths outside the current working directory, or at minimum validate the resolved path exists and is a directory. Consider a configurable allowlist of indexable roots.

**SQL Injection in LanceDB Delete Predicate:**
- Risk: `deleteChunksByFilePath` constructs a SQL-style predicate by escaping single quotes (`'` to `''`), but the escaping is minimal. If LanceDB's SQL parser has edge cases, crafted file paths could break the predicate.
- Files: `src/services/lancedb.ts` (lines 238-244)
- Current mitigation: File paths come from the filesystem crawler, not user input directly. The `crawlSourceFiles` function produces real file paths from `fast-glob`.
- Recommendations: Low priority since the attack surface is limited to file paths that exist on disk. Monitor LanceDB for parameterized query support.

**ANTHROPIC_API_KEY Exposure Surface:**
- Risk: The `ask` command requires `ANTHROPIC_API_KEY` in the environment. The logger has redaction rules for common key names, but the key could leak in stack traces or error messages if the Anthropic SDK throws with request details.
- Files: `src/workflows/askCodebase.ts` (line 39), `src/services/logger.ts` (lines 16-31)
- Current mitigation: Pino redaction covers `apiKey`, `api_key`, `token`, `authorization`, `ANTHROPIC_API_KEY`, and nested variants. The Anthropic SDK is instantiated without explicitly passing the key (uses env var auto-detection).
- Recommendations: Adequate for current scope. If adding more verbose error logging, ensure SDK error objects are not logged raw.

**Detached Ollama Process Management:**
- Risk: `startOllama()` spawns `ollama serve` as a detached, unref'd child process. Signal handlers for SIGINT/SIGTERM are registered to clean up, but only during the startup polling window. After startup succeeds, if brain-cache crashes, the Ollama process remains running with no management.
- Files: `src/services/ollama.ts` (lines 49-128)
- Current mitigation: Pre-spawn guard checks `isOllamaRunning()` before spawning. Signal handlers clean up during the poll window. Timeout path kills the spawned process.
- Recommendations: This is acceptable for a developer tool. The spawned Ollama server is useful to keep running. Document that `brain-cache init` may leave an Ollama process running.

## Performance Bottlenecks

**Sequential Chunk Deletion During Incremental Re-index:**
- Problem: When files change, their old chunks are deleted one file at a time in a serial loop using individual SQL predicates.
- Files: `src/workflows/index.ts` (lines 140-143)
- Cause: Each `deleteChunksByFilePath` call issues a separate LanceDB delete operation. For large changesets (100+ files changed), this creates 100+ sequential I/O operations.
- Improvement path: Batch deletions using an OR predicate: `file_path IN ('a', 'b', 'c')` in a single call, or use LanceDB's batch delete API if available.

**File-Level Token Counting in build_context:**
- Problem: `runBuildContext` reads entire source files from disk to estimate "tokens without brain-cache" for the reduction percentage calculation.
- Files: `src/workflows/buildContext.ts` (lines 79-88)
- Cause: Each unique file in the result set is read from disk and tokenized. For queries that match chunks across many files, this adds latency.
- Improvement path: Store file-level token counts in the index state or LanceDB metadata during indexing, then look them up instead of re-reading and re-tokenizing files.

**Embedding Is the Indexing Bottleneck (By Design):**
- Problem: Embedding batches are processed sequentially (one batch at a time), which is correct for GPU memory management but slow for large repos.
- Files: `src/workflows/index.ts` (lines 208-253)
- Cause: Ollama processes one batch at a time on the GPU. The `DEFAULT_BATCH_SIZE` of 32 is a reasonable tradeoff.
- Improvement path: Limited without GPU parallelism. Could pipeline: while batch N embeds on GPU, read and chunk batch N+1 on CPU. Current architecture reads all files first then embeds, which is close to optimal for the current scale.

## Fragile Areas

**Chunker Arrow Function Detection:**
- Files: `src/services/chunker.ts` (lines 183-195)
- Why fragile: Arrow function extraction relies on exact parent chain matching: `variable_declarator > lexical_declaration > (program | export_statement)`. Any change in tree-sitter's AST structure (e.g., new wrapper nodes for decorators or TypeScript 5.x features) silently drops chunks instead of failing loudly.
- Safe modification: Always add new parent patterns to the `isTopLevelConst` check. Never remove existing patterns without verifying against all supported tree-sitter grammar versions.
- Test coverage: `tests/services/chunker.test.ts` covers basic arrow function cases but does not test edge cases like `export default` arrow functions or `declare const`.

**Embedding Dimension Hardcoding:**
- Files: `src/lib/config.ts` (lines 9-12)
- Why fragile: `EMBEDDING_DIMENSIONS` maps model names to dimensions. If a user configures a model not in this map (e.g., a custom Ollama model), the code falls back to 768 with a stderr warning (`src/workflows/index.ts` lines 68-73). However, if the model actually has different dimensions, the LanceDB schema will be wrong and inserts will fail with cryptic Arrow errors.
- Safe modification: Query the model's actual embedding dimensions from Ollama at init time (via a test embed call) instead of maintaining a hardcoded map.
- Test coverage: The fallback path has no dedicated test.

**IVF-PQ Index Parameters:**
- Files: `src/services/lancedb.ts` (lines 133-172)
- Why fragile: `numPartitions: 256` is hardcoded, which requires at least 256 rows per partition for good recall. For tables near the 10,000-row threshold, this means the index may have poor recall (only ~39 rows per partition).
- Safe modification: Scale `numPartitions` based on actual row count: `Math.min(256, Math.floor(Math.sqrt(rowCount)))`.
- Test coverage: `tests/services/lancedb.test.ts` tests the threshold check but does not verify index quality or parameter appropriateness.

**Query Intent Classification by Keyword Matching:**
- Files: `src/services/retriever.ts` (lines 26-66)
- Why fragile: Diagnostic vs. knowledge intent is classified by checking if the query string contains keywords from a hardcoded list (e.g., "why", "bug", "error", "null"). Exclusion patterns exist but false positives are still possible (e.g., "how does the null coalescing operator work?" triggers diagnostic mode via "null").
- Safe modification: Add more exclusion patterns as edge cases surface. The bigram and exclusion approach is reasonable but requires ongoing curation.
- Test coverage: `tests/services/retriever.test.ts` tests classification but may not cover all false-positive edge cases.

## Scaling Limits

**In-Memory File Content Map:**
- Current capacity: All file contents are loaded into a `Map<string, string>` during indexing (`src/workflows/index.ts` lines 89-104). Works fine for typical projects (hundreds of files).
- Limit: For very large repos (10,000+ files or files over 1MB each), this can consume several GB of memory.
- Scaling path: Process files in smaller groups and release content from the map after chunking. The `FILE_READ_CONCURRENCY` grouping is already present but the map retains all content until the end.

**File Hash Manifest as Single JSON File:**
- Current capacity: `file-hashes.json` stores one entry per indexed file. At 10,000 files, this is roughly 1MB of JSON.
- Limit: At 100,000+ files, parsing and writing this file becomes slow (100ms+ for JSON.parse/stringify).
- Files: `src/services/lancedb.ts` (lines 206-232)
- Scaling path: Switch to a SQLite or LanceDB metadata table for hash storage.

**Single LanceDB Table Design:**
- Current capacity: All chunks go into one `chunks` table per project.
- Limit: LanceDB handles large tables well with IVF-PQ indexing, but brute-force search (used below 10,000 rows) scales linearly.
- Scaling path: The 10,000-row threshold for IVF-PQ creation (`src/services/lancedb.ts` line 139) is appropriate. For very large projects, consider lowering the threshold.

## Dependencies at Risk

**tree-sitter Native Addon:**
- Risk: tree-sitter and its language grammars are native Node.js addons (C/C++ compiled via node-gyp). They require a working C++ toolchain at install time and break on Node.js major version bumps until prebuilt binaries are published.
- Impact: `npm install` fails on machines without build tools. Docker containers need `build-essential` or equivalent.
- Files: `src/services/chunker.ts` (lines 1-26), `package.json` dependencies
- Migration plan: web-tree-sitter (WASM) is the long-term alternative but currently out of scope. Pin tree-sitter versions carefully and test on new Node.js versions before upgrading.

**@anthropic-ai/tokenizer v0.0.4:**
- Risk: Pre-1.0 package at version 0.0.4. The API could change without notice. If Anthropic changes their tokenizer, counts will diverge from actual API token usage.
- Impact: Token budget calculations in `src/services/tokenCounter.ts` depend on it. If it breaks, context assembly produces incorrectly sized blocks.
- Migration plan: Monitor for updates. The Anthropic `messages.countTokens` API endpoint is an alternative but requires an API call (contradicts local-only philosophy). Pin to known-good version.

**@lancedb/lancedb v0.27.1 (pre-1.0):**
- Risk: LanceDB is pre-1.0 and the API has changed significantly between minor versions (the old `vectordb` package was deprecated entirely). Also includes native Rust bindings via NAPI.
- Impact: API breaks on upgrades could require migration code for existing `.brain-cache/index/` data.
- Migration plan: Pin version strictly. The `version: 1` field in `index_state.json` provides a migration path. When upgrading LanceDB, bump the state version and add migration logic.

## Missing Critical Features

**No Index Staleness Detection:**
- Problem: The MCP tools and CLI do not warn when the index is stale (files modified since last index). A developer can modify code, then search/build-context and get results from the old index.
- Blocks: Users may not realize their search results are outdated, leading to incorrect context being sent to Claude.
- Files: `src/workflows/search.ts`, `src/workflows/buildContext.ts`, `src/workflows/status.ts`
- Fix approach: Compare `indexState.indexedAt` against the most recent file modification time in the project. Emit a warning in search/build-context output if the index is older than the newest source file.

**No Concurrent Access Protection:**
- Problem: If two processes (e.g., CLI and MCP server) run `index` simultaneously on the same project, they will both write to the same LanceDB database and `file-hashes.json`, potentially corrupting data.
- Blocks: Running the MCP server alongside CLI commands on the same project is unsafe.
- Files: `src/services/lancedb.ts`, `src/workflows/index.ts`
- Fix approach: Use a lockfile (`<project>/.brain-cache/index.lock`) with advisory locking via `proper-lockfile` or similar.

**No Markdown/Documentation File Support:**
- Problem: Only code files with tree-sitter grammars are indexed (`.ts`, `.tsx`, `.js`, `.jsx`, `.py`, `.go`, `.rs`). Documentation files (`.md`, `.txt`, `.rst`) are excluded entirely.
- Files: `src/services/crawler.ts` (lines 9-15, `SOURCE_EXTENSIONS`), `src/services/chunker.ts` (line 32, `LANGUAGE_MAP`)
- Blocks: Questions about project documentation, READMEs, or architecture docs return no results.
- Fix approach: Add a line-based chunker fallback for non-AST files. Chunk by paragraph or heading boundary for Markdown.

**No Watch Mode for Indexing:**
- Problem: Users must manually run `brain-cache index` after code changes. There is no file watcher to auto-update the index.
- Blocks: Real-time index freshness for active development.
- Fix approach: Use `chokidar` or Node.js `fs.watch` to monitor source files and trigger incremental re-indexing on change.

## Test Coverage Gaps

**No Doctor Workflow Test:**
- What's not tested: `src/workflows/doctor.ts` has no corresponding test file in `tests/workflows/`.
- Files: `src/workflows/doctor.ts`
- Risk: Doctor output formatting or Ollama integration could break without detection.
- Priority: Low (doctor is a diagnostic command, not a data path).

**No CLI Integration Tests:**
- What's not tested: `src/cli/index.ts` has no test file. Commander argument parsing, option coercion (e.g., `parseInt(opts.limit, 10)`), and error handling are untested.
- Files: `src/cli/index.ts`
- Risk: CLI regressions (wrong option names, missing arguments, NaN from parseInt on non-numeric input) are only caught by manual testing.
- Priority: Medium (CLI is a primary user interface).

**No End-to-End Pipeline Test:**
- What's not tested: There is no test that runs the full pipeline: init -> index -> search -> build_context with real tree-sitter parsing and in-memory LanceDB.
- Risk: Integration bugs between services (e.g., chunker output shape vs. LanceDB schema, vector dimension mismatches between embedder and retriever) are only caught if individual unit tests happen to exercise the boundary.
- Priority: Medium (would catch schema mismatches and data flow issues).

**Embedding Dimension Fallback Not Tested:**
- What's not tested: The code path where an unknown embedding model falls back to 768 dimensions (`src/workflows/index.ts` lines 68-73).
- Files: `src/workflows/index.ts`
- Risk: If the fallback logic has a bug, users with custom models hit a runtime error.
- Priority: Low (affects only custom model configurations).

---

*Concerns audit: 2026-04-01*
