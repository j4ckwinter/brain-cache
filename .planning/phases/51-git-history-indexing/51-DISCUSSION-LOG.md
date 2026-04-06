# Phase 51: Git History Indexing - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-06
**Phase:** 51-git-history-indexing
**Areas discussed:** Chunk format, Storage strategy, Ingestion trigger, Search integration

---

## Chunk Format

### Chunk Unit

| Option | Description | Selected |
|--------|-------------|----------|
| One commit = one chunk | Each chunk contains: commit hash, author, date, message, and list of touched file paths. Simple, natural boundary, good embedding target. | ✓ |
| One file-change = one chunk | Each chunk is one (commit, file) pair. More granular but explodes chunk count. | |
| Grouped by time window | Aggregate commits within a time window into a single chunk. | |

**User's choice:** One commit = one chunk
**Notes:** None — straightforward choice.

### Content Metadata

| Option | Description | Selected |
|--------|-------------|----------|
| Touched file paths | List of files added/modified/deleted in the commit. | ✓ |
| Diff stats (insertions/deletions) | Numeric +/- per file. | ✓ |
| Author and date | Commit author name and ISO date. | ✓ |
| Short hash only (no full SHA) | Abbreviated commit hash (7-8 chars) for reference. | ✓ |

**User's choice:** All four metadata types included
**Notes:** Thorough commit chunks — include everything that adds semantic value.

---

## Storage Strategy

### Table Location

| Option | Description | Selected |
|--------|-------------|----------|
| Same chunks table + source_kind column | Add `source_kind` column ('file' \| 'history'). Schema migration with default 'file'. | ✓ |
| Separate history table | New table with its own schema. Cleaner but requires multi-table search. | |
| Same table, no new column | Use chunk_type='commit' to distinguish. Overloads semantics. | |

**User's choice:** Same chunks table + source_kind column
**Notes:** Schema migration adds column with default value for existing rows.

### Chunk ID Format

| Option | Description | Selected |
|--------|-------------|----------|
| git:<short-hash> | e.g., `git:abc1234`. Simple, distinguishable from file IDs. | ✓ |
| commit:<full-sha> | Fully unique but wastes storage. | |
| You decide | Claude picks during implementation. | |

**User's choice:** git:<short-hash>
**Notes:** None.

---

## Ingestion Trigger

### When to Ingest

| Option | Description | Selected |
|--------|-------------|----------|
| Part of brain-cache index | Runs as step within existing command, after file indexing. Opt-in via config. | ✓ |
| Separate subcommand | `brain-cache index-history` standalone. | |
| Both | Integrated + standalone. | |

**User's choice:** Part of brain-cache index
**Notes:** Single command indexes everything. Config-gated.

### Depth Limit

| Option | Description | Selected |
|--------|-------------|----------|
| Commit count limit | Default last 500 commits. Config key `git.maxCommits`. | ✓ |
| Time-based limit | Last N days. | |
| Both with count as default | Support both, count takes priority. | |

**User's choice:** Commit count limit (500 default)
**Notes:** Simple and predictable. Shallow clone behavior documented.

### Incremental Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Full refresh | Delete all history chunks and re-ingest each run. | ✓ |
| High-water mark from day one | Track latest commit, only ingest new ones. | |
| You decide | Claude picks based on complexity. | |

**User's choice:** Full refresh
**Notes:** Matches success criterion 3. High-water mark is explicit follow-up.

---

## Search Integration

### Result Display

| Option | Description | Selected |
|--------|-------------|----------|
| Mixed, with provenance label | History ranked alongside code by similarity. Tagged with [history]/[source]. build_context groups history in separate section. | ✓ |
| Always separate section | History never mixes with code results. | |
| Only when relevant | History only surfaces for "why" queries. | |

**User's choice:** Mixed, with provenance label
**Notes:** build_context groups history hits in dedicated section after code context.

### Ranking Adjustment

| Option | Description | Selected |
|--------|-------------|----------|
| Small penalty | 0.05-0.10 score penalty. History is supplementary. Follows test-file penalty pattern. | ✓ |
| Equal ranking | No penalty, let similarity decide. | |
| You decide | Claude calibrates during implementation. | |

**User's choice:** Small penalty (0.05-0.10 range)
**Notes:** Follows existing test-file penalty pattern in retriever.

---

## Claude's Discretion

- Exact penalty magnitude for history chunks (0.05-0.10 range is locked)
- Git log command construction and parsing approach
- Content string template for commit chunks
- Schema migration implementation details
- Config merge behavior for `git.*` keys
- Whether `--force` also force-refreshes history

## Deferred Ideas

- Incremental high-water mark commit tracking (explicit follow-up per success criterion 3)
- Branch-aware history indexing (non-default branches)
- Diff content embedding (actual code diffs, not just paths + stats)
