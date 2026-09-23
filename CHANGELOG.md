# Changelog

## 3.7.0

- Requires Node.js 22.12 or newer and tests Node 22.12 and 24 on Windows,
  macOS, and Linux.
- Updates Anthropic, LanceDB, Pino, Marked, Commander, MCP, Vitest, and their
  security-sensitive transitive dependencies.
- Advances the derived index format to version 2 and provides a safe reindex
  path for older indexes.
- Adds a checked-in retrieval fixture and `npm run eval:retrieval` for live and
  deterministic evaluation reports.
- Keeps `web-tree-sitter` 0.25 pending compatible 0.27 grammar WASM artifacts.

## 3.6.3

- Replaces shell-dependent WASM copying and package inspection with portable
  Node scripts.
- Makes path protection, status-line execution, tests, and generated-template
  comparisons platform-aware.
- Adds `npm run verify:dist` and a six-job cross-platform CI matrix.
- Refreshes dependencies within their existing major-version ranges and gates
  releases on high or critical production advisories.
