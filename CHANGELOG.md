# Changelog

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
