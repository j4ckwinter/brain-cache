# Feature Research

**Domain:** Local AI Runtime / Code Intelligence (Context Optimization Layer)
**Project:** Braincache
**Researched:** 2026-03-31
**Confidence:** HIGH (core features), MEDIUM (differentiators), LOW (anti-feature rationale where market evidence is thin)

---

## Context: What Braincache Is

Braincache is NOT a general AI coding assistant, IDE plugin, or agent framework. It is a **context optimization layer** — a local runtime that intercepts the work that happens BEFORE Claude sees your code. Its job: embed locally, retrieve relevantly, compress aggressively, then hand off minimal high-signal context to Claude via MCP tools.

This narrow definition matters for feature categorization. Features like autocomplete or multi-model routing are table stakes for Cursor but anti-features for Braincache.

---

## Feature Landscape

### Table Stakes (Users Expect These)

These are features that, if missing, make the tool feel broken or untrustworthy. Evidence: observed across Augment Context Engine MCP, Continue.dev, Cody, aider — the tools Braincache competes/integrates-with.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Codebase indexing** | Users expect a one-time "learn this repo" step. Without it, the tool has no memory. | Medium | Must traverse directory tree, parse files, store vectors in LanceDB. |
| **Vector similarity search** | Core retrieval mechanism. "Find code related to X" is the primary query type. | Medium | Semantic search via Ollama embeddings + LanceDB ANN search. Already in scope. |
| **Gitignore / exclusion respect** | Every tool that ignores node_modules or build artifacts implicitly sets this expectation. Tools that index `node_modules` are immediately untrustworthy. | Low | Must parse `.gitignore` and `.braincacheignore` (if added). Roo-Code had a bug where ignoring this broke trust entirely. |
| **Incremental re-indexing** | Stale indexes are worse than no index — they confidently return wrong results. Users expect changes to be picked up. | Medium | File watcher or content-hash based re-index. Cursor does content-hash + 5-min resync. Augment does real-time. |
| **MCP tool exposure** | Braincache's integration model IS MCP. If tools aren't discoverable and callable by Claude Code natively, the product doesn't work. | Medium | Must expose `index_repo`, `search_codebase`, `build_context`, `doctor` as MCP tools. |
| **AST-aware chunking** | Naive character/line splits produce garbage embeddings. Function-boundary chunks are the minimum quality bar. | Medium | tree-sitter is the standard (used by Cursor, Continue, LanceDB's own RAG guide). Chunking at function/class boundaries is now table stakes. |
| **Hardware detection (GPU/CPU fallback)** | Local tools that crash or silently degrade on CPU-only machines alienate a large user segment. Expected: tool runs everywhere, faster with GPU. | Low | Detect VRAM via Ollama capability probe. Route to appropriate model or defer. Already in scope. |
| **CLI for setup and diagnostics** | Every CLI-first developer tool (aider, ollama, repomix) has an init + doctor pattern. Without it, setup failures have no debugging path. | Low | `braincache init`, `braincache doctor`, `braincache status`. Already in scope. |
| **Context output with token count reporting** | The product's core claim is token reduction. Without a number, users cannot verify value. Tracking shows 70% of AI tool token usage is "waste" — users want proof it's been cut. | Low | Output metadata: tokens sent, tokens estimated-without-braincache, reduction %. |

---

### Differentiators (Competitive Advantage)

Features that set Braincache apart from generic RAG pipelines and IDE-coupled tools. Evidence: gaps in existing tools, validated pain points.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Context deduplication** | When multiple retrieved chunks reference the same function (e.g., a utility called everywhere), naive retrieval inflates the context with repetitions. Dedup before handoff. | Low | Hash-based dedup on chunk content. Simple but most tools skip it. |
| **Relevance-ranked context assembly** | Don't just retrieve — curate. Rank chunks by relevance score, apply a token budget, then assemble a compressed context package. Augment's engine shows 30-80% quality improvements from this alone. | Medium | Requires score metadata from LanceDB, a token budget parameter, and a packing algorithm. |
| **Compression metadata as tool output** | Every `build_context` call returns: query, chunks used, tokens, estimated token savings vs. naive. This makes the value proposition observable and debuggable. | Low | Append a metadata object to every tool response. |
| **Query-type aware retrieval** | "Why is X re-rendering?" needs component + hook chunks. "How does auth work?" needs auth service + middleware chunks. Different query patterns need different retrieval strategies. | High | Requires classifying queries and tuning retrieval depth/breadth per type. Defer to later phase. |
| **Ollama model selection by capability tier** | Not all machines have the same GPU. A 3090 should use a larger embedding model than an integrated GPU. Auto-select from a tiered model list based on detected VRAM. | Low | Map VRAM tiers to model recommendations (nomic-embed-text v1.5 at low end, nomic-embed-text-v2-moe at high end). |
| **Zero-config defaults** | Most RAG tools require configuring chunking strategy, embedding model, vector dims, similarity threshold. Braincache ships hardcoded defaults that work. Lower barrier to adoption. | Low | Choose good defaults: nomic-embed-text, 512-token chunks at function boundaries, top-10 retrieval, cosine similarity. |
| **Session-scoped context (build_context workflow)** | Rather than returning raw chunks, assemble a single compressed context string optimized for Claude's context window. This is the "cache layer" abstraction. Other MCP tools return raw data; this returns prepared context. | Medium | Requires a context builder service that deduplicates, ranks, and assembles into a formatted prompt block. |

---

### Anti-Features (Commonly Requested, Often Problematic)

Features that users from general AI coding tools may request, but which would undermine Braincache's design philosophy or scope.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **Autocomplete / inline completions** | Requires IDE plugin, low-latency inference, editor integration. That's Cursor/Copilot's domain. Adding it turns Braincache into a worse Cursor. | Stay as MCP tool layer. Autocomplete is a different product category. |
| **Multi-provider LLM routing** | Supporting OpenAI, Gemini, local models for the reasoning step adds enormous configuration surface. Each provider has different context window behavior. | Support exactly Ollama (local) + Anthropic (Claude). Two providers only. |
| **Plugin / extension system** | Premature generalization. A plugin system is always speculative — you're building infrastructure for users you don't yet have. | Hardcode what works. Generalize only after 3+ instances of the same extension need. |
| **Web UI / dashboard** | Browser frontend requires bundler, auth, port management, CORS. Adds surface area with no CLI value-add. | Terminal output + structured JSON for programmatic consumers. |
| **Chat interface / conversation loop** | Continue.dev, aider, Cursor all do conversational AI. Braincache is a tool layer, not a chat interface. | Expose MCP tools that Claude Code's own conversation loop calls. |
| **Semantic code generation** | Generating code from natural language is Claude's job. Braincache's job is to give Claude better context to do that job. | Never generate code in Braincache. Retrieve, compress, hand off. |
| **Multi-agent orchestration** | Agent frameworks (LangChain, Crew, AutoGen) are general systems. Braincache is single-flow: query in, context out. | Single orchestrator pattern. One workflow per MCP tool call. |
| **Cross-machine sync / remote indexes** | Network sync requires auth, encryption, conflict resolution, server infra. Augment charges per query for this. | Local-only. `braincache index` runs where the code lives. |
| **Language Server Protocol (LSP) integration** | LSP gives symbol-level navigation (go to definition, find references). Useful, but requires per-language LSP daemons and IDE coupling. Significant complexity. | Use tree-sitter for AST chunking. Good enough for context retrieval without LSP overhead. |
| **Reranking with a second LLM pass** | Cross-encoder reranking improves precision but doubles latency and VRAM. Academic results show degradation beyond a certain scale. | Use vector similarity scores as-is. Re-ranking at this scale is over-engineering. |

---

## Feature Dependencies

```
GPU/CPU Detection
  └── Ollama model selection
        └── Embeddings generation
              └── AST-aware chunking
                    └── Codebase indexing (init-time)
                          └── Incremental re-indexing (file-watch/hash)
                                └── LanceDB vector storage
                                      └── Similarity search (search_codebase)
                                            └── Relevance ranking
                                                  └── Deduplication
                                                        └── Context assembly (build_context)
                                                              └── Token count reporting
                                                                    └── MCP tool exposure

CLI (init, index, doctor, status) → depends on all of the above for execution
```

Key ordering constraints:
- Indexing must exist before any search/retrieval works
- Hardware detection must run before any Ollama call
- Context assembly depends on search working correctly
- MCP tools are the final surface — they wrap all internal workflows
- Token reporting is low-cost and can be added at any layer

---

## MVP Definition

The smallest surface that delivers the core value: **give Claude less-but-better context**.

**Must have in MVP:**

1. `braincache init` — detect hardware, pull Ollama model, configure LanceDB
2. `braincache index [path]` — parse repo with tree-sitter, generate embeddings, store in LanceDB with gitignore respect
3. `search_codebase` MCP tool — take a query string, return top-N relevant chunks with scores
4. `build_context` MCP tool — take a query + token budget, return deduplicated, ranked, assembled context block with metadata
5. `doctor` MCP tool / CLI command — report system health (Ollama reachable, index current, model loaded)
6. Basic token savings metadata on every `build_context` response

**Defer from MVP:**

- Incremental file watching (manual re-index on demand is sufficient for MVP)
- Query-type aware retrieval (uniform retrieval strategy for MVP)
- Ollama model auto-selection by VRAM tier (one good default model for MVP)
- `.braincacheignore` custom exclusions (`.gitignore` only for MVP)

---

## Feature Prioritization Matrix

| Feature | User Value | Build Complexity | MVP? | Phase |
|---------|-----------|-----------------|------|-------|
| Hardware detection + Ollama probe | High | Low | Yes | 1 |
| Gitignore-aware file traversal | High | Low | Yes | 1 |
| AST chunking (tree-sitter) | High | Medium | Yes | 1 |
| Embeddings via Ollama | High | Low | Yes | 1 |
| LanceDB vector storage | High | Low | Yes | 1 |
| CLI init / index | High | Low | Yes | 1 |
| Similarity search (search_codebase MCP) | High | Low | Yes | 2 |
| Context builder with dedup + ranking | High | Medium | Yes | 2 |
| Token savings metadata | Medium | Low | Yes | 2 |
| MCP tool exposure (all tools) | High | Medium | Yes | 2 |
| CLI doctor / status | Medium | Low | Yes | 2 |
| Incremental re-indexing (hash-based) | High | Medium | No | 3 |
| VRAM-tier model auto-selection | Medium | Low | No | 3 |
| `.braincacheignore` support | Medium | Low | No | 3 |
| File watcher for live re-indexing | Medium | High | No | Future |
| Query-type aware retrieval | Medium | High | No | Future |

---

## Sources

- [Augment Code Context Engine MCP Overview](https://docs.augmentcode.com/context-services/mcp/overview) — primary comparable product, MEDIUM confidence
- [Augment Context Engine: 70%+ agent performance improvement](https://www.augmentcode.com/blog/context-engine-mcp-now-live) — MEDIUM confidence
- [Continue.dev Context Providers](https://docs.continue.dev/customize/custom-providers) — context provider taxonomy, HIGH confidence
- [LanceDB: Building RAG on Codebases Part 1](https://lancedb.com/blog/building-rag-on-codebases-part-1/) — tree-sitter + LanceDB patterns, HIGH confidence
- [Morph: Codebase Indexing Strategies](https://www.morphllm.com/codebase-indexing) — indexing strategy taxonomy, MEDIUM confidence
- [DEV: I tracked every token my AI agent consumed — 70% was waste](https://dev.to/nicolalessi/i-tracked-every-token-my-ai-coding-agent-consumed-for-a-week-70-was-waste-465) — token waste quantification, HIGH confidence (empirical)
- [Ollama Embedding Models Library](https://ollama.com/search?c=embedding) — model availability, HIGH confidence
- [nomic-embed-text model page](https://ollama.com/library/nomic-embed-text) — embedding model spec, HIGH confidence
- [supermemory/code-chunk: AST-aware chunking](https://github.com/supermemoryai/code-chunk) — chunking implementation, HIGH confidence
- [Roo-Code gitignore issue](https://github.com/RooCodeInc/Roo-Code/issues/5656) — gitignore respect as table stakes evidence, HIGH confidence
- [uignore: .gitignore for AI tools](https://dev.to/geekfarmer/uignore-a-gitignore-for-ai-coding-tools-3h7) — exclusion pattern standards, MEDIUM confidence
- [RAG 2025 year-end review](https://ragflow.io/blog/rag-review-2025-from-rag-to-context) — retrieval evolution context, MEDIUM confidence
- [SitePoint: Token Optimization — Compressing Context for Cheaper Agents](https://www.sitepoint.com/optimizing-token-usage-context-compression-techniques/) — compression patterns, MEDIUM confidence
- [Drowning in Documents: Consequences of Scaling Reranker Inference](https://arxiv.org/html/2411.11767v2) — reranking anti-feature rationale, HIGH confidence (peer-reviewed)
