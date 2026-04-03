import { resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { childLogger } from "../services/logger.js";
import {
  formatToolResponse,
  formatErrorEnvelope,
  formatTokenSavings,
  formatDoctorOutput,
  formatIndexResult,
  formatSearchResults,
  formatTraceFlow,
  formatContext,
  formatPipelineLabel,
} from "../lib/format.js";
import type { ContextResult } from '../lib/types.js';
import type { RetrievedChunk } from '../lib/types.js';
import { readProfile, detectCapabilities } from "../services/capability.js";
import {
  isOllamaInstalled,
  isOllamaRunning,
  getOllamaVersion,
} from "../services/ollama.js";
import { readIndexState } from "../services/lancedb.js";
import { runIndex } from "../workflows/index.js";
import { runSearch } from "../workflows/search.js";
import { runBuildContext } from "../workflows/buildContext.js";
import { runTraceFlow } from "../workflows/traceFlow.js";
import { runExplainCodebase } from "../workflows/explainCodebase.js";

declare const __BRAIN_CACHE_VERSION__: string | undefined;
const version = typeof __BRAIN_CACHE_VERSION__ !== "undefined"
  ? __BRAIN_CACHE_VERSION__
  : "dev";

const log = childLogger("mcp");

const server = new McpServer({ name: "brain-cache", version: version });

// Tool 1: index_repo (MCP-02)
server.registerTool(
  "index_repo",
  {
    description:
      "Index a codebase for semantic search. Parses source files, chunks at function boundaries, and embeds locally via Ollama into LanceDB. Must be run before search_codebase or build_context will work — re-run when the codebase has changed significantly.",
    inputSchema: {
      path: z
        .string()
        .describe("Absolute or relative path to the directory to index"),
      force: z
        .boolean()
        .optional()
        .describe(
          "If true, ignore cached file hashes and perform a full reindex (default false)",
        ),
    },
  },
  async ({ path, force }) => {
    // Guard: check profile exists
    const profile = await readProfile();
    if (!profile) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: formatErrorEnvelope("No capability profile found.", "Run 'brain-cache init' first."),
          },
        ],
      };
    }
    // Guard: check Ollama running
    const running = await isOllamaRunning();
    if (!running) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: formatErrorEnvelope("Ollama is not running.", "Start it with 'ollama serve'."),
          },
        ],
      };
    }
    try {
      await runIndex(path, { force });
      // Read index state to get counts (runIndex returns void)
      // IMPORTANT: resolve() the path to match runIndex's internal resolution,
      // so readIndexState finds .brain-cache/index_state.json at the correct location.
      const resolvedPath = resolve(path);
      const indexState = await readIndexState(resolvedPath);
      const result = {
        status: "ok",
        path: resolvedPath,
        fileCount: indexState?.fileCount ?? null,
        chunkCount: indexState?.chunkCount ?? null,
      };
      return {
        content: [{ type: "text" as const, text: formatIndexResult(result) }],
      };
    } catch (err) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: formatErrorEnvelope(`Indexing failed: ${err instanceof Error ? err.message : String(err)}`),
          },
        ],
      };
    }
  },
);

function buildSearchResponse(chunks: RetrievedChunk[], query: string) {
  const filesInContext = new Set(chunks.map(c => c.filePath)).size;
  const tokensSent = Math.round(chunks.reduce((sum, c) => sum + c.content.length, 0) / 4);
  const estimatedWithout = tokensSent * 3;
  const reductionPct = estimatedWithout > 0 ? Math.round((1 - tokensSent / estimatedWithout) * 100) : 0;
  const savings = formatTokenSavings({ tokensSent, estimatedWithout, reductionPct, filesInContext });
  const pipeline = formatPipelineLabel(['embed', 'search', 'dedup']);
  const footer = `---\n${savings}\nPipeline: ${pipeline}`;
  const summary = `Found ${chunks.length} result${chunks.length !== 1 ? 's' : ''} for "${query}".`;
  return {
    content: [{ type: 'text' as const, text: formatToolResponse(summary, `${formatSearchResults(chunks)}\n\n${footer}`) }],
  };
}

function buildContextResponse(result: ContextResult, query: string) {
  const { tokensSent, estimatedWithoutBraincache, reductionPct, filesInContext, localTasksPerformed } = result.metadata;
  const savings = formatTokenSavings({ tokensSent, estimatedWithout: estimatedWithoutBraincache, reductionPct, filesInContext });
  const pipeline = formatPipelineLabel(localTasksPerformed);
  const footer = `---\n${savings}\nPipeline: ${pipeline}`;
  const summary = `Context assembled for "${query}".`;
  return {
    content: [{ type: 'text' as const, text: formatToolResponse(summary, `${formatContext(result)}\n\n${footer}`) }],
  };
}

// Tool 2: search_codebase (MCP-03)
server.registerTool(
  "search_codebase",
  {
    description:
      "Locate specific code — functions, symbols, definitions, implementations, and type declarations — using semantic search that finds code by meaning, not just keyword match. This is a locator tool — it finds WHERE code lives. For understanding HOW code works or answering questions that span multiple files, use build_context instead. Requires index_repo to have been run first. Do NOT use this tool to understand how code works or answer behavioral questions — use build_context once you have located the symbol.",
    inputSchema: {
      query: z.string().describe("Natural language query string"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(50)
        .optional()
        .describe("Max results (default 10)"),
      path: z
        .string()
        .optional()
        .describe("Project root directory (default: current directory)"),
    },
  },
  async ({ query, limit, path }) => {
    const profile = await readProfile();
    if (!profile) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: formatErrorEnvelope("No capability profile found.", "Run 'brain-cache init' first."),
          },
        ],
      };
    }
    const running = await isOllamaRunning();
    if (!running) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: formatErrorEnvelope("Ollama is not running.", "Start it with 'ollama serve'."),
          },
        ],
      };
    }
    try {
      const chunks = await runSearch(query, { limit, path });
      return buildSearchResponse(chunks, query);
    } catch (err) {
      if (err instanceof Error && err.message.includes("No index found")) {
        const resolvedPath = resolve(path ?? ".");
        await runIndex(resolvedPath);
        try {
          const chunks = await runSearch(query, { limit, path });
          return buildSearchResponse(chunks, query);
        } catch (retryErr) {
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: formatErrorEnvelope(`Search failed after auto-index: ${retryErr instanceof Error ? retryErr.message : String(retryErr)}`),
              },
            ],
          };
        }
      }
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: formatErrorEnvelope(`Search failed: ${err instanceof Error ? err.message : String(err)}`),
          },
        ],
      };
    }
  },
);

// Tool 3: build_context (MCP-04)
server.registerTool(
  "build_context",
  {
    description:
      "Use this tool when answering questions like 'how does X work', 'what does this function do', or any question requiring understanding of specific code behavior across multiple files. Retrieves semantically relevant code across the entire repo, deduplicates, and assembles a token-budgeted context block — more accurate and efficient than reading files individually or relying on memory. Use this before answering to ensure your response is grounded in actual code rather than assumptions. Ideal for explaining how systems work, understanding workflows and data flow, answering code behavior questions, multi-file reasoning, and debugging unfamiliar code paths. Do NOT use this tool when you need to trace a call path across files — use trace_flow instead. Do NOT use this tool for architecture overviews — use explain_codebase instead. Requires index_repo to have been run first.",
    inputSchema: {
      query: z.string().describe("Natural language query or question"),
      maxTokens: z
        .number()
        .int()
        .min(100)
        .max(100000)
        .optional()
        .describe("Token budget for assembled context (default 4096)"),
      path: z
        .string()
        .optional()
        .describe("Project root directory (default: current directory)"),
    },
  },
  async ({ query, maxTokens, path }) => {
    const profile = await readProfile();
    if (!profile) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: formatErrorEnvelope("No capability profile found.", "Run 'brain-cache init' first."),
          },
        ],
      };
    }
    const running = await isOllamaRunning();
    if (!running) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: formatErrorEnvelope("Ollama is not running.", "Start it with 'ollama serve'."),
          },
        ],
      };
    }
    try {
      const result = await runBuildContext(query, { maxTokens, path });
      return buildContextResponse(result, query);
    } catch (err) {
      if (err instanceof Error && err.message.includes("No index found")) {
        const resolvedPath = resolve(path ?? ".");
        await runIndex(resolvedPath);
        try {
          const result = await runBuildContext(query, { maxTokens, path });
          return buildContextResponse(result, query);
        } catch (retryErr) {
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: formatErrorEnvelope(`Context build failed after auto-index: ${retryErr instanceof Error ? retryErr.message : String(retryErr)}`),
              },
            ],
          };
        }
      }
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: formatErrorEnvelope(`Context build failed: ${err instanceof Error ? err.message : String(err)}`),
          },
        ],
      };
    }
  },
);

// Tool 4: doctor (MCP-05)
// Build structured health object directly from services (do NOT call runDoctor() which prints to stderr and calls process.exit)
server.registerTool(
  "doctor",
  {
    description:
      "Run this first when any brain-cache tool fails or returns unexpected results. Returns system health: Ollama status, index freshness, model availability, and VRAM info. Use this to diagnose brain-cache issues before investigating manually.",
    inputSchema: {
      path: z
        .string()
        .optional()
        .describe(
          "Project root to check index status (default: current directory)",
        ),
    },
  },
  async ({ path: projectPath }) => {
    try {
      const rootDir = resolve(projectPath ?? ".");
      const profile = await readProfile();
      const installed = await isOllamaInstalled();
      const running = installed ? await isOllamaRunning() : false;
      const version = installed ? await getOllamaVersion() : null;
      const indexState = await readIndexState(rootDir);
      const live = await detectCapabilities();

      const health = {
        ollamaStatus: (!installed
          ? "not_installed"
          : running
            ? "running"
            : "not_running") as 'not_installed' | 'running' | 'not_running',
        ollamaVersion: version,
        indexFreshness: {
          indexed: indexState !== null,
          indexedAt: indexState?.indexedAt ?? null,
          fileCount: indexState?.fileCount ?? null,
          chunkCount: indexState?.chunkCount ?? null,
        },
        modelLoaded: profile?.embeddingModel != null,
        embeddingModel: profile?.embeddingModel ?? null,
        vramAvailable: live.vramGiB,
        vramTier: live.vramTier,
      };
      return {
        content: [{ type: "text" as const, text: formatDoctorOutput(health) }],
      };
    } catch (err) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: formatErrorEnvelope(`Doctor failed: ${err instanceof Error ? err.message : String(err)}`),
          },
        ],
      };
    }
  },
);

// Tool 5: trace_flow (FLOW-02)
server.registerTool(
  'trace_flow',
  {
    description:
      'Trace call paths from an entrypoint symbol. Returns a structured hops[] array showing which functions are called in sequence, their file locations, and what they call next. Use this instead of build_context when asked to trace how a function call propagates through the codebase, e.g. "how does indexing flow from CLI to LanceDB". Requires index_repo to have been run first. Do NOT use this tool when the question is about how code works or what a function does — use build_context instead.',
    inputSchema: {
      entrypoint: z.string().describe('Natural language description of the starting function or entry point to trace from, e.g. "runBuildContext workflow" or "how does indexing work"'),
      maxHops: z.number().int().min(1).max(10).optional().describe('Maximum call depth to follow (default 3)'),
      path: z.string().optional().describe('Project root directory (default: current directory)'),
    },
  },
  async ({ entrypoint, maxHops, path }) => {
    const profile = await readProfile();
    if (!profile) {
      return { isError: true, content: [{ type: 'text' as const, text: formatErrorEnvelope("No capability profile found.", "Run 'brain-cache init' first.") }] };
    }
    const running = await isOllamaRunning();
    if (!running) {
      return { isError: true, content: [{ type: 'text' as const, text: formatErrorEnvelope("Ollama is not running.", "Start it with 'ollama serve'.") }] };
    }
    try {
      const result = await runTraceFlow(entrypoint, { maxHops, path });
      const { tokensSent, estimatedWithoutBraincache, reductionPct, filesInContext } = result.metadata;
      const savings = formatTokenSavings({
        tokensSent,
        estimatedWithout: estimatedWithoutBraincache,
        reductionPct,
        filesInContext,
      });
      const pipeline = formatPipelineLabel(result.metadata.localTasksPerformed);
      const footer = `---\n${savings}\nPipeline: ${pipeline}`;
      const summary = `Traced ${result.hops.length} hop${result.hops.length !== 1 ? 's' : ''} from "${entrypoint}".`;
      return {
        content: [{ type: 'text' as const, text: formatToolResponse(summary, `${formatTraceFlow(result)}\n\n${footer}`) }],
      };
    } catch (err) {
      return { isError: true, content: [{ type: 'text' as const, text: formatErrorEnvelope(`trace_flow failed: ${err instanceof Error ? err.message : String(err)}`) }] };
    }
  }
);

// Tool 6: explain_codebase (TOOL-02)
server.registerTool(
  'explain_codebase',
  {
    description:
      'Get a high-level architecture overview of the indexed codebase. Returns module-grouped summaries describing what each part of the repo does. Use this instead of build_context when asked to explain the project architecture, understand the overall structure, or get oriented in a new codebase. No follow-up question required — works with just a project path. Requires index_repo to have been run first. Do NOT use this tool for questions about specific code behavior or how a particular function works — use build_context instead.',
    inputSchema: {
      question: z.string().optional().describe('Optional focus question, e.g. "how is authentication structured". Defaults to a broad architecture overview.'),
      maxTokens: z.number().int().min(100).max(100000).optional().describe('Token budget for assembled context (default 4096)'),
      path: z.string().optional().describe('Project root directory (default: current directory)'),
    },
  },
  async ({ question, maxTokens, path }) => {
    const profile = await readProfile();
    if (!profile) {
      return { isError: true, content: [{ type: 'text' as const, text: formatErrorEnvelope("No capability profile found.", "Run 'brain-cache init' first.") }] };
    }
    const running = await isOllamaRunning();
    if (!running) {
      return { isError: true, content: [{ type: 'text' as const, text: formatErrorEnvelope("Ollama is not running.", "Start it with 'ollama serve'.") }] };
    }
    try {
      const result = await runExplainCodebase({ question, maxTokens, path });
      const { tokensSent, estimatedWithoutBraincache, reductionPct, filesInContext, localTasksPerformed } = result.metadata;
      const savings = formatTokenSavings({ tokensSent, estimatedWithout: estimatedWithoutBraincache, reductionPct, filesInContext });
      const pipeline = formatPipelineLabel(localTasksPerformed);
      const footer = `---\n${savings}\nPipeline: ${pipeline}`;
      const summary = `Architecture overview for ${path ?? '.'}.`;
      const text = formatToolResponse(summary, `${formatContext(result)}\n\n${footer}`);
      return { content: [{ type: 'text' as const, text }] };
    } catch (err) {
      return { isError: true, content: [{ type: 'text' as const, text: formatErrorEnvelope(`explain_codebase failed: ${err instanceof Error ? err.message : String(err)}`) }] };
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log.info("brain-cache MCP server running on stdio");
}

main().catch((error) => {
  process.stderr.write(`Fatal: ${String(error)}\n`);
  process.exit(1);
});
