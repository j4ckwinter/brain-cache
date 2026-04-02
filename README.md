# brain-cache

> Stop sending your entire repo to Claude.

brain-cache indexes your code locally, retrieves only what matters, and cuts token usage by ~90%.

→ Better answers
→ Lower cost
→ Faster workflows

---

## ⚡ The problem

When you ask Claude about your codebase, you either:

- paste huge chunks of code ❌
- rely on vague context ❌
- or let tools send way too much ❌

Result:

- worse answers
- hallucinations
- massive token usage

---

## 🧠 The solution

brain-cache sits between your repo and Claude.

It:

1. indexes your code locally
2. finds only the relevant parts
3. builds a tight, optimised context
4. sends just enough to Claude

---

## 🔥 Example

```
brain-cache ask "how does authentication work?"

brain-cache: context assembled (1,240 tokens, 93% reduction)

Tokens sent to Claude:     1,240
Estimated without:         ~18,600
Reduction:                 93%
```

Claude gets only what matters → answers are sharper and grounded.

---

## ⚡ Quick start

```
npm install -g brain-cache
brain-cache init
brain-cache index
brain-cache ask "how does this repo work?"
```

---

## 🧩 What it does

- 🧠 Local embeddings (via Ollama — no API calls)
- 🔍 Vector search over your codebase
- ✂️ Context trimming + deduplication
- 🎯 Token budget optimisation
- ⚡ CLI-first workflow
- 🤖 Claude integration (via API or MCP)

---

## 🧠 Why it’s different

Most tools:

- send too much context
- hide retrieval logic
- are fully hosted

brain-cache is:

- 🏠 Local-first
- 🔍 Transparent retrieval
- 🎯 Token-aware
- ⚙️ Developer-controlled

Think:

**Vite, but for LLM context.**

---

## 🤖 MCP integration (Claude Code)

brain-cache exposes tools Claude can call directly:

- search_codebase
- build_context
- index_repo
- doctor

No more copy/pasting code into prompts.

---

## 📄 CLAUDE.md auto-setup

`brain-cache init` automatically adds tool instructions to your project's `CLAUDE.md`.

Why? MCP tools load as deferred tools — Claude sees tool names but not descriptions until fetched. `CLAUDE.md` is always loaded at conversation start, so it's the reliable way to tell Claude when and how to use brain-cache tools.

The section is appended once. Running `init` again won't duplicate it.

---

## 🧪 Commands

```
brain-cache init
brain-cache index
brain-cache search "auth middleware"
brain-cache context "auth flow"
brain-cache ask "how does auth work?"
brain-cache doctor
```

---

## 📊 Why this matters

Every ask shows token savings:

```
context: 1,240 tokens (93% reduction)
```

Less noise → better reasoning → cheaper usage.

---

## ⚠️ Status

Early stage — actively improving:

- ⏳ reranking (planned)
- ⏳ context compression
- ⏳ live indexing (watch mode)

---

## 💡 Vision

AI shouldn't guess how your code works.

It should **read the right parts — and nothing else.**

brain-cache is the layer that makes that possible.

---

## 🧠 Built with GSD

This project was built using the GSD (Get Shit Done) framework — an AI-driven workflow for going from idea → research → plan → execution.

GSD structures development into phases:

- discuss
- research
- plan
- execute

Each step is designed to keep context tight, decisions clear, and momentum high.

brain-cache is both:

- a product built with GSD
- and a natural extension of its philosophy (tight context → better outcomes)

---

## 🛠 Requirements

- Node.js 22+
- Ollama (nomic-embed-text)
- Anthropic API key (for `ask`)

---

## ⭐️ If this is useful

Give it a star — or try it on your repo and let me know what breaks.

---
