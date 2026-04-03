import { readFile } from "node:fs/promises";
import { resolve, relative, dirname } from "node:path";
import { readProfile } from "../services/capability.js";
import { isOllamaRunning } from "../services/ollama.js";
import { openDatabase, readIndexState } from "../services/lancedb.js";
import { embedBatchWithRetry } from "../services/embedder.js";
import { searchChunks, deduplicateChunks } from "../services/retriever.js";
import { assembleContext, countChunkTokens } from "../services/tokenCounter.js";
import {
  groupChunksByFile,
  enrichWithParentClass,
  formatGroupedContext,
} from "../services/cohesion.js";
import { compressChunk } from "../services/compression.js";
import { loadUserConfig, resolveStrategy } from "../services/configLoader.js";
import {
  DEFAULT_TOKEN_BUDGET,
  TOOL_CALL_OVERHEAD_TOKENS,
} from "../lib/config.js";
import type { ContextResult } from "../lib/types.js";

const FALLBACK_QUERY = "module structure and component responsibilities";

/**
 * Diverse queries used for broad architecture retrieval when no custom question is given.
 * Each query targets a different semantic angle of the codebase so the combined result
 * covers more ground than a single query can.
 */
const ARCHITECTURE_QUERIES = [
  FALLBACK_QUERY,
  "entry points, CLI commands, and main application flow",
  "core services, business logic, and data processing",
  "data models, types, schemas, and configuration",
];

export interface ExplainCodebaseOptions {
  question?: string;
  maxTokens?: number;
  path?: string;
  limit?: number;
  distanceThreshold?: number;
}

/** Raw row shape returned when querying all rows (no vector search). */
interface FilePathRow {
  file_path: string;
  [key: string]: unknown;
}

/**
 * Builds a compact directory tree string from a list of file paths.
 * Groups files under their parent directories and renders them with
 * indented tree lines relative to rootDir.
 */
export function buildDirectoryTree(filePaths: string[], rootDir: string): string {
  // Resolve relative paths and deduplicate
  const relativePaths = [
    ...new Set(filePaths.map((fp) => relative(rootDir, fp))),
  ].sort();

  // Group by parent directory
  const byDir = new Map<string, string[]>();
  for (const rel of relativePaths) {
    const dir = dirname(rel);
    if (!byDir.has(dir)) byDir.set(dir, []);
    byDir.get(dir)!.push(rel);
  }

  const lines: string[] = [];
  const dirs = [...byDir.keys()].sort();

  for (let di = 0; di < dirs.length; di++) {
    const dir = dirs[di];
    const files = byDir.get(dir)!;
    const isLastDir = di === dirs.length - 1;

    if (dir !== ".") {
      lines.push(`${isLastDir ? "└──" : "├──"} ${dir}/`);
    }

    for (let fi = 0; fi < files.length; fi++) {
      const isLastFile = fi === files.length - 1;
      const fileName = files[fi].includes("/")
        ? files[fi].split("/").pop()!
        : files[fi];
      const indent = dir !== "." ? "    " : "";
      const isLast = isLastFile && (isLastDir || dir === ".");
      lines.push(`${indent}${isLast ? "└──" : "├──"} ${fileName}`);
    }
  }

  return lines.join("\n");
}

/**
 * Explains the overall architecture and structure of an indexed codebase.
 * Uses explore-mode retrieval with multiple diverse queries to get broad coverage,
 * then groups results by file for a module-oriented presentation.
 *
 * When no question is provided, uses 4 diverse architecture queries instead of one
 * to maximise semantic coverage across entry points, services, models, and config.
 *
 * When a custom question is provided, uses that single focused query (same as before).
 */
export async function runExplainCodebase(
  opts?: ExplainCodebaseOptions,
): Promise<ContextResult> {
  // 1. Guards
  const profile = await readProfile();
  if (profile === null) {
    throw new Error("No profile found. Run 'brain-cache init' first.");
  }
  const running = await isOllamaRunning();
  if (!running) {
    throw new Error("Ollama is not running.");
  }

  // 2. Open database
  const rootDir = resolve(opts?.path ?? ".");
  const indexState = await readIndexState(rootDir);
  if (indexState === null) {
    throw new Error(
      `No index found at ${rootDir}. Run 'brain-cache index' first.`,
    );
  }
  const db = await openDatabase(rootDir);
  const tableNames = await db.tableNames();
  if (!tableNames.includes("chunks")) {
    throw new Error("No chunks table found. Run 'brain-cache index' first.");
  }
  const table = await db.openTable("chunks");

  // 3. Load user config and resolve explore strategy
  const userConfig = await loadUserConfig();
  const toolOverride: Partial<{ limit: number; distanceThreshold: number }> =
    {};
  if (opts?.limit !== undefined) toolOverride.limit = opts.limit;
  if (opts?.distanceThreshold !== undefined)
    toolOverride.distanceThreshold = opts.distanceThreshold;
  const strategy = resolveStrategy(
    "explore",
    userConfig,
    Object.keys(toolOverride).length > 0 ? toolOverride : undefined,
  );

  // Architecture overviews need more budget than targeted queries, but must stay
  // within MCP result size limits (~20k chars ≈ ~6k tokens of formatted output)
  const maxTokens = opts?.maxTokens ?? DEFAULT_TOKEN_BUDGET * 2;

  // 4. Determine queries: multi-query for broad overview, single query for focused question
  const customQuestion = opts?.question;
  const queries = customQuestion ? [customQuestion] : ARCHITECTURE_QUERIES;

  process.stderr.write(
    `brain-cache: explaining codebase (budget=${maxTokens} tokens, queries=${queries.length})\n`,
  );

  // 5. Embed all queries in a single batch call, then search for each embedding
  const { embeddings } = await embedBatchWithRetry(indexState.embeddingModel, queries);

  const allResults = await Promise.all(
    embeddings.map((vec) => searchChunks(table, vec, strategy)),
  );

  // Merge all per-query results and deduplicate by chunk id
  const merged = allResults.flat();
  const deduped = deduplicateChunks(merged);

  // 6. Fetch all indexed file paths for the directory tree preamble (no vector search needed)
  let allFilePaths: string[] = [];
  try {
    const allRows = await table.query().toArray() as FilePathRow[];
    allFilePaths = [...new Set(allRows.map((r) => r.file_path))].sort();
  } catch {
    // Non-critical — directory tree is a preamble enhancement, fall back gracefully
    allFilePaths = [];
  }

  // 7. Deprioritize test files for architecture queries — sort source files first
  const sorted = [...deduped].sort((a, b) => {
    const aIsTest =
      /\/(tests?|__tests__|spec)\//i.test(a.filePath) ||
      /\.(test|spec)\./i.test(a.filePath);
    const bIsTest =
      /\/(tests?|__tests__|spec)\//i.test(b.filePath) ||
      /\.(test|spec)\./i.test(b.filePath);
    if (aIsTest === bIsTest) return 0;
    return aIsTest ? 1 : -1;
  });

  const assembled = assembleContext(sorted, { maxTokens });

  // 8. Enrich with parent class chunks
  const enriched = await enrichWithParentClass(assembled.chunks, table, {
    maxTokens,
    currentTokens: assembled.tokenCount,
  });

  // 9. Light compression — only compress very large chunks (>500 tokens) to stay within MCP limits
  const compressed = enriched.map((c) => {
    const tokens = countChunkTokens(c.content);
    return tokens > 500 ? compressChunk(c) : c;
  });

  // 10. Group by file and format with cohesion headers
  const groups = groupChunksByFile(compressed);
  const codeContent = formatGroupedContext(groups);

  // 11. Build directory tree preamble (prefers all indexed paths; falls back to retrieved paths)
  const treeFilePaths = allFilePaths.length > 0
    ? allFilePaths
    : [...new Set(compressed.map((c) => c.filePath))];
  const nonTestPaths = treeFilePaths.filter(
    (fp) =>
      !(/\/(tests?|__tests__|spec)\//i.test(fp) || /\.(test|spec)\./i.test(fp)),
  );
  const directoryTree = buildDirectoryTree(nonTestPaths, rootDir);

  // 12. Assemble final content: directory structure preamble + module-grouped code sections
  const content = [
    "## Directory Structure\n\n```\n" + directoryTree + "\n```",
    codeContent,
  ].join("\n\n---\n\n");

  // 13. Estimate tokens without brain-cache
  const uniqueFiles = [...new Set(compressed.map((c) => c.filePath))];
  let fileContentTokens = 0;
  for (const filePath of uniqueFiles) {
    try {
      const fileContent = await readFile(filePath, "utf-8");
      fileContentTokens += countChunkTokens(fileContent);
    } catch {
      // File may have been deleted since indexing — skip
    }
  }
  const toolCalls = 1 + uniqueFiles.length;
  const estimatedWithoutBraincache =
    fileContentTokens + toolCalls * TOOL_CALL_OVERHEAD_TOKENS;
  const tokensSent = assembled.tokenCount;
  const reductionPct =
    estimatedWithoutBraincache > 0
      ? Math.max(
          0,
          Math.round((1 - tokensSent / estimatedWithoutBraincache) * 100),
        )
      : 0;

  return {
    content,
    chunks: compressed,
    metadata: {
      tokensSent,
      estimatedWithoutBraincache,
      reductionPct,
      filesInContext: uniqueFiles.length,
      localTasksPerformed: [
        "embed_query",
        "vector_search",
        "dedup",
        "parent_enrich",
        "compress",
        "cohesion_group",
        "token_budget",
        "directory_tree",
      ],
      cloudCallsMade: 0,
    },
  };
}
