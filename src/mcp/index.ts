import { resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { childLogger } from "../services/logger.js";
import { formatTokenSavings } from "../lib/format.js";
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

declare const __BRAIN_CACHE_VERSION__: string;
const version = __BRAIN_CACHE_VERSION__;

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
            text: "No capability profile found. Run 'brain-cache init' first.",
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
            text: "Ollama is not running. Start it with 'ollama serve'.",
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
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
      };
    } catch (err) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Indexing failed: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
      };
    }
  },
);

// Tool 2: search_codebase (MCP-03)
server.registerTool(
  "search_codebase",
  {
    description:
      "Locate specific code — functions, symbols, definitions, implementations, and type declarations — using semantic search that finds code by meaning, not just keyword match. This is a locator tool — it finds WHERE code lives. For understanding HOW code works or answering questions that span multiple files, use build_context instead. Requires index_repo to have been run first.",
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
            text: "No capability profile found. Run 'brain-cache init' first.",
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
            text: "Ollama is not running. Start it with 'ollama serve'.",
          },
        ],
      };
    }
    try {
      const chunks = await runSearch(query, { limit, path });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(chunks) }],
      };
    } catch (err) {
      if (err instanceof Error && err.message.includes("No index found")) {
        const resolvedPath = resolve(path ?? ".");
        await runIndex(resolvedPath);
        try {
          const chunks = await runSearch(query, { limit, path });
          return {
            content: [{ type: "text" as const, text: JSON.stringify(chunks) }],
          };
        } catch (retryErr) {
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: `Search failed after auto-index: ${retryErr instanceof Error ? retryErr.message : String(retryErr)}`,
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
            text: `Search failed: ${err instanceof Error ? err.message : String(err)}`,
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
      "Prefer this tool when answering questions like 'how does X work', 'explain the architecture', 'what happens when Y', or any question requiring understanding across multiple files. Retrieves semantically relevant code across the entire repo, deduplicates, and assembles a token-budgeted context block — more accurate and efficient than reading files individually or relying on memory. Use this before answering to ensure your response is grounded in actual code rather than assumptions. Ideal for explaining how systems work, understanding workflows and data flow, answering architectural questions, multi-file reasoning, and debugging unfamiliar code paths. Requires index_repo to have been run first.",
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
            text: "No capability profile found. Run 'brain-cache init' first.",
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
            text: "Ollama is not running. Start it with 'ollama serve'.",
          },
        ],
      };
    }
    try {
      const result = await runBuildContext(query, { maxTokens, path });
      const { tokensSent, estimatedWithoutBraincache, reductionPct, filesInContext } = result.metadata;
      return {
        content: [
          { type: "text" as const, text: JSON.stringify({ ...result, tokenSavings: formatTokenSavings({ tokensSent, estimatedWithout: estimatedWithoutBraincache, reductionPct, filesInContext }) }) },
        ],
      };
    } catch (err) {
      if (err instanceof Error && err.message.includes("No index found")) {
        const resolvedPath = resolve(path ?? ".");
        await runIndex(resolvedPath);
        try {
          const result = await runBuildContext(query, { maxTokens, path });
          const { tokensSent, estimatedWithoutBraincache, reductionPct, filesInContext } = result.metadata;
          return {
            content: [
              { type: "text" as const, text: JSON.stringify({ ...result, tokenSavings: formatTokenSavings({ tokensSent, estimatedWithout: estimatedWithoutBraincache, reductionPct, filesInContext }) }) },
            ],
          };
        } catch (retryErr) {
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: `Context build failed after auto-index: ${retryErr instanceof Error ? retryErr.message : String(retryErr)}`,
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
            text: `Context build failed: ${err instanceof Error ? err.message : String(err)}`,
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
        ollamaStatus: !installed
          ? "not_installed"
          : running
            ? "running"
            : "not_running",
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
        content: [{ type: "text" as const, text: JSON.stringify(health) }],
      };
    } catch (err) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Doctor failed: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
      };
    }
  },
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
