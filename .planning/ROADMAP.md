# Roadmap: Brain-Cache

**Project:** Brain-Cache
**Core Value:** Reduce Claude token usage and improve response quality by running embeddings, retrieval, and context building locally

---

## Milestones

- ✅ **v1.0 MVP** — Phases 1-5 (shipped 2026-04-01) — [archive](milestones/v1.0-ROADMAP.md)
- **v1.1 Hardening** — Phases 6-10 (in progress)

## Phases

<details>
<summary>✅ v1.0 MVP (Phases 1-5) — SHIPPED 2026-04-01</summary>

- [x] Phase 1: Foundation (3/3 plans) — completed 2026-03-31
- [x] Phase 2: Storage and Indexing (4/4 plans) — completed 2026-03-31
- [x] Phase 3: Retrieval and Context Assembly (3/3 plans) — completed 2026-04-01
- [x] Phase 4: MCP Server and Claude Integration (2/2 plans) — completed 2026-04-01
- [x] Phase 5: CLI Completion (2/2 plans) — completed 2026-04-01

</details>

### v1.1 Hardening

- [x] **Phase 6: Foundation Cleanup** - Fix process.exit, env config, version sourcing, barrel files, and API key log hygiene (completed 2026-04-01)
- [x] **Phase 7: Type Safety and Code Correctness** - Replace any types, fix model name matching, eliminate redundant token counting, harden tree-sitter layer (completed 2026-04-01)
- [ ] **Phase 8: Ollama Process Security** - Fix detached process management with PID tracking, port checks, and race condition prevention
- [ ] **Phase 9: Indexing and Retrieval Performance** - Parallelize I/O, stream chunk pipeline, add IVF-PQ index, cache separator count
- [ ] **Phase 10: Incremental Indexing and Intent Classification** - Content-hash stale detection for incremental re-indexing, bigram/exclusion improvements to intent classification

## Phase Details

### Phase 6: Foundation Cleanup
**Goal**: Error propagation works correctly, runtime config is environment-driven, and no silent gaps exist in the codebase surface
**Depends on**: Nothing (first v1.1 phase)
**Requirements**: HARD-01, DEBT-02, DEBT-03, DEBT-04, SEC-01
**Success Criteria** (what must be TRUE):
  1. Running `brain-cache index` on a broken repo throws an Error that the CLI entry point catches and prints — no `process.exit` call appears in non-entry-point source files
  2. Setting `OLLAMA_HOST=http://192.168.1.10:11434` before running any command causes all Ollama requests to go to that host, verified by pointing at a non-default host
  3. Running `brain-cache --version` prints the version from `package.json`, not a hardcoded string
  4. Importing any barrel file (`tools/index`, `services/index`, `lib/index`) exports the expected symbols with no empty re-export files remaining
  5. Running `brain-cache doctor` with `ANTHROPIC_API_KEY` set does not print the key value anywhere in stderr or stdout output
**Plans:** 2/2 plans complete
Plans:
- [x] 06-01-PLAN.md — Replace process.exit with thrown errors, add CLI catch wrapper, source version from package.json
- [x] 06-02-PLAN.md — Respect OLLAMA_HOST env var, populate barrel exports, add API key log redaction

### Phase 7: Type Safety and Code Correctness
**Goal**: The codebase has no unsafe `any` types in interop layers, model name matching is exact, and token counting is computed once
**Depends on**: Phase 6
**Requirements**: DEBT-05, DEBT-06, BUG-01, HARD-02, HARD-03
**Success Criteria** (what must be TRUE):
  1. Running `tsc --noEmit` passes with `noImplicitAny: true` — no `any` types remain in tree-sitter or LanceDB interop files
  2. A model named `llama3` does not match when the running model is `llama3.2` — the doctor command correctly reports the model as missing rather than found
  3. Running `brain-cache index` on a 100-file repo calls the token counter exactly once per chunk (not once per chunk plus once per file) — verifiable by adding a count log and confirming single invocations
  4. The tree-sitter CJS require() block has an inline comment explaining why it exists and what version of tree-sitter or Node.js would allow removing it
  5. Arrow function extraction uses parent node type checks rather than depth counting — verified by indexing a file with deeply nested arrow functions and confirming all are extracted
**Plans**: TBD

### Phase 8: Ollama Process Security
**Goal**: Brain-cache never leaves orphaned Ollama processes and never spawns a second instance when one is already running
**Depends on**: Phase 6
**Requirements**: SEC-02
**Success Criteria** (what must be TRUE):
  1. Running `brain-cache init` twice in quick succession does not start two Ollama processes — the second invocation detects the port is occupied and skips spawn
  2. After a `brain-cache` command completes or fails, no Ollama process spawned by brain-cache remains running as a detached orphan (verified with `ps aux | grep ollama`)
  3. When Ollama fails to start within the timeout, brain-cache logs the PID it attempted to track and exits with a clear error message rather than hanging
**Plans**: TBD

### Phase 9: Indexing and Retrieval Performance
**Goal**: Indexing a large repo is significantly faster and uses bounded memory regardless of repo size
**Depends on**: Phase 6, Phase 7
**Requirements**: PERF-01, PERF-02, PERF-03, PERF-04
**Success Criteria** (what must be TRUE):
  1. Indexing a 500-file repo completes measurably faster than sequential I/O baseline — file reads run with a concurrency limiter (e.g., 20 concurrent) rather than one at a time
  2. Indexing a repo with 10,000 chunks does not accumulate all chunks in memory before embedding — chunk batches are processed and flushed as they are produced
  3. After indexing a table with more than the threshold chunk count (e.g., 10,000), a LanceDB IVF-PQ index exists on the table and vector search returns results in measurably less time
  4. The separator token count is computed once before the context assembly loop and reused — no per-chunk recomputation occurs (verified by code inspection or adding a counter)
**Plans**: TBD

### Phase 10: Incremental Indexing and Intent Classification
**Goal**: Re-indexing only processes changed files, and intent classification produces fewer false positives on mixed queries
**Depends on**: Phase 9
**Requirements**: DEBT-01, HARD-04
**Success Criteria** (what must be TRUE):
  1. Running `brain-cache index` on a previously-indexed repo where only 3 files changed embeds exactly those 3 files — unchanged files are skipped, verified by log output showing file counts
  2. Deleting a file from the repo and running `brain-cache index` removes that file's chunks from the LanceDB table — stale entries do not accumulate
  3. A query like "how do I fix the authentication bug" does not trigger the diagnostic retrieval strategy — the intent classifier correctly identifies it as a knowledge query using bigram and exclusion pattern matching
  4. Running `brain-cache status` after an incremental index shows correct chunk counts that reflect only current files
**Plans**: TBD

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Foundation | v1.0 | 3/3 | Complete | 2026-03-31 |
| 2. Storage and Indexing | v1.0 | 4/4 | Complete | 2026-03-31 |
| 3. Retrieval and Context Assembly | v1.0 | 3/3 | Complete | 2026-04-01 |
| 4. MCP Server and Claude Integration | v1.0 | 2/2 | Complete | 2026-04-01 |
| 5. CLI Completion | v1.0 | 2/2 | Complete | 2026-04-01 |
| 6. Foundation Cleanup | v1.1 | 2/2 | Complete   | 2026-04-01 |
| 7. Type Safety and Code Correctness | v1.1 | 2/? | In progress | - |
| 8. Ollama Process Security | v1.1 | 0/? | Not started | - |
| 9. Indexing and Retrieval Performance | v1.1 | 0/? | Not started | - |
| 10. Incremental Indexing and Intent Classification | v1.1 | 0/? | Not started | - |

---
*Roadmap created: 2026-03-31*
*Last updated: 2026-04-01 after plan 07-02 complete*
