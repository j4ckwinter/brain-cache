# Phase 51: Git History Indexing - Context

**Gathered:** 2026-04-06
**Status:** Ready for planning

<domain>
## Phase Boundary

Ingest git commit history (messages, touched paths, diff stats, author/date metadata) into the existing LanceDB chunks table with provenance labeling. Search and build_context return history-derived hits alongside code chunks with clear provenance tagging. Configurable depth limit. Full refresh on each index run (incremental high-water mark is a documented follow-up).

Requirements: DAILY-04

</domain>

<decisions>
## Implementation Decisions

### Chunk Format
- **D-01:** One commit = one chunk. Each chunk contains: short hash (7-8 chars), author name, ISO date, full commit message, list of touched file paths with diff stats (+/-).
- **D-02:** All four metadata fields included in the content string: touched file paths, diff stats (insertions/deletions per file), author and date, short hash. Full SHA is not stored in content — wastes embedding tokens.
- **D-03:** Chunks that exceed `EMBED_MAX_TOKENS` (e.g., large merge commits touching hundreds of files) are handled by the existing pre-flight filter — same as oversized code chunks.

### Storage Strategy
- **D-04:** Git history chunks stored in the **same `chunks` table** as code chunks. A new `source_kind` column (`'file'` | `'history'`) distinguishes them. Existing rows get default value `'file'` via schema migration.
- **D-05:** Chunk ID format: `git:<short-hash>` (e.g., `git:abc1234`). Clearly distinguishable from file chunk IDs (`filePath:startRow`).
- **D-06:** Git chunks use sentinel values for file-only fields: `file_path` = repo root or empty, `start_line` = 0, `end_line` = 0, `chunk_type` = `'commit'`, `file_type` = `'source'`.

### Ingestion Trigger
- **D-07:** Git history ingestion runs as a step within the existing `brain-cache index` command, after file indexing completes. Not a separate subcommand.
- **D-08:** Opt-in via config flag: `git.enabled: true` in `~/.brain-cache/config.json` (or per-project config). Disabled by default — users must enable it.
- **D-09:** Configurable via `git.maxCommits` (default: 500). Ingests the last N commits. On shallow clones, ingest whatever is available and document the behavior.
- **D-10:** Full refresh strategy for initial milestone — delete all `source_kind='history'` chunks and re-ingest on each `brain-cache index` run. Incremental high-water mark commit tracking is a documented follow-up, not in scope for Phase 51.

### Search Integration
- **D-11:** History chunks ranked alongside code chunks by similarity — mixed results, not a separate section. Each result carries a provenance label (`[history]` or `[source]`) in formatted output.
- **D-12:** Small score penalty (similar to existing test-file penalty pattern, ~0.05-0.10) applied to history chunks so code results rank higher at equal similarity. History is supplementary context.
- **D-13:** `build_context` groups history hits in a dedicated "Git History" section after code context in the assembled output string. Search returns them mixed by rank.

### Claude's Discretion
- Exact penalty magnitude for history chunks (0.05-0.10 range is locked)
- Git log command construction and parsing approach (child_process exec vs. library)
- Content string template for the commit chunk (ordering of fields)
- Schema migration implementation details (add column with default)
- Config merge behavior for `git.*` keys (follows existing 3-layer config pattern)
- Whether `--force` on index also force-refreshes history

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### LanceDB Schema and Operations
- `src/services/lancedb.ts` — Arrow schema (`chunkSchema`), `insertChunks`, `deleteChunksByFilePath`, `withWriteLock`, `openDatabase`. Schema migration adds `source_kind` column here.

### Embed Pipeline
- `src/services/embedder.ts` — `embedBatchWithRetry()` handles batching, retry, context-length fallback. Git chunks use the same pipeline.

### Retriever and Ranking
- `src/services/retriever.ts` — `searchChunks()`, `classifyRetrievalMode()`, keyword boost, test-file penalty pattern. History penalty follows the same pattern.

### Index Workflow
- `src/workflows/index.ts` — `runIndex()` is where git history ingestion step gets added (after file indexing). Understand `computeFileDiffs`, `processFileGroup`, `printSummary` structure.

### Index Lock
- `src/services/indexLock.ts` — `acquireIndexLock`/`releaseIndexLock`. Git ingestion runs within the same lock scope as file indexing.

### Types
- `src/lib/types.ts` — `CodeChunk`, `RetrievedChunk`, `IndexState` schemas. May need `source_kind` field added to chunk types.

### Config
- `src/lib/config.ts` — All tunable constants. New `git.*` config keys follow existing patterns.

### Context Builder
- `src/workflows/buildContext.ts` — `runBuildContext()` assembles context with token budget. History hits grouped in separate section.

### Formatter
- `src/lib/format.ts` — Output formatting. Provenance labels (`[history]`/`[source]`) added to search result formatting.

### Requirements
- `.planning/REQUIREMENTS.md` §DAILY-04 — "Git commits (messages + touched paths, within configured limits) are embedded and searchable; retrieval surfaces provenance distinguishing history chunks from file chunks"

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `embedBatchWithRetry()` (src/services/embedder.ts) — batch embedding with retry, used directly for git chunks
- `insertChunks()` / `deleteChunksByFilePath()` (src/services/lancedb.ts) — chunk CRUD, needs filter by `source_kind` for history deletion
- `searchChunks()` (src/services/retriever.ts) — vector search with penalty pattern (test-file penalty = precedent for history penalty)
- `acquireIndexLock` / `releaseIndexLock` (src/services/indexLock.ts) — lock serialization, already in runIndex scope
- 3-layer config merge (src/lib/config.ts) — `git.*` keys follow existing pattern

### Established Patterns
- Workflows compose services: `runIndex` calls crawler, chunker, embedder, lancedb
- Pre-flight filter skips chunks exceeding `EMBED_MAX_TOKENS`
- Score penalties applied in retriever: `testFilePenalty` pattern directly reusable for `historyPenalty`
- `chunk_type` enum: existing values are `function`, `class`, `method`, `file` — new value `commit` for git chunks
- All output formatted via `src/lib/format.ts` — provenance labels added there

### Integration Points
- `runIndex()` in `src/workflows/index.ts` — git ingestion step added after file processing, before summary
- `chunkSchema()` in `src/services/lancedb.ts` — Arrow schema gains `source_kind` Utf8 column
- `searchChunks()` in `src/services/retriever.ts` — ranking gains history penalty
- `assembleContext()` path in `src/workflows/buildContext.ts` — history hits grouped separately
- `formatSearchResults()` in `src/lib/format.ts` — provenance label per result

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches.

</specifics>

<deferred>
## Deferred Ideas

- **Incremental high-water mark** — Store latest ingested commit hash; only ingest new commits on subsequent runs. Explicitly called out in success criterion 3 as optional follow-up.
- **Branch-aware history** — Index commits from non-default branches. Current scope is default branch only.
- **Diff content embedding** — Embed actual code diffs (not just touched paths + stats). Would produce higher-quality "why" answers but dramatically increases chunk count and token usage.

</deferred>

---

*Phase: 51-git-history-indexing*
*Context gathered: 2026-04-06*
