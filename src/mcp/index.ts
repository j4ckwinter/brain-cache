import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { childLogger } from '../services/logger.js';
import { readProfile, detectCapabilities } from '../services/capability.js';
import {
  isOllamaInstalled,
  isOllamaRunning,
  getOllamaVersion,
} from '../services/ollama.js';
import { readIndexState } from '../services/lancedb.js';
import { runIndex } from '../workflows/index.js';
import { runSearch } from '../workflows/search.js';
import { runBuildContext } from '../workflows/buildContext.js';

const require = createRequire(import.meta.url);
const pkg = require('../../package.json') as { version: string };

const log = childLogger('mcp');

const server = new McpServer({ name: 'brain-cache', version: pkg.version });

// Tool 1: index_repo (MCP-02)
server.registerTool(
  'index_repo',
  {
    description:
      'Index a codebase: parse source files, chunk at function boundaries, embed locally via Ollama, and store in LanceDB. Run this when the user wants to index or re-index their project.',
    inputSchema: {
      path: z.string().describe('Absolute or relative path to the directory to index'),
      force: z
        .boolean()
        .optional()
        .describe('If true, ignore cached file hashes and perform a full reindex (default false)'),
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
            type: 'text' as const,
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
            type: 'text' as const,
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
        status: 'ok',
        path: resolvedPath,
        fileCount: indexState?.fileCount ?? null,
        chunkCount: indexState?.chunkCount ?? null,
      };
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
    } catch (err) {
      return {
        isError: true,
        content: [
          {
            type: 'text' as const,
            text: `Indexing failed: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
      };
    }
  }
);

// Tool 2: search_codebase (MCP-03)
server.registerTool(
  'search_codebase',
  {
    description:
      'Search the indexed codebase with a natural language query. Returns the top-N most relevant code chunks with similarity scores.',
    inputSchema: {
      query: z.string().describe('Natural language query string'),
      limit: z
        .number()
        .int()
        .min(1)
        .max(50)
        .optional()
        .describe('Max results (default 10)'),
      path: z
        .string()
        .optional()
        .describe('Project root directory (default: current directory)'),
    },
  },
  async ({ query, limit, path }) => {
    const profile = await readProfile();
    if (!profile) {
      return {
        isError: true,
        content: [
          {
            type: 'text' as const,
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
            type: 'text' as const,
            text: "Ollama is not running. Start it with 'ollama serve'.",
          },
        ],
      };
    }
    try {
      const chunks = await runSearch(query, { limit, path });
      return { content: [{ type: 'text' as const, text: JSON.stringify(chunks) }] };
    } catch (err) {
      return {
        isError: true,
        content: [
          {
            type: 'text' as const,
            text: `Search failed: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
      };
    }
  }
);

// Tool 3: build_context (MCP-04)
server.registerTool(
  'build_context',
  {
    description:
      'Build an assembled, deduplicated, token-budgeted context block from the indexed codebase for a given query. Returns the context string plus metadata (tokens sent, estimated tokens without brain-cache, reduction percentage).',
    inputSchema: {
      query: z.string().describe('Natural language query or question'),
      maxTokens: z
        .number()
        .int()
        .min(100)
        .max(100000)
        .optional()
        .describe('Token budget for assembled context (default 4096)'),
      path: z
        .string()
        .optional()
        .describe('Project root directory (default: current directory)'),
    },
  },
  async ({ query, maxTokens, path }) => {
    const profile = await readProfile();
    if (!profile) {
      return {
        isError: true,
        content: [
          {
            type: 'text' as const,
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
            type: 'text' as const,
            text: "Ollama is not running. Start it with 'ollama serve'.",
          },
        ],
      };
    }
    try {
      const result = await runBuildContext(query, { maxTokens, path });
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
    } catch (err) {
      return {
        isError: true,
        content: [
          {
            type: 'text' as const,
            text: `Context build failed: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
      };
    }
  }
);

// Tool 4: doctor (MCP-05)
// Build structured health object directly from services (do NOT call runDoctor() which prints to stderr and calls process.exit)
server.registerTool(
  'doctor',
  {
    description:
      'Return system health: Ollama status, index freshness, model availability, and VRAM info. Use this to diagnose brain-cache issues.',
    inputSchema: {
      path: z
        .string()
        .optional()
        .describe('Project root to check index status (default: current directory)'),
    },
  },
  async ({ path: projectPath }) => {
    try {
      const rootDir = resolve(projectPath ?? '.');
      const profile = await readProfile();
      const installed = await isOllamaInstalled();
      const running = installed ? await isOllamaRunning() : false;
      const version = installed ? await getOllamaVersion() : null;
      const indexState = await readIndexState(rootDir);
      const live = await detectCapabilities();

      const health = {
        ollamaStatus: !installed ? 'not_installed' : running ? 'running' : 'not_running',
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
      return { content: [{ type: 'text' as const, text: JSON.stringify(health) }] };
    } catch (err) {
      return {
        isError: true,
        content: [
          {
            type: 'text' as const,
            text: `Doctor failed: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
      };
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log.info('brain-cache MCP server running on stdio');
}

main().catch((error) => {
  process.stderr.write(`Fatal: ${String(error)}\n`);
  process.exit(1);
});
