# Changelog

## 4.1.1 — 2026-11-09

- Fix indexing in global installs. Since 4.0, brain-cache overrode `apache-arrow` to 21, outside the `<=18.1.0` range LanceDB supports. Global installs apply that override to LanceDB, so `brain-cache index` failed with "Failed to read IPC file". Local installs keep LanceDB on its own compatible Arrow copy.
- Distribution checks now write and search a LanceDB table from local and global tarball installs, and can be run on Windows.

Reinstall with `npm install -g brain-cache@4.1.1`. Source and the index format are unchanged.

## 4.1.0 — 2026-11-06

- Publish complete index generations atomically, leaving the previous index available when a refresh fails.
- Keep in-flight search and context requests on one snapshot, with reader tracking across processes.
- Reuse unchanged indexes without copying storage when Git-history ingestion is disabled; verify content hashes with `--verify`.
- Automatically retain the active and previous generations, plus older snapshots still used by readers. Collect released snapshots on the next index run.
- Resolve unambiguous local JavaScript and TypeScript function calls for context expansion. Imports, cross-file calls, and dynamic calls remain unresolved.
- Share retrieval and fallback decisions, isolate Claude setup installation, and centralize indexing state and metadata assembly.

Stop older indexers before upgrading and restart MCP clients afterward. The next successful index run migrates legacy storage and rebuilds the chunk format. Published 4.0.9 and earlier clients can otherwise continue reading stale legacy data. Legacy and unmarked generations remain until explicit `brain-cache clean`; stop active searches before cleaning, then reindex. Downgrading requires cleaning and reindexing with the older version.

## 4.0.9 — 2026-10-30

- Coordinate cleanup and indexing with a lifecycle lock outside index storage.
- Typecheck test fixtures alongside production source and repair outdated mock contracts.
- Backfill missing token counts for unchanged files without re-embedding them.
- Use one history and metadata finalization path for all indexing runs.
- Share crawler and watcher exclusions, honor both ignore files, and reload watch policies when they change.
- Correct manual MCP setup and refresh development and packaged skill guidance.
- Run package-install smoke tests as a separate required CI step.

When upgrading, stop older running indexers before using cleanup: older binaries do not honor the new external lifecycle lock.

## 4.0.8 — 2026-10-30

- Honor `OLLAMA_HOST` for model, embedding, and doctor requests.
- Retry files that failed parsing and avoid duplicate chunks after interrupted indexing.
- Preserve user commands that share a hook entry with brain-cache during initialization.
- Retain named declarations alongside functions in TypeScript, Python, Go, and Rust source files.
- Stream only ranking metadata when calculating context token savings.
- Isolate cleanup tests from the working repository index.
- Correct document source locations, including frontmatter, CRLF, and paragraph splits.
- Rebuild older chunk formats on the next indexing run to apply declaration and document fixes.

## 4.0.7 — 2026-10-30

- Give same-line and nested code chunks distinct, deterministic structural IDs so retrieval does not discard valid chunks.
- Associate calls with their actual enclosing chunk, and retain names for top-level arrow functions.
- Clarify that general dependency resolution and import expansion are not yet implemented.
- Rebuild older chunk formats automatically on the next indexing run, then resume incremental indexing. Interrupted rebuilds retry on the next run.

## 4.0.6 — 2026-10-30

- Retrieve exact symbol names independently of vector and broad keyword candidate limits, prioritize them, and keep final result limits.
- Preserve camelCase boundaries when computing symbol-name relevance.

## 4.0.5 — 2026-10-30

- Reject malformed, nonpositive, fractional, and unsafe CLI limits and token budgets before running workflows.

## 4.0.4 — 2026-10-30

- Build context from an existing index with keyword fallback when Ollama is unavailable, and label fallback results in CLI and MCP output.
- Bound Ollama health checks and cancel their requests after completion or timeout.
- Return MCP errors when automatic indexing fails instead of rejecting the tool handler.

## 4.0.3 — 2026-10-30

- Match keyword fallback queries without case sensitivity across symbols, file paths, and content.
- Keep content-only keyword matches while prioritizing symbol and path matches.

## 4.0.2 — 2026-10-30

- Apply the approximate context budget to source and Git history together, and report token estimates for the complete returned context.
- Skip oversized retrieval candidates so smaller relevant chunks can still fit.

## 4.0.1 — 2026-10-30

- Raised the minimum Zod dependency to 4.6.7 to address the oversized-collection memory exhaustion advisory.
- Removed obsolete GSD workflow requirements from repository instructions.

This is the first npm release of the 4.x changes described below.

## 4.0.0 — 2026-10-24

### Runtime requirement

Node.js 22.12.0 or newer is required. This replaces the previous package manifest's Node 20 minimum. CI verifies Node 22.12.0 and Node 24 on Linux and macOS.

### Fixes

- Forced indexing replaces stored chunks and call edges instead of appending duplicates.
- Embedding-model and legacy-schema changes invalidate the file manifest and rebuild unchanged files. Interrupted rebuilds retry from a clean state.
- Removing the last source file clears stale index contents and metadata.
- Index locks use atomic acquisition and ownership-aware release across processes.
- Watch mode queues edits made during indexing and retries busy indexes without requiring another edit.
- Initialization configures MCP using the actual installed package and Node executable, supporting global and local installations and paths containing spaces.
- The `ask` command defaults to the supported `claude-sonnet-4-6` model. `BRAIN_CACHE_CLAUDE_MODEL` still overrides it.
- CLI, MCP, and status-line token figures are labeled as estimates. `ask` reports actual whole-request API usage separately.

### Maintenance

- Updated security-affected dependencies and transitive packages while retaining the existing LanceDB and parser/WASM versions.
- Added CI type checks, tests, and dependency auditing.
- Added local/global tarball-install checks for the CLI launcher, MCP initialization/tool listing, and all five bundled parser grammars.

### Upgrading

Use Node 22.12.0 or newer. Re-run `brain-cache init` to refresh MCP configuration and the unmodified bundled status-line script; customized status-line scripts are preserved. If prior forced indexing created duplicate results, run `brain-cache index --force` once after upgrading.

Indexing, search, and context assembly remain local. Token budgets are approximate and do not include the full conversation or MCP framing; the tokenizer is not accurate for modern Claude billing counts.
