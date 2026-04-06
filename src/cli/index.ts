import { Command } from "commander";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { formatTokenSavings } from "../lib/format.js";

declare const __BRAIN_CACHE_VERSION__: string | undefined;
const version = typeof __BRAIN_CACHE_VERSION__ !== "undefined"
  ? __BRAIN_CACHE_VERSION__
  : "dev";

export const program = new Command();

program
  .name("brain-cache")
  .description("Local AI runtime \u2014 GPU cache layer for Claude")
  .version(version);

program
  .command("init")
  .description("Detect hardware, pull embedding model, create config directory")
  .action(async () => {
    const { runInit } = await import("../workflows/init.js");
    await runInit();
  });

program
  .command("doctor")
  .description("Report system health: GPU, VRAM tier, Ollama status")
  .action(async () => {
    const { runDoctor } = await import("../workflows/doctor.js");
    await runDoctor();
  });

program
  .command("index")
  .description("Index a codebase: parse, chunk, embed, and store in LanceDB")
  .argument("[path]", "Directory to index (defaults to current directory)")
  .option("-f, --force", "Force full reindex, ignoring cached file hashes")
  .option("--verify", "Re-read and re-hash all files, bypassing stat fast-path (still incremental embeds). --force overrides --verify.")
  .action(async (path: string | undefined, opts: { force?: boolean; verify?: boolean }) => {
    const { runIndex } = await import("../workflows/index.js");
    await runIndex(path, { force: opts.force, verify: opts.verify });
  });

program
  .command("search")
  .description("Search indexed codebase with a natural language query")
  .argument("<query>", "Natural language query string")
  .option("-n, --limit <n>", "Maximum number of results", "10")
  .option("-p, --path <path>", "Project root directory")
  .action(async (query: string, opts: { limit: string; path?: string }) => {
    const { runSearch } = await import("../workflows/search.js");
    await runSearch(query, {
      limit: parseInt(opts.limit, 10),
      path: opts.path,
    });
  });

program
  .command("status")
  .description(
    "Show index stats: files indexed, chunks stored, last indexed time",
  )
  .argument("[path]", "Project root directory (defaults to current directory)")
  .action(async (path?: string) => {
    const { runStatus } = await import("../workflows/status.js");
    await runStatus(path);
  });

program
  .command("context")
  .description("Build token-budgeted context from codebase for a query")
  .argument("<query>", "Natural language query string")
  .option("-n, --limit <n>", "Maximum number of search results", "10")
  .option("-b, --budget <tokens>", "Token budget for assembled context", "4096")
  .option("-p, --path <path>", "Project root directory")
  .option("--raw", "Output raw JSON (MCP transport compatible)")
  .action(
    async (
      query: string,
      opts: { limit: string; budget: string; path?: string; raw?: boolean },
    ) => {
      const { runBuildContext } = await import("../workflows/buildContext.js");
      const result = await runBuildContext(query, {
        limit: parseInt(opts.limit, 10),
        maxTokens: parseInt(opts.budget, 10),
        path: opts.path,
      });
      if (opts.raw) {
        // Machine-parseable JSON — MCP transport compatible
        process.stdout.write(JSON.stringify(result, null, 2) + "\n");
      } else {
        // Human-readable: content field has real newlines, print it directly
        process.stdout.write(result.content);
        if (!result.content.endsWith("\n")) {
          process.stdout.write("\n");
        }
        process.stderr.write(
          `\n🧠 brain-cache\n${formatTokenSavings({
            tokensSent: result.metadata.tokensSent,
            estimatedWithout: result.metadata.estimatedWithoutBraincache,
            reductionPct: result.metadata.reductionPct,
            filesInContext: result.metadata.filesInContext,
            matchedPoolTokens: result.metadata.matchedPoolTokens,
            filteringPct: result.metadata.filteringPct,
            savingsDisplayMode: result.metadata.savingsDisplayMode,
          })}\n`,
        );
      }
    },
  );

program
  .command("ask")
  .description(
    "Ask a natural language question about the codebase — retrieves context locally, reasons via Claude",
  )
  .argument("<question>", "Natural language question about the codebase")
  .option("-b, --budget <tokens>", "Token budget for context retrieval", "4096")
  .option("-p, --path <path>", "Project root directory")
  .action(async (question: string, opts: { budget: string; path?: string }) => {
    const { runAskCodebase } = await import("../workflows/askCodebase.js");
    const result = await runAskCodebase(question, {
      path: opts.path,
      maxContextTokens: parseInt(opts.budget, 10),
    });
    process.stderr.write(`\n${result.answer}\n`);
    process.stderr.write(
      `\n🧠 brain-cache\n${formatTokenSavings({
        tokensSent: result.contextMetadata.tokensSent,
        estimatedWithout: result.contextMetadata.estimatedWithoutBraincache,
        reductionPct: result.contextMetadata.reductionPct,
        filesInContext: result.contextMetadata.filesInContext,
        matchedPoolTokens: result.contextMetadata.matchedPoolTokens,
        filteringPct: result.contextMetadata.filteringPct,
        savingsDisplayMode: result.contextMetadata.savingsDisplayMode,
      })}\n`,
    );
  });

program
  .command('watch')
  .description('Watch a directory and automatically re-index on file changes')
  .argument('[path]', 'Directory to watch (defaults to current directory)')
  .action(async (path: string | undefined) => {
    const { runWatch } = await import('../workflows/watch.js');
    await runWatch(path);
  });

const service = new Command('service')
  .description('Manage brain-cache background watcher service for this project');

service
  .command('install')
  .description('Install watcher as a user-level background service (macOS/Linux)')
  .action(async () => {
    const { runServiceInstall } = await import('../workflows/service.js');
    await runServiceInstall();
  });

service
  .command('uninstall')
  .description('Stop and remove the background service for this project')
  .action(async () => {
    const { runServiceUninstall } = await import('../workflows/service.js');
    await runServiceUninstall();
  });

service
  .command('status')
  .description('Show service status for this project and list active services')
  .action(async () => {
    const { runServiceStatus } = await import('../workflows/service.js');
    await runServiceStatus();
  });

program.addCommand(service);

/**
 * Resolve to a canonical path so `isMain` matches when the CLI is invoked via
 * a symlink (e.g. `node_modules/.bin/brain-cache`) or `/tmp` vs `/private/tmp`
 * on macOS — otherwise `parseAsync` never runs and commands exit silently.
 */
function canonicalPath(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

const thisFile = canonicalPath(fileURLToPath(import.meta.url));
const entryScript = process.argv[1]
  ? canonicalPath(resolve(process.argv[1]))
  : "";
const isMain = entryScript !== "" && entryScript === thisFile;

if (isMain) {
  (async () => {
    await program.parseAsync();
  })().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Error: ${message}\n`);
    process.exit(1);
  });
}
