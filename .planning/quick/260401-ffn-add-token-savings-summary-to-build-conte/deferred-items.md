# Deferred Items — 260401-ffn

Pre-existing test failures discovered during full suite run. These were present before this plan's changes and are out of scope.

## Pre-existing Test Failures (out of scope)

| File | Failure | Root Cause |
|------|---------|------------|
| tests/services/chunker.test.ts | invalid ELF header for tree_sitter_runtime_binding.node | Native binary compiled for different arch/platform |
| tests/services/embedder.test.ts | embedBatch called with extra `truncate: true` arg | Implementation was updated to add `truncate: true` but test not updated |
| tests/services/retriever.test.ts | distanceThreshold 0.4 vs expected 0.3 | Strategy constant was changed but test not updated |
| tests/workflows/search.test.ts (10 tests) | table.countRows is not a function | Uncommitted search.ts adds countRows() call but mock doesn't include it |
| tests/workflows/index.test.ts | embedBatchWithRetry called with extra dimension arg | Implementation updated to pass dimension but test not updated |

These failures exist in both committed and uncommitted workspace state before this plan ran.
