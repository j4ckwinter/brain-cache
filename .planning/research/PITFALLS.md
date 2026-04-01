# Pitfalls Research

**Domain:** Local AI Runtime / Code Intelligence (Braincache)
**Researched:** 2026-03-31
**Confidence:** HIGH (most pitfalls confirmed via official docs, GitHub issues, and multiple independent sources)

---

## Critical Pitfalls

### Pitfall 1: stdout Corruption in MCP stdio Transport

**What goes wrong:** Any `console.log()` call anywhere in the process — including from dependencies — writes to stdout, which is the same channel carrying JSON-RPC protocol messages. The MCP client receives garbled data, silently drops tool calls, or crashes the connection with no useful error.

**Why it happens:** Node.js `console.log` defaults to stdout. Developers add debug logging during development, forget to remove it, or pull in a library that logs to stdout. The MCP TypeScript SDK uses stdio transport by default, so the channel collision is silent until something breaks.

**How to avoid:**
- Replace all `console.log` with `console.error` (stderr) from day one — or use a logger configured to write to stderr
- Add an ESLint rule banning `console.log` in MCP server code
- Test with the MCP Inspector before assuming Claude Code integration works
- Intercept stdout in tests and assert it only contains valid JSON-RPC

**Warning signs:**
- Claude Code reports "malformed message" or drops tool calls intermittently
- Tools worked in isolation but fail when invoked through Claude Code
- Adding any new log line breaks the integration

**Phase to address:** MCP Server scaffolding (first phase touching MCP). Set up logging infrastructure before writing any tool handlers.

**Confidence:** HIGH — confirmed via Nearform's MCP pitfalls guide and multiple GitHub issues (claude-flow#835, ruflo#835).

---

### Pitfall 2: Embedding Dimension Mismatch After Model Change

**What goes wrong:** The LanceDB table is created with vectors of dimension N (e.g., 768 for `nomic-embed-text`). Later the embedding model is changed or upgraded (e.g., to `mxbai-embed-large` at 1024 dimensions). All new embeddings have the wrong shape. Vector search returns nothing, or worse — silently returns garbage results due to metric computation on mismatched shapes.

**Why it happens:** The table schema bakes in the vector dimension at creation time. Ollama embedding models have different output dimensions: `nomic-embed-text` = 768, `mxbai-embed-large` = 1024. Many frameworks hardcode 1536 (OpenAI's default), causing failures on any Ollama model. There is no automatic migration path.

**How to avoid:**
- Store the embedding model name and output dimension in a separate metadata table/file at index creation time
- On startup, compare the stored model + dimension against the currently configured model
- If mismatch detected: refuse to continue and prompt the user to run `braincache index --force` (full reindex)
- Never infer dimension from a hardcoded constant — always query the live model via a test embed on first run

**Warning signs:**
- Vector search returns zero results after changing models in config
- LanceDB throws dimension mismatch errors on insert
- First-run succeeds but subsequent searches fail after restart with different model

**Phase to address:** Embeddings pipeline (core indexing phase). The metadata check must exist before the first production index is built.

**Confidence:** HIGH — confirmed via multiple GitHub issues across mem0, Archon, continue.dev, and the Ollama issue tracker.

---

### Pitfall 3: Ollama Cold-Start Timeout Killing First Requests

**What goes wrong:** The first embedding or generation request after Ollama loads a model takes 13–46 seconds (depending on model size and hardware) as weights load from disk into VRAM. Default HTTP client timeouts (30 seconds in many frameworks, 5 minutes in Node.js) cause the first request to fail or silently retry. Users see "model not responding" on first use, even when Ollama is running correctly.

**Why it happens:** Ollama must read gigabytes of weights from SSD through the PCIe bus into VRAM before the first inference. The model is "cold" — not loaded into memory. OLLAMA_KEEP_ALIVE defaults to 5 minutes, so models unload after idle periods, bringing the problem back repeatedly.

**How to avoid:**
- Set a per-request timeout of at least 120 seconds for embedding calls, not the HTTP client default
- Implement a "warm model" step in `braincache doctor` and `braincache init` that sends a dummy embed and waits
- Set `OLLAMA_KEEP_ALIVE` to a longer value (e.g., `1h`) and document this in setup instructions
- Retry on timeout (up to 2 retries with exponential backoff) before surfacing an error to the user
- On cold start, emit a progress message ("Loading model into VRAM, first request may take 30–60s...")

**Warning signs:**
- First embedding call after starting Braincache always fails
- Works fine for the first hour but fails again after a break
- Errors like "ECONNRESET" or "request timed out" on the first call only

**Phase to address:** Ollama integration layer. Must be solved before any user-visible feature that calls embeddings.

**Confidence:** HIGH — confirmed via Ollama GitHub issues #4350, #6031, and multiple community guides.

---

### Pitfall 4: Indexing node_modules / Binary Files Inflates the Index

**What goes wrong:** The indexer crawls the entire project directory and embeds everything it finds, including `node_modules` (tens of thousands of files), `.git` internals, compiled artifacts, images, lock files, and minified bundles. The resulting index is 10–100x larger than needed, first-run indexing takes minutes instead of seconds, and search results are polluted with irrelevant hits from vendored code.

**Why it happens:** Respecting `.gitignore` requires explicitly parsing and applying it — it is not automatic. Tools that skip this step include everything. The Roo-Code issue tracker (issue #5655) documents this happening even in mature tools.

**How to avoid:**
- Parse `.gitignore` (using a library like `ignore`) before crawling and apply rules to every file path
- Maintain a hardcoded default exclusion list that applies even without a `.gitignore`: `node_modules/`, `.git/`, `dist/`, `build/`, `.next/`, `*.lock`, `*.min.js`, `*.map`, common binary extensions
- Skip files over a configurable size threshold (default: 100KB for text files)
- Skip non-text files by checking MIME type or magic bytes, not just extension
- Report indexing stats (files indexed / files skipped) so users can validate the exclusion is working

**Warning signs:**
- `braincache index` takes longer than 60 seconds on a small project
- Index size on disk is unexpectedly large
- Search results include hits from `node_modules` paths

**Phase to address:** Indexing pipeline (first milestone). The exclusion logic must exist before the index is useful.

**Confidence:** HIGH — confirmed via Roo-Code GitHub issue #5655 and general RAG documentation patterns.

---

### Pitfall 5: Distance Metric Mismatch Between Index and Query

**What goes wrong:** The LanceDB table is created with one distance metric (e.g., cosine), but queries use a different metric (e.g., L2/Euclidean), or vice versa. Vector search "works" — returns results without errors — but relevance is wrong. High-scoring results are semantically unrelated. The system appears functional during development but produces poor retrieval quality in production.

**Why it happens:** LanceDB does not validate that query-time distance metric matches the index-time metric. The mismatch is silent. Ollama embedding models (especially `nomic-embed-text`) produce normalized vectors suited for cosine similarity, but L2 distance on normalized vectors gives different rankings. Developers copy-paste code without verifying the metric.

**How to avoid:**
- Store the distance metric alongside the embedding model name in metadata
- Use cosine similarity as the default for all Ollama embedding models (they produce normalized vectors)
- Assert metric consistency at query time: read stored metric from metadata, pass it explicitly to every vector search call
- Write a smoke test that embeds two semantically similar strings and asserts they rank above two unrelated strings

**Warning signs:**
- Search returns technically valid results but they are semantically irrelevant
- Relevance scores cluster around the same value (0.5–0.6) regardless of query
- Switching between two clearly related queries produces nearly identical result sets

**Phase to address:** Vector search layer. Include a relevance quality test before the search API is considered done.

**Confidence:** HIGH — confirmed via Zilliz FAQ, DEV Community articles, and LanceDB documentation.

---

## Technical Debt Patterns

### Debt 1: LanceDB Full Scan at Small Scale Masks Later Performance Cliff

**What goes wrong:** LanceDB performs an exact nearest-neighbor search (full scan) when no ANN index exists. For a small codebase (< 10K chunks), this is fast enough to feel fine in development. The index is never built. As the codebase grows or the user switches to a larger repo, search latency grows linearly — from milliseconds to seconds — with no warning.

**How to avoid:**
- Build an IVF or HNSW index after the initial index is populated, not lazily
- Log a warning if vector count exceeds a threshold (e.g., 5,000 vectors) and no ANN index exists
- Provide `braincache index --reindex` as the documented path to rebuild the ANN index when needed
- Note: LanceDB requires at least a few thousand rows before index training is effective — plan the threshold accordingly

**Phase to address:** Indexing pipeline (after initial indexing works).

**Confidence:** HIGH — confirmed via LanceDB documentation on vector search and index types.

---

### Debt 2: Stale Index After Branch Switch or File Rename

**What goes wrong:** The index is built once and never invalidated. When a developer switches git branches, renames files, or deletes functions, the index still returns stale results pointing to paths or symbols that no longer exist. Claude receives context about code that is gone, producing hallucinated or misleading answers.

**How to avoid:**
- Store a content hash (SHA-256) per indexed file alongside the embedding
- On each `search_codebase` call (or periodically), compare stored hashes against current file state
- Expose an `index_repo` MCP tool that Claude can call to trigger a reindex when the user signals significant changes
- Document the "when to reindex" guidance clearly: after branch switches, major refactors, or adding new modules
- Do not implement a file watcher in v1 — it adds complexity and debounce edge cases. Manual reindex is sufficient for the MVP

**Phase to address:** Indexing pipeline and MCP tool definitions.

**Confidence:** MEDIUM — pattern confirmed via CocoIndex documentation and Roo-Code architecture analysis; specific LanceDB hash-based invalidation approach is a common pattern not specifically documented.

---

### Debt 3: Over-Stuffing Context Hurts Claude Quality

**What goes wrong:** The context builder retrieves the top-K chunks and concatenates all of them into Claude's prompt. With K=20 and 500-token chunks, that's 10,000 tokens of context — most of it loosely relevant. Claude's answer quality degrades because the model has to reason over noisy, partially relevant content. Token savings also disappear.

**Why it happens:** Retrieval feels safe — "more context is better." In practice, research consistently shows that 5–8 high-quality chunks outperform 20–50 noisy chunks. The Braincache value proposition (send only what matters) is undermined by this pattern.

**How to avoid:**
- Cap retrieved chunks at a small default (e.g., top-5 or top-8)
- Apply a similarity score threshold — drop any chunk below 0.7 cosine similarity regardless of rank
- Deduplicate chunks that come from the same file and adjacent line ranges
- Track and report estimated token savings per request so the value is visible

**Phase to address:** Context builder component.

**Confidence:** HIGH — confirmed via multiple RAG research sources (Morphik, AWS, agenta.ai).

---

### Debt 4: LanceDB Concurrent Write Failures During Indexing

**What goes wrong:** If multiple processes (e.g., CLI indexer + background watcher) attempt to write to the same LanceDB table simultaneously, writes fail after exhausting retry attempts. The table can end up in an inconsistent state ("Failed to commit the transaction after 20 retries"). This is silent in some error paths.

**How to avoid:**
- For v1: do not implement concurrent writers. Enforce a single indexing process with a lockfile
- Write all embeddings in a single batched operation rather than per-file inserts (also dramatically faster)
- If background indexing is added later, serialize writes through a queue
- Always use batch insert (not single-row inserts) to reduce fragment count and write contention

**Phase to address:** Indexing pipeline architecture.

**Confidence:** HIGH — confirmed via LanceDB FAQ and GitHub issues #213, #1077, #2426.

---

## Integration Gotchas

### Gotcha 1: Ollama Serves Both LLMs and Embedding Models — Wrong Model Type Is Silent

**What goes wrong:** `ollama list` shows all models including chat/generation models. When a user (or the code) selects a generation model (e.g., `llama3`) for embeddings, Ollama may return a response without a clear error, but the embedding values are meaningless or the API call fails with a cryptic message.

**How to avoid:**
- Hardcode the embedding model name in config with a clear label ("embedding model")
- On startup (`braincache doctor`), verify the configured model is embedding-capable by sending a test embed and checking the response shape
- If the model is not present, emit a precise actionable error: "Embedding model 'nomic-embed-text' not found. Run: ollama pull nomic-embed-text"
- Never allow a chat model to be silently used as an embedding model

**Confidence:** HIGH — confirmed via Ollama issue #12757 and Kilo-Code issue #1501.

---

### Gotcha 2: Token Count Estimates Are Inaccurate Without Official API

**What goes wrong:** The context builder estimates token usage using a character-count approximation (e.g., `chars / 4`). The actual token count when sent to Claude differs by 10–30%, causing the context budget to overflow or the "token savings" metric to be misleading. Worse, the Anthropic SDK adds hidden tokens for tool definitions, system prompts, and role markers that local estimation completely misses.

**How to avoid:**
- Use `client.messages.countTokens()` from the Anthropic SDK for any budget-sensitive calculation
- Build the full request object (including system prompt, tools, messages) before counting — partial counts miss SDK-added overhead
- Display token savings as a range ("saved approximately X–Y tokens") rather than an exact figure unless API counting is used
- Never use character/word-count approximations for decisions that affect what context gets included

**Confidence:** HIGH — confirmed via Anthropic official token counting docs and Propel blog.

---

### Gotcha 3: Capability Detection via nvidia-smi Is Fragile

**What goes wrong:** GPU detection using `nvidia-smi` works on Linux/NVIDIA but fails silently on: macOS (Metal, not CUDA), AMD GPUs (ROCm), Windows with WSL2, Docker containers, and CI environments. The fallback behavior is never triggered because detection throws an unhandled error instead of returning "no GPU."

**How to avoid:**
- Treat capability detection as a best-effort operation that always succeeds (returns a capability object, never throws)
- Check Ollama's own model info endpoint for hardware-aware model selection rather than interrogating hardware directly
- Use `ollama list` and cross-reference model sizes against available memory (check via OS APIs or Ollama API) rather than VRAM directly
- Test the no-GPU path explicitly in CI (mock Ollama, skip hardware detection)
- Document: "On machines without a local GPU, Braincache skips local embeddings and passes the query directly to Claude"

**Confidence:** MEDIUM — confirmed via LocalAI docs and popular AI Substack; Braincache-specific detection approach is inferred from general patterns.

---

### Gotcha 4: MCP Tool Schema Validation Is Provider-Dependent

**What goes wrong:** The MCP tool schema defines parameter constraints (enums, min/max, required fields), but the MCP client (Claude Code) may not enforce those constraints before calling the tool. Tools receive invalid or missing parameters and throw unhandled errors that surface as cryptic "tool failed" messages to the user.

**How to avoid:**
- Validate all tool inputs explicitly inside each tool handler using Zod — do not rely on the protocol to enforce schema constraints
- Return structured error responses (not thrown exceptions) when validation fails, so Claude Code can surface actionable feedback
- Keep tool parameter names and descriptions unambiguous; similar parameter names across tools cause model confusion and wrong-tool calls
- Limit total MCP tools to the minimum necessary — each additional tool increases routing ambiguity

**Confidence:** HIGH — confirmed via Nearform MCP pitfalls guide and Milvus MCP FAQ.

---

## Performance Traps

### Trap 1: Single-File Embedding (N+1 Embed Pattern)

**What goes wrong:** The indexer embeds one file at a time, making one HTTP request to Ollama per file. For a 500-file codebase, this is 500 sequential HTTP round-trips plus 500 model inference calls. Indexing takes 5–15 minutes instead of under 1 minute. Users abandon the tool before it finishes.

**How to avoid:**
- Use Ollama's batch embedding endpoint — pass multiple texts in a single request
- Process files in batches (e.g., 32–64 chunks per batch) to maximize GPU utilization
- Show a progress indicator (file N of M, estimated time remaining) during indexing
- Benchmark a 100-file codebase during development and set a performance gate: indexing must complete in under 60 seconds on mid-range hardware

**Confidence:** HIGH — confirmed via Ollama concurrent embeddings issue #12591 and general API batching best practices.

---

### Trap 2: Returning All Columns in Vector Queries

**What goes wrong:** LanceDB vector queries return all columns by default, including the full stored embedding vector (768 or 1024 floats per row). For the top-20 results, this serializes and deserializes ~15,000 floats of data that are never used by the caller. Query latency increases noticeably.

**How to avoid:**
- Explicitly select only needed columns in every vector query: `.select(['filepath', 'chunk', 'start_line', 'end_line', 'score'])`
- Never select the vector column in retrieval queries (only needed for debugging)
- This is documented as a best practice in LanceDB's own vector search documentation

**Confidence:** HIGH — confirmed via LanceDB vector search documentation.

---

### Trap 3: Text Chunking That Splits Function Boundaries

**What goes wrong:** Naive text chunking by character count or line count splits code in the middle of functions, classes, or import blocks. Each resulting chunk embeds a fragment with no semantic meaning on its own. Retrieval matches partial function signatures instead of complete implementations, and Claude receives broken context that references undefined variables.

**How to avoid:**
- Use AST-aware chunking via tree-sitter — chunk at function, class, and method boundaries
- Fall back to line-count chunking only for file types without a tree-sitter grammar
- Measure chunk size by non-whitespace characters, not total characters (blank-line-heavy files skew estimates)
- Maintain a minimum chunk size — discard stub chunks under ~50 tokens unless they are the entire file
- Research finding: AST-based chunking (cAST approach) improves code retrieval quality measurably across benchmarks

**Confidence:** HIGH — confirmed via supermemory.ai blog, EMNLP 2025 cAST paper, and Pinecone chunking guide.

---

## "Looks Done But Isn't" Checklist

These are states where the feature appears to work but has a latent defect that surfaces under real conditions:

| Symptom | Latent Problem | Real Test |
|---------|----------------|-----------|
| Embedding works on first run | Dimension stored, but not validated on restart with different model | Restart with a different embedding model — should fail loudly, not silently |
| Search returns results | Distance metric may be wrong; relevance is not validated | Embed two clearly similar strings and assert they score > 0.7 and rank above unrelated strings |
| MCP tools respond to Claude | console.log may be suppressing errors silently | Pipe stdout through a JSON validator and assert every line is valid JSON-RPC |
| Indexing completes | node_modules may be indexed | Check index size vs. project size; search for a lodash function that should not be findable |
| Token savings reported | Savings calculated with character approximation, not real token count | Compare estimated vs. API-counted tokens on 10 real queries |
| GPU detected on developer machine | Detection fails silently on CI or other hardware | Run `braincache doctor` in a Docker container with no GPU and assert graceful fallback |
| Cold-start embedding succeeds | Timeout is set to 30s; works on fast hardware but fails on slow/shared machines | Throttle disk I/O and run first embed; assert retry logic activates |
| LanceDB writes succeed in testing | Single-row inserts work but batch-insert performance never tested | Time indexing of 500-file repo; assert completion under 90 seconds |

---

## Phase-Specific Warnings

| Phase / Topic | Likely Pitfall | Mitigation |
|---------------|---------------|------------|
| MCP server scaffolding | stdout corruption from logging | Set up stderr-only logging before any tool handler code is written |
| Ollama integration | Cold-start timeouts on first embed | Implement warm-model check and 120s timeout from the start |
| Ollama integration | Missing model surfaced as cryptic HTTP error | Wrap all Ollama calls with a model-exists check + actionable error message |
| Embeddings pipeline | Embedding dimension hardcoded | Query model for actual dimension on first run; store in metadata |
| Embeddings pipeline | N+1 embed pattern | Design batch embedding from the start; benchmark on 100+ files |
| Indexing pipeline | node_modules indexed by default | Apply .gitignore + hardcoded exclusions before the first crawl is implemented |
| Indexing pipeline | Text chunking splits functions | Integrate tree-sitter before embedding any code; text chunking is a last resort |
| Vector search | No ANN index built | Create IVF/HNSW index after initial load; add warning if skipped |
| Vector search | Distance metric mismatch | Store metric in metadata; assert at query time |
| Context builder | Over-stuffing context | Cap at top-5 chunks with similarity threshold from day one |
| Context builder | Inaccurate token counting | Use Anthropic SDK countTokens for any budget decision |
| LanceDB concurrent writes | Two processes write simultaneously | Single-writer lockfile; batch all inserts |
| Capability detection | nvidia-smi fails on non-NVIDIA hardware | Always return a capability object, never throw; test no-GPU path in CI |
| MCP tool schemas | Schema constraints not enforced by client | Zod validation inside every tool handler |

---

## Sources

- Nearform — "Implementing Model Context Protocol: Tips, Tricks and Pitfalls" (https://nearform.com/digital-community/implementing-model-context-protocol-mcp-tips-tricks-and-pitfalls/)
- Milvus AI Reference — "Common mistakes developers make when first using MCP" (https://milvus.io/ai-quick-reference/what-are-common-mistakes-developers-make-when-first-using-model-context-protocol-mcp)
- LanceDB Documentation — Vector Search (https://docs.lancedb.com/search/vector-search)
- LanceDB FAQ (https://docs.lancedb.com/faq/faq-oss)
- LanceDB GitHub — Concurrent writes issue #213 (https://github.com/lancedb/lancedb/issues/213)
- LanceDB GitHub — Table inconsistent state issue #2426 (https://github.com/lancedb/lancedb/issues/2426)
- Ollama GitHub — Configurable model loading timeout #4350 (https://github.com/ollama/ollama/issues/4350)
- Ollama GitHub — Concurrent embeddings in multi-node deployments #12591 (https://github.com/ollama/ollama/issues/12591)
- Ollama GitHub — Qwen3-Embedding "model does not support embeddings" #12757 (https://github.com/ollama/ollama/issues/12757)
- Ollama Blog — Embedding Models (https://ollama.com/blog/embedding-models)
- mem0 GitHub — Qdrant created with wrong dimensions when using Ollama (nomic-embed-text) #4212 (https://github.com/mem0ai/mem0/issues/4212)
- Archon GitHub — RAG search fails with non-1536D embeddings #894 (https://github.com/coleam00/Archon/issues/894)
- MCP stdio corruption — claude-flow issue #835 (https://github.com/ruvnet/claude-flow/issues/835)
- Roo-Code GitHub — Codebase indexing ignores .gitignore #5655 (https://github.com/RooCodeInc/Roo-Code/issues/5655)
- Zilliz — Distance metric mismatch FAQ (https://zilliz.com/ai-faq/how-does-the-distance-metric-used-cosine-vs-l2-interplay-with-the-embedding-model-choice)
- Anthropic — Token Counting API (https://platform.claude.com/docs/en/build-with-claude/token-counting)
- supermemory.ai — AST-Aware Code Chunking (https://supermemory.ai/blog/building-code-chunk-ast-aware-code-chunking/)
- cAST paper — EMNLP 2025 Findings (https://arxiv.org/html/2506.15655v1)
- Pinecone — Chunking Strategies (https://www.pinecone.io/learn/chunking-strategies/)
- Morphik — RAG strategies at scale (https://www.morphik.ai/blog/retrieval-augmented-generation-strategies)
- Popular AI Substack — Why Ollama crawls when models spill into RAM (https://popularai.substack.com/p/why-ollama-and-llama-cpp-crawl-when-models-spill-into-ram-and-how-to-fix-it)
- LocalAI — VRAM and Memory Management (https://localai.io/advanced/vram-management/)
